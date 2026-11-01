# FinPilot: Investment Portfolio & Goal Monitoring

A small, production-minded web app for a wealth-service team. Search a customer, see their portfolio value, asset allocation,
positions, transactions, risk profile and financial goals, maintain goals, and (as an administrator) import transaction CSVs safely.
**All data is synthetic.**

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, TanStack Query, Recharts |
| Backend | Node 24, Express 5, TypeScript, Zod, JWT cookie auth, pino logging |
| Database | PostgreSQL 17 via Drizzle ORM (SQL migrations, a view, constraints, indexes) |
| Ops | Docker Compose (`db`, `api`, `web`/nginx), GitHub Actions CI |

## Quick start (one command)

Requires Docker (or Podman with `docker compose`).

```bash
cp .env.example .env
docker compose up --build
```

Wait until the logs show `FinPilot API listening`, then open **http://localhost:3000**.

On first start the API container applies the database migrations and loads the supplied CSVs (the seed is idempotent, so
restarting is safe).

| What | URL |
|---|---|
| Web app | http://localhost:3000 |
| API base | http://localhost:8000/api/v1 |
| **Swagger UI** (OpenAPI docs) | http://localhost:8000/api/v1/docs |
| OpenAPI file | http://localhost:8000/api/v1/openapi.yaml (also `backend/openapi.yaml`) |
| Health check | http://localhost:8000/api/v1/health |
| PostgreSQL | `localhost:5432` (user/password/db from `.env`) |

### Demo accounts (synthetic)

Two demo users are created on first start from the `SEED_VIEWER_*` and `SEED_ADMIN_*` lines of your `.env`
(the file you made with `cp .env.example .env`). Open `.env` to see the email and password for each role.

| Role | Can do |
|---|---|
| VIEWER | Everything except CSV import |
| ADMIN | Everything, including **Data import** |

### Two-minute tour

1. Sign in as the viewer, search **sharma**, open a customer (try **C0002**).
2. **Overview**: total value, gain/loss, accounts, allocation chart, risk profile, goals, and how old the price data is.
3. **Portfolio**, **Transactions** (server-side filters, sorting and paging; pending/reversed rows are marked), **Goals** (add / edit).
4. Sign in as the admin → **Data import** → upload `data/samples/transactions_demo_upload.csv`: 3 rows import, 8 are rejected, each with its reason.
   Upload it again to see the duplicate-load protection.

## Running without Docker (development)

```bash
docker compose up -d db                    # just the database
cd backend  && npm ci && npm run db:migrate && npm run seed && npm run dev    # API on :8000
cd frontend && npm ci && npm run dev                                          # web on :3000 (proxies /api to :8000)
```

Node 22.12+ (24 recommended). Both apps read the repo-root `.env` (backend) or need nothing (frontend).

## Configuration

Copy `.env.example` to `.env` (git-ignored). Nothing secret is committed.

| Variable | Purpose |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | The database container. Keep the password URL-safe (letters, digits, `_`, `-`). |
| `DATABASE_URL` | Used when the API runs on your machine. Compose overrides the host with `db`. |
| `JWT_SECRET` | Signs session tokens. **32+ characters; use a random value** (`openssl rand -hex 32`). The API refuses to start without it. |
| `JWT_EXPIRES_HOURS` | Session lifetime (default 8). |
| `COOKIE_SECURE` | `true` only when served over HTTPS. |
| `CORS_ORIGINS` | Browser origins allowed to call the API (also the allow-list for POST/PATCH, a CSRF defence). |
| `TRUST_PROXY` | Number of reverse proxies in front of the API (Compose sets 1). |
| `API_RATE_LIMIT_PER_MIN`, `LOGIN_RATE_LIMIT_MAX` | Throttling (login: 10 attempts / 15 min / IP). |
| `DATA_DIR`, `SEED_ON_START` | Where the CSVs are, and whether the API container loads demo data on start. |
| `SEED_*_EMAIL` / `SEED_*_PASSWORD` | The two demo users. |

## Database

* **Schema** lives in `backend/src/db/schema.ts` (10 tables, enums, primary/foreign/unique/CHECK constraints, indexes).
  SQL migrations are generated into `backend/drizzle/` and committed. `0001_positions_view.sql` is a hand-written view,
  `v_positions`, that does all portfolio maths (market value, cost, unrealised P&L).
