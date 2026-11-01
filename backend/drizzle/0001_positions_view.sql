-- v_positions: every holding of the CURRENT snapshot, joined to its account and instrument, with the
-- portfolio maths done once, in SQL. All portfolio endpoints read from this view, so market value,
-- cost and unrealised P&L can never disagree between screens.
--
--   market_value   = round(quantity x last_price, 2)
--   cost_value     = round(quantity x avg_cost,   2)
--   unrealised_pnl = market_value - cost_value       (from the two ROUNDED figures, so the numbers
--                                                     shown on screen always reconcile to the cent)
--
-- "Current" means the latest snapshot_date in holdings, so loading a newer snapshot later changes
-- the dashboards without touching any code.
CREATE VIEW "v_positions" AS
WITH priced AS (
  SELECT
    a.customer_id,
    h.account_id,
    a.account_type,
    h.instrument_id,
    i.symbol,
    i.instrument_name,
    i.asset_class,
    i.sector,
    h.quantity,
    h.avg_cost,
    i.last_price,
    round(h.quantity * i.last_price, 2) AS market_value,
    round(h.quantity * h.avg_cost, 2)   AS cost_value,
    h.snapshot_date,
    i.price_as_of
  FROM holdings h
  JOIN accounts a    ON a.account_id    = h.account_id
  JOIN instruments i ON i.instrument_id = h.instrument_id
  WHERE h.snapshot_date = (SELECT max(snapshot_date) FROM holdings)
)
SELECT
  customer_id,
  account_id,
  account_type,
  instrument_id,
  symbol,
  instrument_name,
  asset_class,
  sector,
  quantity,
  avg_cost,
  last_price,
  market_value,
  cost_value,
  market_value - cost_value                                              AS unrealised_pnl,
  round((market_value - cost_value) / nullif(cost_value, 0) * 100, 2)    AS unrealised_pnl_pct,
  snapshot_date,
  price_as_of
FROM priced;
