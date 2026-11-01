import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { API, expectFailure, expectSuccess, pool, signIn } from '../helpers';

const app = createApp();
const URL = `${API}/admin/imports/transactions`;
const BOM = String.fromCharCode(0xfeff); // UTF-8 byte order mark, as Excel writes it
const HEADER = 'transaction_id,account_id,instrument_id,transaction_type,trade_date,quantity,price,amount,status';
let admin: Awaited<ReturnType<typeof signIn>>;

const row = (over: Record<string, string> = {}) => ({
  transaction_id: 'TX000001', account_id: 'A00002', instrument_id: 'I0046', transaction_type: 'BUY',
  trade_date: '2026-09-10', quantity: '10', price: '140.20', amount: '1402.00', status: 'SETTLED', ...over,
});
const toCsv = (rows: Record<string, string>[], opts: { header?: string; eol?: string; bom?: boolean } = {}) =>
  `${opts.bom ? BOM : ''}${[opts.header ?? HEADER, ...rows.map((r) => Object.values(r).join(','))].join(opts.eol ?? '\n')}\n`;

const upload = (content: string | Buffer, name = 'test-upload.csv', field = 'file') =>
  admin.post(URL).attach(field, Buffer.isBuffer(content) ? content : Buffer.from(content), { filename: name, contentType: 'text/csv' });

type Result = { batchId: number; totalRows: number; importedRows: number; rejectedRows: number; truncated: boolean; rejections: { rowNumber: number; recordKey: string | null; code: string; detail: string }[] };
const codes = (r: Result) => r.rejections.map((x) => x.code);

beforeAll(async () => {
  admin = await signIn(app, 'admin');
});
afterEach(async () => {
  // remove everything these tests created (transactions first: they reference their batch)
  await pool.query(`delete from transactions where transaction_id like 'TX%' or transaction_id like 'T9%' or import_batch_id in (select id from import_batches where file_name like 'test-%' or file_name like 'transactions_demo%')`);
  await pool.query(`delete from import_batches where file_name like 'test-%' or file_name like 'transactions_demo%'`);
});

describe('the demo file (data/samples/transactions_demo_upload.csv)', () => {
  it('imports the 3 good rows and rejects the 8 bad ones, each with its own reason', async () => {
    const csv = readFileSync(path.join(__dirname, '../../../data/samples/transactions_demo_upload.csv'));
    const res = await upload(csv, 'transactions_demo_upload.csv').expect(201);
    const r = expectSuccess(res.body) as Result;
    expect(r).toMatchObject({ totalRows: 11, importedRows: 3, rejectedRows: 8, truncated: false });
    expect(r.rejections).toEqual([
      { rowNumber: 5, recordKey: 'T9000004', code: 'UNKNOWN_INSTRUMENT', detail: 'instrument_id = I9999 does not exist' },
      { rowNumber: 6, recordKey: 'T9000005', code: 'UNKNOWN_ACCOUNT', detail: 'account_id = A99999 does not exist' },
      { rowNumber: 7, recordKey: 'T9000006', code: 'FUTURE_DATE', detail: expect.stringContaining('trade_date = 2099-01-01') },
      { rowNumber: 8, recordKey: 'T9000007', code: 'NEGATIVE_VALUE', detail: 'amount = -25.00 — must not be negative' },
      { rowNumber: 9, recordKey: 'T9000008', code: 'INVALID_ENUM', detail: expect.stringContaining('transaction_type = TRANSFER') },
      { rowNumber: 10, recordKey: 'T0000001', code: 'DUPLICATE_ID', detail: expect.stringContaining('already exists') },
      { rowNumber: 11, recordKey: 'T9000009', code: 'INVALID_DATE', detail: expect.stringContaining('trade_date = 31-02-2026') },
      { rowNumber: 12, recordKey: 'T9000010', code: 'INVALID_NUMBER', detail: expect.stringContaining('quantity = abc') },
    ]);

    // the good rows are in, tagged with their batch; the bad ones are not
    const { rows } = await pool.query('select transaction_id from transactions where import_batch_id = $1 order by 1', [r.batchId]);
    expect(rows.map((x) => x.transaction_id)).toEqual(['T9000001', 'T9000002', 'T9000003']);
    // and every rejection is stored for later review, with the original row
    const stored = await pool.query('select code, raw_row from import_rejections where batch_id = $1 and record_key = $2', [r.batchId, 'T9000004']);
    expect(stored.rows[0]).toMatchObject({ code: 'UNKNOWN_INSTRUMENT', raw_row: { transaction_id: 'T9000004', instrument_id: 'I9999' } });
  });

  it('uploading the same file again is refused (409) and loads nothing', async () => {
    const csv = readFileSync(path.join(__dirname, '../../../data/samples/transactions_demo_upload.csv'));
    const first = (await upload(csv, 'transactions_demo_upload.csv').expect(201)).body.data as Result;
    const again = await upload(csv, 'renamed-copy.csv').expect(409); // a different file NAME does not fool it: the content is hashed
    const error = expectFailure(again.body, 'ALREADY_IMPORTED');
    expect(error.details).toMatchObject({ batchId: first.batchId });
    expect(error.message).toContain(`#${first.batchId}`);
    expect((await pool.query(`select count(*)::int n from transactions where transaction_id like 'T9%'`)).rows[0].n).toBe(3);
  });
});

