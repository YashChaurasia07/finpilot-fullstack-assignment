import type { Response } from 'express';

/**
 * Every successful response has the same envelope:
 *   { "success": true, "data": <payload>, "meta"?: <pagination> }
 * Every failure is { "success": false, "error": { code, message, details?, requestId } } (see middleware/errors.ts).
 */
export interface Meta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const pageMeta = (page: number, pageSize: number, total: number): Meta => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});

export function ok<T>(res: Response, data: T, meta?: Meta): void {
  res.json(meta ? { success: true, data, meta } : { success: true, data });
}

export function created<T>(res: Response, data: T, location?: string): void {
  if (location) res.location(location);
  res.status(201).json({ success: true, data });
}
