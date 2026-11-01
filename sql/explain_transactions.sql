-- EXPLAIN (ANALYZE, BUFFERS) for the main transactions list query, with and without its index.
--   psql "$DATABASE_URL" -f sql/explain_transactions.sql
--
-- Index under test (see backend/src/db/schema.ts):
--   transactions_account_date_idx ON transactions (account_id, trade_date DESC)

ANALYZE transactions;

\echo
\echo '=== A. One account, newest first, first page (WITH the index) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT transaction_id, trade_date, transaction_type, amount, status
FROM transactions
WHERE account_id = 'A00001'
ORDER BY trade_date DESC
LIMIT 20;

\echo
\echo '=== B. The same query WITHOUT the index (dropped inside a transaction, then rolled back) ==='
BEGIN;
DROP INDEX transactions_account_date_idx;
EXPLAIN (ANALYZE, BUFFERS)
SELECT transaction_id, trade_date, transaction_type, amount, status
FROM transactions
WHERE account_id = 'A00001'
ORDER BY trade_date DESC
LIMIT 20;
ROLLBACK;

\echo
\echo '=== C. What the API runs: one customer (all their accounts), filtered by date range, page 1 ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.transaction_id, t.trade_date, t.transaction_type, t.amount, t.status, i.symbol
FROM transactions t
JOIN accounts a    ON a.account_id = t.account_id
JOIN instruments i ON i.instrument_id = t.instrument_id
WHERE a.customer_id = 'C0001'
  AND t.trade_date >= '2026-01-01'
ORDER BY t.trade_date DESC, t.transaction_id DESC
LIMIT 20 OFFSET 0;
