-- FinPilot: the six SQL tasks a reviewer may ask for.
--
--   psql "$DATABASE_URL" -f sql/reviewer_queries.sql        (DATABASE_URL is defined in your .env)
--   (or: docker compose exec -T db psql -U finpilot -d finpilot < sql/reviewer_queries.sql)
--
-- Portfolio figures come from the view v_positions (current holdings snapshot x latest prices),
-- so every query here agrees with what the dashboards show.

\echo
\echo '=== 1. Top 10 customers by current-snapshot AUM ==='
SELECT c.customer_id,
       c.full_name,
       c.segment,
       count(*)            AS positions,
       sum(p.market_value) AS aum
FROM v_positions p
JOIN customers c USING (customer_id)
GROUP BY c.customer_id, c.full_name, c.segment
ORDER BY aum DESC
LIMIT 10;

\echo
\echo '=== 2a. Asset-class allocation for ONE customer (C0002) ==='
-- sum(sum(...)) OVER () is a window function over the aggregate: each class'"'"'s share of the total.
SELECT asset_class,
       sum(market_value)                                                  AS market_value,
       round(100 * sum(market_value) / sum(sum(market_value)) OVER (), 2) AS weight_pct
FROM v_positions
WHERE customer_id = 'C0002'
GROUP BY asset_class
ORDER BY market_value DESC;

\echo
\echo '=== 2b. Asset-class allocation for the WHOLE dataset ==='
SELECT asset_class,
       count(*)                                                           AS positions,
       sum(market_value)                                                  AS market_value,
       round(100 * sum(market_value) / sum(sum(market_value)) OVER (), 2) AS weight_pct
FROM v_positions
GROUP BY asset_class
ORDER BY market_value DESC;

\echo
\echo '=== 3. Monthly BUY/SELL net cash flow, last 12 months (SETTLED only; SELL = cash in, BUY = cash out) ==='
-- generate_series gives one row per month, so months with no trades show 0 instead of disappearing.
-- The window is anchored to today; the synthetic data ends on 2026-09-18, so the newest months are empty.
WITH months AS (
  SELECT generate_series(date_trunc('month', current_date) - interval '11 months',
                         date_trunc('month', current_date),
                         interval '1 month')::date AS month
)
SELECT m.month,
       coalesce(sum(t.amount) FILTER (WHERE t.transaction_type = 'SELL'), 0) AS sell_inflow,
       coalesce(sum(t.amount) FILTER (WHERE t.transaction_type = 'BUY'), 0)  AS buy_outflow,
       coalesce(sum(CASE t.transaction_type WHEN 'SELL' THEN t.amount ELSE -t.amount END), 0) AS net_cash_flow
FROM months m
LEFT JOIN transactions t
       ON date_trunc('month', t.trade_date)::date = m.month
      AND t.status = 'SETTLED'
      AND t.transaction_type IN ('BUY', 'SELL')
GROUP BY m.month
ORDER BY m.month;

\echo
\echo '=== 4. Top instruments by number of distinct holders ==='
SELECT instrument_id,
       symbol,
       asset_class,
       count(DISTINCT customer_id) AS holders,
       sum(market_value)           AS total_value
FROM v_positions
GROUP BY instrument_id, symbol, asset_class
ORDER BY holders DESC, total_value DESC
LIMIT 10;

\echo
\echo '=== 5. Customers with HIGH-priority goals below 25% funded ==='
SELECT c.customer_id,
       c.full_name,
       g.goal_id,
       g.goal_name,
       g.target_amount,
       g.current_funded_amount,
       round(100 * g.current_funded_amount / g.target_amount, 1) AS funded_pct,
       g.target_date
FROM goals g
JOIN customers c USING (customer_id)
WHERE g.priority = 'HIGH'
  AND g.current_funded_amount < 0.25 * g.target_amount
ORDER BY funded_pct, c.customer_id;

\echo
\echo '=== 6a. Data-quality exceptions recorded by the importer (duplicate IDs, bad references, bad values) ==='
SELECT b.dataset,
       r.code,
       count(*)                                          AS rows,
       string_agg(r.record_key, ', ' ORDER BY r.row_number) AS records
FROM import_rejections r
JOIN import_batches b ON b.id = r.batch_id
GROUP BY b.dataset, r.code
ORDER BY b.dataset, r.code;

\echo
\echo '=== 6b. Reconciliation: accounts with ledger activity but no holdings ==='
SELECT a.account_id, a.customer_id, a.status, count(*) AS transactions
FROM accounts a
JOIN transactions t USING (account_id)
WHERE NOT EXISTS (SELECT 1 FROM holdings h WHERE h.account_id = a.account_id)
GROUP BY a.account_id, a.customer_id, a.status
ORDER BY transactions DESC, a.account_id;

\echo
\echo '=== 6c. Transactions dated before their account was opened (accepted by policy, flagged here for review) ==='
SELECT count(*)                  AS transactions,
       count(DISTINCT t.account_id) AS accounts,
       round(100.0 * count(*) / (SELECT count(*) FROM transactions), 1) AS pct_of_ledger
FROM transactions t
JOIN accounts a USING (account_id)
WHERE t.trade_date < a.opened_at;

\echo
\echo '=== 6d. Customers with no holdings in the current snapshot ==='
SELECT c.customer_id, c.full_name, count(a.account_id) AS accounts
FROM customers c
LEFT JOIN accounts a USING (customer_id)
WHERE NOT EXISTS (SELECT 1 FROM v_positions p WHERE p.customer_id = c.customer_id)
GROUP BY c.customer_id, c.full_name
ORDER BY c.customer_id;

\echo
\echo '=== 6e. Reconciliation: do holdings equal the net settled BUY/SELL quantity of the ledger? ==='
-- They do not (0 of 982): the holdings snapshot is the source of truth for the portfolio and the
-- transactions table is a separate ledger. Documented in DECISIONS.md.
WITH ledger AS (
  SELECT account_id, instrument_id,
         sum(CASE transaction_type WHEN 'BUY' THEN quantity WHEN 'SELL' THEN -quantity END) AS net_qty
  FROM transactions
  WHERE status = 'SETTLED' AND transaction_type IN ('BUY', 'SELL')
  GROUP BY account_id, instrument_id
)
SELECT count(*) FILTER (WHERE abs(coalesce(l.net_qty, 0) - p.quantity) < 0.001) AS reconciled_positions,
       count(*)                                                                AS total_positions
FROM v_positions p
LEFT JOIN ledger l USING (account_id, instrument_id);
