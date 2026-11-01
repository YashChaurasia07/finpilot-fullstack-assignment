# Decisions, assumptions, omissions and known limitations

## 1. Assumptions

* The seeded data is the whole world: one holdings snapshot (2026-09-18), one latest price per instrument (all dated 2026-09-18),
  one latest risk profile per customer. A newer snapshot loaded later is picked up automatically (`v_positions` always uses the
  latest `snapshot_date`); price history is out of scope.
* "Today" is the server's UTC date. It is used for "future-dated" checks, overdue goals and the freshness badge.
* Staff users (VIEWER / ADMIN) are not customers. Any signed-in staff member may see every customer and edit any customer's goals
  (an internal service tool). Only ADMIN may import data.
* Money is INR. Amounts have 2 decimals, quantities 4. The API sends them as **strings** so no precision is lost in transit.
* A customer is not guaranteed to have a risk profile, accounts, holdings, transactions or goals: every endpoint returns
  `null` / `[]` / zeros for the missing part instead of failing, and the UI has an empty state for each.

## 2. Data-quality findings and how each is handled

Found by profiling the supplied CSVs (not just the ones the data dictionary hints at). The raw files are never edited.

| # | Finding | Count | Handling and reason |
|---|---|---|---|
| 1 | Duplicate `transaction_id` (`T0000026`, identical row) | 1 | First kept, repeat **rejected** `DUPLICATE_ID`. The primary key forbids it anyway; the importer reports it instead of failing. |
| 2 | Unknown instrument `I9999` (`T0004551`) | 1 | **Rejected** `UNKNOWN_INSTRUMENT` (importer check + foreign key). |
| 3 | Negative FEE amount (`T0004552`, −75) | 1 | **Rejected** `NEGATIVE_VALUE` (importer + CHECK constraint). Amounts are gross cash values; the direction comes from the type. |
| 4 | Future trade date 2027-01-05 (`T0004553`) | 1 | **Rejected** `FUTURE_DATE` (later than today). |
| 5 | Duplicate rows in the holdings snapshot (`A00145/I0036`, `A00146/I0010`, `A00147/I0049`) | 3 | First kept, repeats recorded as `DUPLICATE_POSITION`. Keeping both would **double-count AUM**. The composite primary key `(account, instrument, snapshot_date)` makes it impossible in the database. |
| 6 | Transactions dated before their account's `opened_at` | 1,069 (23.5%) | **Accepted** and surfaced by a query (`sql/reviewer_queries.sql` §6c). Rejecting would discard almost a quarter of the ledger; it looks like generator noise, not a data error to quarantine. A deliberate judgement call. |
| 7 | Holdings do not reconcile to net settled BUY/SELL quantity | 0 of 982 match | The **holdings snapshot is the source of truth** for the portfolio; `transactions` is a separate activity ledger. Reconciling them would change nothing the user sees. (§6e) |
| 8 | `goal_name` disagrees with `goal_type` (e.g. an EMERGENCY_FUND named "Primary Retirement") | 149 of 177 | **Not flagged.** 84% false alarms would make a flag meaningless. `goal_type` is used for grouping; `goal_name` is only a label. |
| 9 | No seeded goal is overdue or over-funded (earliest target date 2027-08-14) | 0 | The flags (`OVERDUE`, `OVER_FUNDED`, `COMPLETED`) are implemented and unit/API-tested with their own fixtures. To see one live: `UPDATE goals SET target_date = '2026-01-01' WHERE goal_id = 'G00001';` |
| 10 | Missing relationships: 7 customers without holdings, 12 accounts without holdings (all DORMANT/CLOSED), 116 transactions on CLOSED accounts | | Empty arrays and empty states, never an error. Ledger activity on a closed account is historical, not wrong. |
| 11 | Risk-score ranges overlap between levels (e.g. 50–59 occurs under both Moderate and Growth) | | The supplied `risk_level` is displayed as is; it is not re-derived from the score. |
| 12 | All prices are dated 2026-09-18 (43 days before today) | | Not an error, but users should know: the overview shows snapshot date, price date and an age badge (amber after 7 days). |

## 3. Key design decisions

