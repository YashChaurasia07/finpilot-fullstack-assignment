import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useImportTransactions } from '../api/hooks';
import type { ImportResult, Rejection } from '../api/types';
import { Badge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { StatCard } from '../components/StatCard';
import { formatBytes, formatDateTime } from '../lib/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const MAX_BYTES = 5 * 1024 * 1024;
const REQUIRED = 'transaction_id, account_id, instrument_id, transaction_type, trade_date, quantity, price, amount, status';

const REASONS: Record<string, string> = {
  MISSING_VALUE: 'Missing value',
  INVALID_ID: 'Invalid ID',
  INVALID_ENUM: 'Invalid option',
  INVALID_DATE: 'Invalid date',
  FUTURE_DATE: 'Future date',
  INVALID_NUMBER: 'Invalid number',
  NEGATIVE_VALUE: 'Negative value',
  INVALID_TRADE_VALUES: 'Invalid trade values',
  UNKNOWN_ACCOUNT: 'Unknown account',
  UNKNOWN_INSTRUMENT: 'Unknown instrument',
  DUPLICATE_ID: 'Duplicate ID',
};

const COLUMNS: Column<Rejection>[] = [
  { key: 'row', header: 'Row', align: 'right', cell: (r) => r.rowNumber },
  { key: 'record', header: 'Record', cell: (r) => <span className="font-mono text-xs">{r.recordKey ?? '—'}</span> },
  {
    key: 'reason',
    header: 'Reason',
    cell: (r) => (
      <Badge tone="rose" title={r.code}>
        {REASONS[r.code] ?? r.code}
      </Badge>
    ),
  },
  { key: 'detail', header: 'Detail', cell: (r) => <span className="text-slate-700">{r.detail}</span> },
];

function Result({ result, onReset }: { result: ImportResult; onReset: () => void }) {
  const nothingImported = result.importedRows === 0;
  return (
    <section aria-labelledby="result-heading" className="space-y-4">
      <h2 id="result-heading" className="text-lg font-semibold">
        Result for {result.fileName} <span className="text-sm font-normal text-slate-600">(batch #{result.batchId})</span>
      </h2>
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
        <StatCard label="Rows in file" value={result.totalRows.toLocaleString('en-IN')} />
        <StatCard label="Imported" value={result.importedRows.toLocaleString('en-IN')} valueClassName="text-emerald-700" />
        <StatCard label="Rejected" value={result.rejectedRows.toLocaleString('en-IN')} valueClassName={result.rejectedRows ? 'text-rose-700' : ''} />
      </div>
      <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${result.rejectedRows === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : nothingImported ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
        {result.rejectedRows === 0
          ? 'Every row was valid and has been imported.'
          : nothingImported
            ? 'No rows were imported. Fix the problems below and upload the file again.'
            : 'The valid rows were imported. The rejected rows were NOT loaded; fix them and upload them in a new file.'}
      </p>

      {result.rejections.length > 0 && (
        <div className="card overflow-hidden">
          <h3 className="border-b border-slate-200 px-4 py-3 font-semibold">Rejected rows</h3>
          <DataTable caption="Rejected rows and the reason for each" columns={COLUMNS} rows={result.rejections} rowKey={(r) => `${r.rowNumber}-${r.code}`} />
          {result.truncated && (
            <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
              Showing the first {result.rejections.length.toLocaleString('en-IN')} of {result.rejectedRows.toLocaleString('en-IN')} rejected rows. All of them are stored in the database (table <code>import_rejections</code>, batch {result.batchId}).
            </p>
          )}
        </div>
      )}
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        Import another file
      </button>
    </section>
  );
}

function Failure({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null;
  const batch = api?.code === 'ALREADY_IMPORTED' ? (api.details as { batchId?: number; importedAt?: string } | undefined) : undefined;
  const missing = api?.code === 'MISSING_COLUMNS' ? (api.details as { missing?: string[] } | undefined)?.missing : undefined;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
      <p className="font-semibold">{api?.code === 'ALREADY_IMPORTED' ? 'This file was already imported' : 'The file could not be imported'}</p>
      <p className="mt-1 text-sm">{api?.message ?? 'Something went wrong. Please try again.'}</p>
      {batch?.importedAt && <p className="mt-1 text-sm">It was loaded on {formatDateTime(batch.importedAt)}. Nothing was imported this time, so no data is duplicated.</p>}
      {missing && <p className="mt-1 text-sm">Missing columns: <strong>{missing.join(', ')}</strong></p>}
      {api && api.status !== 0 && <p className="mt-2 text-xs text-rose-800">Nothing was saved. Reference: {api.requestId}</p>}
    </div>
  );
}

export function AdminImportPage() {
  useDocumentTitle('Data import');
  const upload = useImportTransactions();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState('');

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    upload.reset();
    setFile(null);
    setProblem('');
    if (!picked) return;
    if (!/\.csv$/i.test(picked.name)) return setProblem('Please choose a .csv file.');
    if (picked.size === 0) return setProblem('That file is empty.');
    if (picked.size > MAX_BYTES) return setProblem(`That file is ${formatBytes(picked.size)}; the limit is 5 MB.`);
    setFile(picked);
  }

  function reset() {
    upload.reset();
    setFile(null);
    setProblem('');
    if (input.current) input.current.value = '';
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (file) upload.mutate(file);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transactions import</h1>
        <p className="mt-1 text-slate-600">Upload a CSV of transactions. Every row is checked before anything is saved.</p>
      </div>

      {!upload.isSuccess && (
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div>
            <label htmlFor="csv-file" className="label">
              CSV file
            </label>
            <input ref={input} id="csv-file" type="file" accept=".csv,text/csv" onChange={choose} disabled={upload.isPending} aria-describedby="csv-help csv-problem" className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100" />
            <p id="csv-help" className="mt-2 text-sm text-slate-600">
              UTF-8 CSV, up to 5 MB. Required columns: <code className="text-xs">{REQUIRED}</code>
            </p>
            <p id="csv-problem" role="alert" className={problem ? 'mt-2 text-sm text-rose-700' : 'sr-only'}>
              {problem}
            </p>
          </div>

          {file && !upload.isPending && (
            <p className="text-sm text-slate-700">
              Selected: <strong>{file.name}</strong> ({formatBytes(file.size)})
            </p>
          )}

          {upload.isPending && (
            <div role="status" className="space-y-2">
              <p className="text-sm text-slate-700">Uploading and validating {file?.name}…</p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-600 motion-reduce:animate-none" />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={!file || upload.isPending}>
              {upload.isPending ? 'Importing…' : 'Validate & import'}
            </button>
            {file && !upload.isPending && (
              <button type="button" className="btn btn-secondary" onClick={reset}>
                Clear
              </button>
            )}
          </div>

          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Rows with a problem are rejected with a reason; the valid rows are still imported.</li>
            <li>Existing transactions are never overwritten, and the same file cannot be imported twice.</li>
            <li>The import is all-or-nothing: if anything fails while saving, nothing is saved.</li>
          </ul>
        </form>
      )}

      {upload.isError && <Failure error={upload.error} />}
      {upload.isSuccess && <Result result={upload.data} onReset={reset} />}
    </div>
  );
}