* **Create from a clean database:** `docker compose down -v && docker compose up --build` (or `npm run db:migrate && npm run seed`).
* **Migrations on start-up:** the API container runs `node dist/db/migrate.js` before serving. All pending migrations run in
  **one transaction**, so a failing migration leaves nothing half-applied and the container exits with the error (the API never
  starts against a wrong schema). **Rollback strategy:** migrations are forward-only; fix forward with a new corrective migration
  (`npm run db:generate` after editing the schema). Locally, `docker compose down -v` resets everything. In production, take a
  backup/snapshot before migrating and use expand/contract steps for breaking changes.
* **Change the schema:** edit `schema.ts`, run `npm run db:generate`, read the generated SQL, commit it.
* **Look inside:** `set -a; . ./.env; set +a; PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U "$POSTGRES_USER" -d "$POSTGRES_DB"` (uses the values from your `.env`).
* **The reviewer SQL tasks** (top 10 AUM, allocation, monthly net flows, top instruments by holders, goals under 25 % funded,
  data-quality exceptions) are in [`sql/reviewer_queries.sql`](sql/reviewer_queries.sql); output is saved in
  [`docs/evidence/`](docs/evidence/). `EXPLAIN (ANALYZE, BUFFERS)` evidence for the transactions index is in
  [`docs/evidence/explain-analyze.md`](docs/evidence/explain-analyze.md) (`sql/explain_transactions.sql` reproduces it).

### Connection pooling, backups, credentials (production notes)

* **Pooling:** the API uses a `pg` pool (max 10, 5 s connect timeout, 10 s statement timeout). At scale put PgBouncer (transaction mode) in front.
* **Backups:** locally `docker compose exec db pg_dump -U finpilot finpilot > backup.sql`. In production use managed automated backups with point-in-time recovery, and test restores.
* **Credentials:** `.env` locally; in production a secrets manager, a least-privilege app role (DML only) separate from a migration role (DDL), and rotation of `JWT_SECRET`.

## Data import and data quality

The supplied CSVs are **never edited**. They are loaded by the import pipeline, which finds the deliberate problems:

| Problem in the data | Handling |
|---|---|
| Duplicate transaction `T0000026` | First kept, the repeat rejected `DUPLICATE_ID` |
| Transaction `T0004551` refers to instrument `I9999` | Rejected `UNKNOWN_INSTRUMENT` |
| `T0004552` is a FEE of −75 | Rejected `NEGATIVE_VALUE` |
| `T0004553` is dated 2027-01-05 | Rejected `FUTURE_DATE` |
| 3 duplicate rows in the holdings snapshot | First kept, repeats recorded as `DUPLICATE_POSITION` (otherwise AUM would be double-counted) |

Every rejected row is stored in `import_rejections` with its reason and the original row (`sql/reviewer_queries.sql` §6a lists them).
Full reasoning, including problems that are *accepted* on purpose, is in [DECISIONS.md](DECISIONS.md).

Import rules (admin endpoint and seed share one code path): rows are validated individually (types, enums, real dates, no future
dates, non-negative numbers with no silent rounding); references must exist; existing data is **never overwritten**; the same
file cannot be loaded twice (content hash); everything is saved in **one transaction** under a lock (all or nothing, no races).

```bash
# Upload with curl (admin session cookie required). First load the demo admin login from your .env:
set -a; . ./.env; set +a
curl -c jar.txt -H 'Content-Type: application/json' \
     -d "{\"email\":\"$SEED_ADMIN_EMAIL\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" http://localhost:8000/api/v1/auth/login
curl -b jar.txt -F file=@data/samples/transactions_demo_upload.csv http://localhost:8000/api/v1/admin/imports/transactions
```

To repeat the demo upload, remove its batch first:

```sql
DELETE FROM transactions WHERE import_batch_id IN (SELECT id FROM import_batches WHERE file_name = 'transactions_demo_upload.csv');
DELETE FROM import_batches WHERE file_name = 'transactions_demo_upload.csv';
```

## API