describe('the supplied transactions.csv (already loaded by the seed)', () => {
  it('is refused as a duplicate load', async () => {
    const csv = readFileSync(path.join(__dirname, '../../../data/transactions.csv'));
    const res = await upload(csv, 'transactions.csv').expect(409);
    expectFailure(res.body, 'ALREADY_IMPORTED');
  });

  it('was loaded by the seed with the four deliberate anomalies rejected and recorded', async () => {
    const { rows } = await pool.query(`select imported_rows, rejected_rows, total_rows from import_batches where file_name = 'transactions.csv'`);
    expect(rows[0]).toEqual({ imported_rows: 4550, rejected_rows: 4, total_rows: 4554 });
    const rej = await pool.query(
      `select r.record_key, r.code from import_rejections r join import_batches b on b.id = r.batch_id where b.file_name = 'transactions.csv' order by r.row_number`,
    );
    expect(rej.rows).toEqual([
      { record_key: 'T0000026', code: 'DUPLICATE_ID' },
      { record_key: 'T0004551', code: 'UNKNOWN_INSTRUMENT' },
      { record_key: 'T0004552', code: 'NEGATIVE_VALUE' },
      { record_key: 'T0004553', code: 'FUTURE_DATE' },
    ]);
  });
});

describe('row-level rules', () => {
  it('accepts CRLF line endings, a UTF-8 BOM, shouty/padded headers, extra columns, quotes and padding', async () => {
    const lines = [
      ' Transaction_ID , ACCOUNT_ID,instrument_id,transaction_type,trade_date,quantity,price,amount,status,notes',
      '"TX000001", A00002 ,I0046,BUY,2026-09-10,10,140.20,1402.00,SETTLED,"first, with a comma"',
      'TX000002,A00002,I0046,SELL,2026-09-11,5,141.00,705.00,PENDING,',
    ];
    const res = await upload(`${BOM}${lines.join('\r\n')}\r\n`).expect(201);
    expect(res.body.data).toMatchObject({ totalRows: 2, importedRows: 2, rejectedRows: 0 });
  });

  it('keeps the first of two identical/different rows with the same id and says which row it repeated', async () => {
    const csv = toCsv([row(), row(), row({ amount: '9999.00' }), row({ transaction_id: 'TX000002' })]);
    const r = (await upload(csv).expect(201)).body.data as Result;
    expect(r).toMatchObject({ totalRows: 4, importedRows: 2, rejectedRows: 2 });
    expect(r.rejections).toEqual([
      { rowNumber: 3, recordKey: 'TX000001', code: 'DUPLICATE_ID', detail: 'repeats row 2 (identical); the first occurrence is kept' },
      { rowNumber: 4, recordKey: 'TX000001', code: 'DUPLICATE_ID', detail: 'repeats row 2 (different values); the first occurrence is kept' },
    ]);
    expect((await pool.query(`select amount from transactions where transaction_id = 'TX000001'`)).rows[0].amount).toBe('1402.00'); // first one wins
  });

  it('never overwrites an existing transaction, and an all-rejected file can be retried', async () => {
    const csv = toCsv([row({ transaction_id: 'T0000001', amount: '1.00' })]); // an id that already exists
    const first = (await upload(csv).expect(201)).body.data as Result;
    expect(first).toMatchObject({ importedRows: 0, rejectedRows: 1 });
    expect(codes(first)).toEqual(['DUPLICATE_ID']);
    expect((await pool.query(`select amount from transactions where transaction_id = 'T0000001'`)).rows[0].amount).toBe('6191.15'); // untouched
    await upload(csv).expect(201); // imported nothing, so the same file may be tried again (e.g. after fixing reference data)
  });

  it('reports a short row (missing columns) as a rejection instead of failing the file', async () => {
    const csv = `${HEADER}\nTX000001,A00002,I0046,BUY,2026-09-10,10\n${Object.values(row({ transaction_id: 'TX000002' })).join(',')}\n`;
    const r = (await upload(csv).expect(201)).body.data as Result;
    expect(r).toMatchObject({ importedRows: 1, rejectedRows: 1 });
    expect(r.rejections[0]).toMatchObject({ rowNumber: 2, code: 'MISSING_VALUE', detail: 'price = (empty)' });
  });

  it('row numbers are real spreadsheet rows even with blank lines in the file', async () => {
    const csv = `${HEADER}\n${Object.values(row()).join(',')}\n\n\n${Object.values(row({ transaction_id: 'TX000002', status: 'NOPE' })).join(',')}\n`;
    const r = (await upload(csv).expect(201)).body.data as Result;
    expect(r.rejections).toEqual([expect.objectContaining({ rowNumber: 5, code: 'INVALID_ENUM', recordKey: 'TX000002' })]);
  });

  it('big files are chunked correctly (3,000 rows)', async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => row({ transaction_id: `TX${String(i).padStart(6, '0')}` }));
    const r = (await upload(toCsv(rows), 'test-big.csv').expect(201)).body.data as Result;
    expect(r).toMatchObject({ totalRows: 3000, importedRows: 3000, rejectedRows: 0 });
    expect((await pool.query(`select count(*)::int n from transactions where transaction_id like 'TX%'`)).rows[0].n).toBe(3000);
  });

  it('stores every rejection but returns at most 1,000 (flagged as truncated)', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row({ transaction_id: `TX${String(i).padStart(6, '0')}`, status: 'BAD' }));
    const r = (await upload(toCsv(rows), 'test-allbad.csv').expect(201)).body.data as Result;
    expect(r).toMatchObject({ totalRows: 1200, importedRows: 0, rejectedRows: 1200, truncated: true });
    expect(r.rejections).toHaveLength(1000);
    expect((await pool.query('select count(*)::int n from import_rejections where batch_id = $1', [r.batchId])).rows[0].n).toBe(1200);
  });
});

