import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/lib/errors';
import { escapeLike } from '../../src/services/customers';
import { toAppError } from '../../src/middleware/errors';

describe('toAppError', () => {
  it('passes AppError through untouched', () => {
    const e = new AppError(409, 'X', 'msg');
    expect(toAppError(e)).toBe(e);
  });

  it('maps Zod errors to 400 with field details', () => {
    const r = z.object({ a: z.string() }).safeParse({});
    const e = toAppError(r.error);
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(e.details).toEqual([{ field: 'a', message: expect.any(String) }]);
  });

  it.each([
    ['unique violation', { code: '23505' }, 409, 'CONFLICT'],
    ['foreign key violation', { code: '23503' }, 409, 'CONFLICT'],
    ['check violation', { code: '23514' }, 400, 'VALIDATION_ERROR'],
    ['numeric overflow', { code: '22003' }, 400, 'VALIDATION_ERROR'],
    ['statement timeout', { code: '57014' }, 503, 'SERVICE_UNAVAILABLE'],
    ['too many connections', { code: '53300' }, 503, 'SERVICE_UNAVAILABLE'],
    ['connection refused', { code: 'ECONNREFUSED' }, 503, 'SERVICE_UNAVAILABLE'],
    ['error wrapped by the ORM (cause chain)', { message: 'Failed query', cause: { code: '23514' } }, 400, 'VALIDATION_ERROR'],
    ['pool connect timeout', new Error('timeout exceeded when trying to connect'), 503, 'SERVICE_UNAVAILABLE'],
    ['malformed JSON body', Object.assign(new SyntaxError('x'), { type: 'entity.parse.failed', status: 400 }), 400, 'INVALID_JSON'],
    ['oversized body', { type: 'entity.too.large', status: 413 }, 413, 'PAYLOAD_TOO_LARGE'],
    ['malformed URL', Object.assign(new URIError('Failed to decode param'), { status: 400 }), 400, 'BAD_REQUEST'],
    ['unexpected error', new Error('boom'), 500, 'INTERNAL_ERROR'],
    ['non-error throw', 'a string', 500, 'INTERNAL_ERROR'],
    ['undefined throw', undefined, 500, 'INTERNAL_ERROR'],
  ])('%s -> %i %s', (_label, input, status, code) => {
    expect(toAppError(input)).toMatchObject({ status, code });
  });

  it('never leaks the original message of an unexpected error', () => {
    expect(toAppError(new Error('password=hunter2 at /srv/app/secret.ts')).message).not.toContain('hunter2');
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
    expect(escapeLike('plain text')).toBe('plain text');
  });
});
