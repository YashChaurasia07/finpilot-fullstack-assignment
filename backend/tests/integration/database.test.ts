import { describe, expect, it } from 'vitest';
import { pool } from '../helpers';
import { ADMIN } from '../testEnv';

/** Runs a statement that should be refused by PostgreSQL and returns its SQLSTATE code. */
async function sqlState(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await pool.query(sql, params);
  } catch (err) {
    return (err as { code: string }).code;
  }
  throw new Error(`Expected the database to refuse: ${sql}`);
}

const FK_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

describe('seed result (loaded from the supplied CSVs, which are never edited)', () => {
  it.each([
    ['customers', 120],
    ['risk_profiles', 120],
    ['accounts', 167],
    ['instruments', 80],
    ['holdings', 982], // 985 rows in the file, 3 identical duplicates rejected
  ])('%s has %i rows', async (table, expected) => {
    expect((await pool.query(`select count(*)::int n from ${table}`)).rows[0].n).toBe(expected);
  });

  it('records the duplicate holdings rows as data-quality exceptions', async () => {
    const { rows } = await pool.query(
      `select r.record_key, r.code from import_rejections r join import_batches b on b.id = r.batch_id where b.dataset = 'holdings'`,
    );
    expect(rows.map((r) => r.record_key).sort()).toEqual(['A00145/I0036', 'A00146/I0010', 'A00147/I0049']);
    expect(rows.every((r) => r.code === 'DUPLICATE_POSITION')).toBe(true);
  });
});