describe('whole-file problems -> 400/413, nothing written', () => {
  const expectNothingWritten = async () =>
    expect((await pool.query(`select count(*)::int n from import_batches where file_name like 'test-%'`)).rows[0].n).toBe(0);

  it.each([
    ['empty file', '', 'EMPTY_FILE'],
    ['header only', `${HEADER}\n`, 'NO_DATA_ROWS'],
    ['whitespace only', '   \n \n', 'MISSING_COLUMNS'],
    ['missing columns', 'transaction_id,account_id\nT1,A1\n', 'MISSING_COLUMNS'],
    ['semicolon separated', HEADER.replace(/,/g, ';') + '\nTX1;A00002;I0046;BUY;2026-09-10;1;1;1;SETTLED\n', 'MISSING_COLUMNS'],
    ['duplicate header names', `${HEADER},amount\nTX1,A00002,I0046,BUY,2026-09-10,1,1,1,SETTLED,1\n`, 'INVALID_CSV'],
    ['unbalanced quote', `${HEADER}\n"TX1,A00002,I0046,BUY,2026-09-10,1,1,1,SETTLED\n`, 'INVALID_CSV'],
    ['binary content', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x01, 0x02]), 'INVALID_FILE'],
    ['UTF-16 text', Buffer.from(`${BOM}${HEADER}\n`, 'utf16le'), 'INVALID_FILE'],
  ])('%s', async (_label, content, code) => {
    expectFailure((await upload(content, 'test-bad.csv').expect(400)).body, code);
    await expectNothingWritten();
  });

  it('names the missing columns and hints at the wrong delimiter', async () => {
    const res = await upload('transaction_id;account_id\nT1;A1\n', 'test-semi.csv').expect(400);
    const error = expectFailure(res.body, 'MISSING_COLUMNS');
    expect(error.message).toMatch(/semicolon/i);
    expect((error.details as { missing: string[] }).missing).toContain('instrument_id');
  });

  it('rejects more than 50,000 rows', async () => {
    const line = Object.values(row()).join(',');
    const res = await upload(`${HEADER}\n${Array(50_001).fill(line).join('\n')}\n`, 'test-huge.csv').expect(400);
    expectFailure(res.body, 'TOO_MANY_ROWS');
  });

  it('413 for a file over 5 MB', async () => {
    expectFailure((await upload(Buffer.alloc(5 * 1024 * 1024 + 1024, 'a'), 'test-5mb.csv').expect(413)).body, 'PAYLOAD_TOO_LARGE');
  });

  it('400 when no file is attached, the field is misnamed, or the type is wrong', async () => {
    expectFailure((await admin.post(URL).expect(400)).body, 'FILE_REQUIRED');
    expectFailure((await admin.post(URL).send({ file: 'x' }).expect(400)).body, 'FILE_REQUIRED');
    expectFailure((await upload(toCsv([row()]), 'test-x.csv', 'document').expect(400)).body, 'UNEXPECTED_FIELD');
    expectFailure((await upload(toCsv([row()]), 'test-x.txt').expect(400)).body, 'INVALID_FILE_TYPE');
    expectFailure((await upload(toCsv([row()]), 'test-x.csv.exe').expect(400)).body, 'INVALID_FILE_TYPE');
    expectFailure((await admin.post(URL).attach('file', Buffer.from('a'), 'a.csv').attach('file', Buffer.from('b'), 'b.csv').expect(400)).body, 'TOO_MANY_FILES');
    await expectNothingWritten();
  });

  it('a path in the uploaded file name is reduced to the bare name', async () => {
    const r = (await upload(toCsv([row()]), '../../etc/test-passwd.csv').expect(201)).body.data as Result;
    expect(r.rejectedRows).toBe(0);
    expect((await pool.query('select file_name from import_batches where id = $1', [r.batchId])).rows[0].file_name).toBe('test-passwd.csv');
  });
});