| Decision | Why |
|---|---|
| React + Vite (SPA), not Next.js | Internal login-only tool: no SEO/SSR need, and the assignment wants a separate API with its own Swagger. One fewer concept to explain. |
| Express + TypeScript | Familiar, small, and Express 5 forwards async errors, so no wrapper code. |
| Drizzle ORM (not Prisma) | Reads like the SQL it generates; schema, CHECK constraints and indexes are plain TypeScript; migrations are readable `.sql` files. The view is hand-written SQL. |
| Natural primary keys (`C0001`, `A00001`, ...) | They are the keys of the source files, readable in URLs and make imports trivial. |
| Portfolio maths in ONE SQL view (`v_positions`) | One place to explain and test; no aggregation in the browser. P&L is derived from the two **rounded** figures, so "market value − cost = P&L" is exact on every row and total (an API test caught a 1–2 cent mismatch in an earlier version). |
| Money as `NUMERIC`, strings in JSON | No floating-point error, ever. Numbers are only formatted at the very last step in the browser. |
| JWT in an httpOnly SameSite=Lax cookie | Page scripts cannot read it, so XSS cannot steal the token. CSRF is handled by SameSite plus an `Origin` allow-list on writes. |
| One uniform response envelope | `{ success, data, meta? }` / `{ success: false, error: { code, message, details?, requestId } }`: the client has one code path for every endpoint and every failure. |
| Imports: validate rows, then one transaction under an advisory lock | Good rows load even if others are bad; bad rows are reported with a reason code; nothing is ever half-saved; two imports can never race. A partial unique index on the file hash blocks double loads but still lets a file that loaded nothing be retried. |
| Rejected rows are stored, not just returned | `import_rejections` keeps the original row and reason for later review (and feeds the data-quality SQL task). |
| Offset pagination | Simple and sufficient at this size; stable ordering (ties broken by ID) keeps pages consistent. |
| Frontend filters live in the URL | Shareable, survives refresh and the Back button; every value is re-validated on read because the URL is untrusted. |

## 4. Deliberately omitted (and why)

* **Staging tables / `COPY`** for imports: validation in memory plus one transaction already gives all-or-nothing and per-row
  reasons; staging only pays off for files far beyond the 50,000-row / 5 MB limit.
* **TLS reverse proxy**: plain HTTP on localhost is allowed; production TLS terminates at a load balancer (see the README).
* **Refresh tokens / token revocation, user management UI, goal deletion, audit trail** for goal edits.
* **Server-side sorting on every column**: only date and amount (the useful ones) are sortable on the large transactions table.
* **Redux / a global store**: server state is TanStack Query, filter state is the URL, nothing else needs sharing.
* **Cloud deployment** (documented only).

## 5. Known limitations

* A JWT cannot be revoked before it expires (8 h); signing out clears the cookie but a copied token would stay valid until expiry.
* There is no CSRF token (SameSite=Lax + `Origin` check instead). Non-browser clients are not subject to either.
* Rate limits are in memory, per API instance.
* The import runs inside the HTTP request (≤ 50,000 rows, a second or two). A very large file would need a background job.
* Concurrent goal edits are serialised by a row lock, but there is no "someone else changed this" notice (no optimistic concurrency token).
* Customer search is `ILIKE '%term%'` (a sequential scan): ideal for 120 customers, not for millions (see below).
* The UI was verified in desktop Chrome (headless) at 1280, 768 and 375 px widths, and component-tested; it has not been manually run on Safari/Firefox.

## 6. Scale limits and what to do next

| Area | Limit today | Next step |
|---|---|---|
| **Performance bottleneck** | Customer search (`ILIKE '%x%'`) scans the table, and `OFFSET` paging gets slower on deep pages | `pg_trgm` GIN index for search; keyset ("seek") pagination for the transactions ledger; materialise per-customer AUM if dashboards get heavy |
| **Security risk** | Tokens cannot be revoked; no CSRF token; one shared DB role | Short-lived access token + refresh token with a deny-list; double-submit CSRF token; separate migrator (DDL) and app (DML-only) database roles; secret manager |
| **Reliability risk** | One PostgreSQL instance; import work happens in the request; backups are not automated or restore-tested here | Managed Postgres with PITR and a tested restore; move imports to a queue/worker with progress; run ≥ 2 API instances (the rate limiter then needs a shared store such as Redis) |
| Observability | JSON logs and request IDs only | Ship logs to a central store, add metrics (request rate, error rate, latency, pool usage) and alerts on 5xx and `/health` |