describe('PostgreSQL enforces the rules itself, whatever the application does', () => {
  it('rejects a negative transaction amount (the negative FEE in the data)', async () => {
    expect(await sqlState(`insert into transactions values ('TDB0001','A00002','I0046','FEE','2026-01-01',0,0,-75,'SETTLED')`)).toBe(CHECK_VIOLATION);
  });
  it('rejects a duplicate transaction id', async () => {
    expect(await sqlState(`insert into transactions values ('T0000001','A00002','I0046','FEE','2026-01-01',0,0,1,'SETTLED')`)).toBe(UNIQUE_VIOLATION);
  });
  it('rejects an unknown instrument and an unknown account (foreign keys)', async () => {
    expect(await sqlState(`insert into transactions values ('TDB0002','A00002','I9999','BUY','2026-01-01',1,1,1,'SETTLED')`)).toBe(FK_VIOLATION);
    expect(await sqlState(`insert into transactions values ('TDB0003','A99999','I0046','BUY','2026-01-01',1,1,1,'SETTLED')`)).toBe(FK_VIOLATION);
  });
  it('rejects a duplicate position in the holdings snapshot', async () => {
    expect(await sqlState(`insert into holdings values ('A00145','I0036','2026-09-18',1,1)`)).toBe(UNIQUE_VIOLATION);
  });
  it('rejects values outside their enum', async () => {
    expect(await sqlState(`insert into transactions values ('TDB0004','A00002','I0046','TRANSFER','2026-01-01',1,1,1,'SETTLED')`)).toBe('22P02');
  });
  it('rejects bad ranges: risk score, goal amounts, quantity', async () => {
    expect(await sqlState(`update risk_profiles set risk_score = 101 where customer_id = 'C0001'`)).toBe(CHECK_VIOLATION);
    expect(await sqlState(`insert into goals (customer_id, goal_type, goal_name, target_amount, current_funded_amount, target_date, priority) values ('C0001','TRAVEL','x',0,0,'2030-01-01','LOW')`)).toBe(CHECK_VIOLATION);
    expect(await sqlState(`insert into goals (customer_id, goal_type, goal_name, target_amount, current_funded_amount, target_date, priority) values ('C0001','TRAVEL','x',10,-1,'2030-01-01','LOW')`)).toBe(CHECK_VIOLATION);
    expect(await sqlState(`update holdings set quantity = 0 where account_id = 'A00002' and instrument_id = 'I0046'`)).toBe(CHECK_VIOLATION);
  });
  it('rejects a goal for a customer that does not exist', async () => {
    expect(await sqlState(`insert into goals (customer_id, goal_type, goal_name, target_amount, current_funded_amount, target_date, priority) values ('C9999','TRAVEL','x',10,1,'2030-01-01','LOW')`)).toBe(FK_VIOLATION);
  });
  it('keeps user emails lower-case and unique', async () => {
    expect(await sqlState(`insert into users (email, password_hash, full_name) values ($1,'x','x')`, [ADMIN.email.toUpperCase()])).toBe(CHECK_VIOLATION);
    expect(await sqlState(`insert into users (email, password_hash, full_name) values ($1,'x','x')`, [ADMIN.email])).toBe(UNIQUE_VIOLATION);
  });
  it('rejects overflowing and over-long values', async () => {
    expect(await sqlState(`insert into transactions values ('TDB0005','A00002','I0046','BUY','2026-01-01',1,1,1e20,'SETTLED')`)).toBe('22003');
    expect(await sqlState(`insert into transactions values ('TDB0006-way-too-long','A00002','I0046','BUY','2026-01-01',1,1,1,'SETTLED')`)).toBe('22001');
  });
  it('import bookkeeping stays consistent: counts add up; only a file that loaded something is unique', async () => {
    const insert = (dataset: string, sha: string, imported: number, rejected: number, total: number) =>
      sqlState(`insert into import_batches (dataset, file_name, file_sha256, total_rows, imported_rows, rejected_rows) values ($1,'test-db.csv',$2,$3,$4,$5)`, [dataset, sha, total, imported, rejected]);
    const sha = 'f'.repeat(64);
    try {
      expect(await insert('transactions', sha, 5, 4, 10)).toBe(CHECK_VIOLATION); // 5 + 4 != 10
      await pool.query(`insert into import_batches (dataset, file_name, file_sha256, total_rows, imported_rows, rejected_rows) values ('transactions','test-db.csv',$1,3,0,3), ('transactions','test-db.csv',$1,3,0,3)`, [sha]); // nothing imported: may repeat
      await pool.query(`insert into import_batches (dataset, file_name, file_sha256, total_rows, imported_rows, rejected_rows) values ('transactions','test-db.csv',$1,3,2,1)`, [sha]);
      expect(await insert('transactions', sha, 2, 1, 3)).toBe(UNIQUE_VIOLATION); // already loaded
    } finally {
      await pool.query(`delete from import_batches where file_name = 'test-db.csv'`);
    }
  });
  it('a batch cannot be deleted while loaded transactions still point at it', async () => {
    const { rows } = await pool.query(`select id from import_batches where file_name = 'transactions.csv'`);
    expect(await sqlState(`delete from import_batches where id = $1`, [rows[0].id])).toBe(FK_VIOLATION);
  });
});

describe('v_positions view', () => {
  it('has one row per holding of the current snapshot', async () => {
    const { rows } = await pool.query(`select (select count(*) from v_positions)::int v, (select count(*) from holdings)::int h`);
    expect(rows[0]).toEqual({ v: 982, h: 982 });
  });

  it('its figures reconcile to the cent on every row and for every customer', async () => {
    const bad = await pool.query(
      `select count(*)::int n from v_positions
        where market_value <> round(quantity * last_price, 2)
           or cost_value <> round(quantity * avg_cost, 2)
           or unrealised_pnl <> market_value - cost_value`,
    );
    expect(bad.rows[0].n).toBe(0);
  });

  it('only shows the latest snapshot when several exist', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`insert into holdings values ('A00002','I0001','2026-10-01',5,100)`); // a NEWER snapshot with one position
      const { rows } = await client.query(`select count(*)::int n, min(snapshot_date)::text d from v_positions`);
      expect(rows[0]).toEqual({ n: 1, d: '2026-10-01' });
    } finally {
      await client.query('rollback'); // leave the data untouched
      client.release();
    }
  });
});
