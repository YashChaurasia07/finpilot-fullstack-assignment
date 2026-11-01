# EXPLAIN (ANALYZE, BUFFERS): transactions list query

Captured on the seeded database (4,550 transactions) with `psql -f sql/explain_transactions.sql`.
Reproduce: `docker compose up -d db`, then `npm run db:migrate && npm run seed` in `backend/`, then run the script.

## The query pattern and the index

The transactions page asks: *"for this customer's account(s), newest first, one page at a time"*.
The index is declared in `backend/src/db/schema.ts`:

```sql
CREATE INDEX transactions_account_date_idx ON transactions (account_id, trade_date DESC NULLS FIRST);
```

* `account_id` first: the equality condition narrows 4,550 rows to one account's ~40.
* `trade_date DESC` second: rows come out of the index already in display order, so there is **no sort step** and
  `LIMIT 20` can stop after reading 20 index entries.
* `NULLS FIRST` is what `ORDER BY ... DESC` means in PostgreSQL. (Drizzle's default would emit `NULLS LAST`, which the planner
  cannot use for this ORDER BY, so the schema sets it explicitly.)

## Result

| | Plan | Buffers | Execution |
|---|---|---|---|
| **A. With the index** | Index Scan using `transactions_account_date_idx` (no Sort) | 3 | **0.24 ms** |
| **B. Without it** | Seq Scan (removes 4,510 rows) + Sort | 51 | 1.01 ms |

At this size both are fast; the point is the *shape*: the indexed plan reads a constant number of pages whatever the table size,
the unindexed plan reads the whole table and sorts. At 10 million rows that is the difference between milliseconds and seconds.
Query **C** is the real API query (customer + their accounts + date range + join to instruments); it uses the same index in a
nested loop. `accounts` is read by sequential scan because it has only 167 rows, so the planner correctly ignores
`accounts_customer_idx` at this size (it becomes useful as the table grows).

## Raw output

```text
ANALYZE
=== A. One account, newest first, first page (WITH the index) ===
                                                                      QUERY PLAN                                                                      
------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.28..29.13 rows=20 width=28) (actual time=0.042..0.132 rows=20 loops=1)
   Buffers: shared hit=3
   ->  Index Scan using transactions_account_date_idx on transactions  (cost=0.28..57.98 rows=40 width=28) (actual time=0.038..0.071 rows=20 loops=1)
         Index Cond: ((account_id)::text = 'A00001'::text)
         Buffers: shared hit=3
 Planning:
   Buffers: shared hit=52
 Planning Time: 0.671 ms
 Execution Time: 0.213 ms
(9 rows)
=== B. The same query WITHOUT the index (dropped inside a transaction, then rolled back) ===
BEGIN
DROP INDEX
                                                      QUERY PLAN                                                       
-----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=108.94..108.99 rows=20 width=28) (actual time=0.830..0.927 rows=20 loops=1)
   Buffers: shared hit=51
   ->  Sort  (cost=108.94..109.04 rows=40 width=28) (actual time=0.825..0.860 rows=20 loops=1)
         Sort Key: trade_date DESC
         Sort Method: quicksort  Memory: 27kB
         Buffers: shared hit=51
         ->  Seq Scan on transactions  (cost=0.00..107.88 rows=40 width=28) (actual time=0.013..0.710 rows=40 loops=1)
               Filter: ((account_id)::text = 'A00001'::text)
               Rows Removed by Filter: 4510
               Buffers: shared hit=51
 Planning:
   Buffers: shared hit=5
 Planning Time: 0.191 ms
 Execution Time: 1.009 ms
(14 rows)
ROLLBACK
=== C. What the API runs: one customer (all their accounts), filtered by date range, page 1 ===
                                                                                QUERY PLAN                                                                                
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=32.44..32.47 rows=12 width=34) (actual time=0.446..0.548 rows=17 loops=1)
   Buffers: shared hit=39
   ->  Sort  (cost=32.44..32.47 rows=12 width=34) (actual time=0.441..0.488 rows=17 loops=1)
         Sort Key: t.trade_date DESC, t.transaction_id DESC
         Sort Method: quicksort  Memory: 26kB
         Buffers: shared hit=39
         ->  Nested Loop  (cost=0.42..32.23 rows=12 width=34) (actual time=0.079..0.381 rows=17 loops=1)
               Buffers: shared hit=39
               ->  Nested Loop  (cost=0.28..30.23 rows=12 width=34) (actual time=0.056..0.178 rows=17 loops=1)
                     Buffers: shared hit=5
                     ->  Seq Scan on accounts a  (cost=0.00..4.09 rows=1 width=7) (actual time=0.025..0.049 rows=1 loops=1)
                           Filter: ((customer_id)::text = 'C0001'::text)
                           Rows Removed by Filter: 166
                           Buffers: shared hit=2
                     ->  Index Scan using transactions_account_date_idx on transactions t  (cost=0.28..26.02 rows=12 width=41) (actual time=0.023..0.056 rows=17 loops=1)
                           Index Cond: (((account_id)::text = (a.account_id)::text) AND (trade_date >= '2026-01-01'::date))
                           Buffers: shared hit=3
               ->  Index Scan using instruments_pkey on instruments i  (cost=0.14..0.17 rows=1 width=12) (actual time=0.006..0.006 rows=1 loops=17)
                     Index Cond: ((instrument_id)::text = (t.instrument_id)::text)
                     Buffers: shared hit=34
 Planning:
   Buffers: shared hit=202
 Planning Time: 3.357 ms
 Execution Time: 0.846 ms
(24 rows)
```