describe('concurrency', () => {
  it('two simultaneous uploads of the SAME file: one loads it, the other gets 409', async () => {
    const csv = toCsv([row(), row({ transaction_id: 'TX000002' })]);
    const [a, b] = await Promise.all([upload(csv, 'test-a.csv'), upload(csv, 'test-b.csv')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await pool.query(`select count(*)::int n from transactions where transaction_id like 'TX%'`)).rows[0].n).toBe(2);
  });

  it('two simultaneous uploads containing the same new ids: each id is loaded exactly once, nothing crashes', async () => {
    const a = toCsv([row(), row({ transaction_id: 'TX000002' })]);
    const b = toCsv([row({ amount: '1.00' }), row({ transaction_id: 'TX000003' })]);
    const [ra, rb] = await Promise.all([upload(a, 'test-a.csv'), upload(b, 'test-b.csv')]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    const imported = (ra.body.data as Result).importedRows + (rb.body.data as Result).importedRows;
    expect(imported).toBe(3); // TX000001 once, TX000002 once, TX000003 once
    expect((await pool.query(`select count(*)::int n from transactions where transaction_id like 'TX%'`)).rows[0].n).toBe(3);
  });
});

describe('access control', () => {
  it('a viewer is refused (403) before any file is read', async () => {
    const viewer = await signIn(app, 'viewer');
    expectFailure((await viewer.post(URL).attach('file', Buffer.from(toCsv([row()])), 'test-v.csv').expect(403)).body, 'FORBIDDEN');
    expect((await pool.query(`select count(*)::int n from transactions where transaction_id like 'TX%'`)).rows[0].n).toBe(0);
  });
});
