/** An error we expect and can describe to the client. Everything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface FieldError {
  field: string;
  message: string;
}

/** 400 with one field-level message (used for rules that need database state). */
export const fieldError = (field: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field, message } satisfies FieldError]);