13 endpoints under `/api/v1`, documented in Swagger UI and `backend/openapi.yaml`.

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login`, `/auth/logout` | public |
| GET | `/auth/me` | signed in |
| GET | `/customers`, `/customers/{id}`, `/customers/{id}/portfolio`, `/customers/{id}/transactions`, `/customers/{id}/goals` | signed in |
| POST | `/customers/{id}/goals` | signed in |
| PATCH | `/goals/{goalId}` | signed in |
| GET | `/instruments` | signed in |
| POST | `/admin/imports/transactions` | ADMIN |
| GET | `/health` | public |

**Every response uses one envelope.** Success: `{ "success": true, "data": …, "meta": { page, pageSize, total, totalPages } }`
(`meta` only on paginated lists). Failure: `{ "success": false, "error": { "code", "message", "details"?, "requestId" } }`
with an appropriate status (400, 401, 403, 404, 409, 413, 415, 429, 500, 503) and never a stack trace.
Money and quantities are exact decimal **strings**; dates are `YYYY-MM-DD`.

**Auth:** a signed JWT in an **httpOnly, SameSite=Lax cookie** (not readable by page scripts, so XSS cannot steal it). Writes
also require an allow-listed `Origin`. In Swagger UI call `POST /auth/login` first. With curl use `-c jar.txt` / `-b jar.txt`.

## Tests, lint, build

```bash
docker compose up -d db                    # backend tests need PostgreSQL and read their credentials from your .env
cd backend  && npm test && npm run lint && npm run typecheck && npm run build
cd frontend && npm test && npm run lint && npm run typecheck && npm run build
```

* **No credentials are written in the test code or the CI workflow.** Locally the tests read `.env`; in CI the workflow generates
  random throwaway credentials for every run, and the CI database container needs no password. Each test run recreates its own
  `finpilot_test` database, so nothing is left over from earlier runs.
* Backend: **309 tests**: unit (row validation, goal rules, error mapping), API (auth, roles, every endpoint, every error path,
  pagination/filters, import edge cases, concurrency) and database (constraints, the view, index use), all against real PostgreSQL.
* Frontend: **82 tests**: formatting, URL-parameter handling, the API client, loading/error/empty states, forms, chart accessibility, the sign-in flow.

## CI/CD

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request: **install → lint → typecheck → test → build**
for both apps (with a PostgreSQL service container), `npm audit` on production dependencies, then a **deployment smoke test**:
`docker compose up --wait` and requests through nginx → API → PostgreSQL. Any failing step fails the pipeline.
"Deploy" locally is `docker compose up --build`.

## Branching and releases

```
feat/*  --pull request-->  dev  --pull request-->  staging  --pull request-->  main
        (one feature)      (integration)           (pre-release: full CI +      (release)
                                                    Compose smoke test)
```

Work is done on short-lived `feat/*` branches and merged into `dev` by pull request. `dev` is promoted to `staging`, where the whole
pipeline must be green, and only then is `staging` promoted to `main`. Every pull request is merged with a **merge commit** (no
squashing), so the individual commits stay visible in the history.

## Observability

Structured JSON logs (pino): one line per request with a **request id** (also returned as `X-Request-Id`, forwarded by nginx and
included in every error body), import outcomes with counts, and full stack traces only in the server log. Credentials and cookies
are redacted; request bodies and PII are never logged. Health checks are excluded from request logs.

## Mapping to production

Static web files → CDN or a container; API → a container service (ECS/Cloud Run/Kubernetes) behind a load balancer that
terminates TLS (ACM / Let's Encrypt) and sets `COOKIE_SECURE=true` and `TRUST_PROXY`; PostgreSQL → managed service (RDS / Cloud SQL)
with backups and a read replica when needed; secrets in a secrets manager; CI builds and pushes images, then deploys. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the submitted report as a 9-page PDF: [docs/FinPilot_Architecture_Report.pdf](docs/FinPilot_Architecture_Report.pdf)).

## Project layout

```
backend/    Express API: routes (HTTP) → services (rules + SQL) → PostgreSQL; schema, migrations, seed, tests, openapi.yaml
frontend/   React app: pages, reusable components, typed API layer, tests; nginx.conf for the container
data/       The supplied CSVs, untouched, plus samples/transactions_demo_upload.csv
sql/        Reviewer SQL tasks and the EXPLAIN script
docs/       Architecture report (Markdown + PDF), evidence (EXPLAIN output, query results), the original assignment
```

## Troubleshooting

* **Podman instead of Docker:** `systemctl --user enable --now podman.socket`; the Compose file uses fully-qualified image names so it works with both.
* **Port already in use:** stop whatever uses 3000 / 8000 / 5432, or change the published ports in `docker-compose.yml`.
* **"Origin not allowed" (403) on POST:** open the app via `http://localhost:3000` or add your origin to `CORS_ORIGINS`.
* **Locked out by rate limiting:** wait 15 minutes or restart the API container.
* **Start completely fresh:** `docker compose down -v && docker compose up --build`.
