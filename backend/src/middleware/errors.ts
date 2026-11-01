import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, type FieldError } from '../lib/errors';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

const invalid = (message: string) => new AppError(400, 'VALIDATION_ERROR', message);
const unavailable = (message: string) => new AppError(503, 'SERVICE_UNAVAILABLE', message);

/** PostgreSQL SQLSTATE and Node network codes we can explain to a client instead of returning a bare 500. */
const KNOWN: Record<string, () => AppError> = {
  '23505': () => new AppError(409, 'CONFLICT', 'A record with the same unique value already exists'),
  '23503': () => new AppError(409, 'CONFLICT', 'The request refers to a record that does not exist or is still in use'),
  '23502': () => invalid('A required value is missing'),
  '23514': () => invalid('A value violates a data rule'),
  '22001': () => invalid('A value is too long'),
  '22003': () => invalid('A numeric value is out of range'),
  '22007': () => invalid('A date value is invalid'),
  '22008': () => invalid('A date value is out of range'),
  '22P02': () => invalid('A value has an invalid format'),
  '57014': () => unavailable('The database took too long to answer. Please retry.'),
  '53300': () => unavailable('The database is busy. Please retry shortly.'),
};
for (const code of ['57P01', '57P02', '57P03', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']) {
  KNOWN[code] = () => unavailable('The database is unreachable. Please retry shortly.');
}

/** Drizzle wraps driver errors, so walk the `cause` chain to find the SQLSTATE / errno code. */
function errorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

export const fieldErrors = (e: ZodError): FieldError[] =>
  e.issues.map((i) => ({
    field: i.code === 'unrecognized_keys' ? i.keys.join(', ') : i.path.join('.') || 'body',
    message: i.message,
  }));

/** Turns anything thrown anywhere into an AppError with a safe, client-friendly message. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', fieldErrors(err));

  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; type?: unknown; message?: unknown };
  // body-parser / http-errors
  if (e.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON');
  if (e.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  if (e.type === 'encoding.unsupported' || e.type === 'charset.unsupported') {
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding or charset');
  }
  const status = Number(e.status ?? e.statusCode);
  if (status >= 400 && status < 500) {
    return new AppError(status, STATUS_CODES[status] ?? 'BAD_REQUEST', status === 400 ? 'Malformed request' : 'Request rejected');
  }

  const code = errorCode(err);
  if (code && KNOWN[code]) return KNOWN[code]();
  if (/timeout exceeded when trying to connect|connection terminated|connection is closed/i.test(String(e.message ?? ''))) {
    return unavailable('The database is unreachable. Please retry shortly.');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again later.');
}

export const notFound: RequestHandler = (req) => {
  throw new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
};

/** The one place errors become responses: { success: false, error: { code, message, details?, requestId } }. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const appError = toAppError(err);
  // 4xx are already logged (as warnings) by the request logger; only unexpected failures need the stack.
  if (appError.status >= 500) req.log.error({ err }, `${appError.code}: ${appError.message}`);
  res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
      requestId: req.id,
    },
  });
};
