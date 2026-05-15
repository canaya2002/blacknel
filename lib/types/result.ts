import { AppError, type AppErrorCode } from '../errors';

/**
 * Discriminated `Result<T, E>` used by every Server Action and any
 * server-side function that can fail "gracefully". Callers `switch` on
 * `result.ok` to access either `data` or `error`. We never throw at the
 * client boundary — exceptions are reserved for true bugs.
 */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(data: T): { readonly ok: true; readonly data: T } {
  return { ok: true, data } as const;
}

export function err<E extends AppError>(error: E): { readonly ok: false; readonly error: E };
export function err(
  code: AppErrorCode,
  message: string,
  options?: { meta?: Record<string, unknown>; cause?: unknown },
): { readonly ok: false; readonly error: AppError };
export function err(
  errorOrCode: AppError | AppErrorCode,
  message?: string,
  options?: { meta?: Record<string, unknown>; cause?: unknown },
): { readonly ok: false; readonly error: AppError } {
  const error =
    errorOrCode instanceof AppError
      ? errorOrCode
      : new AppError(errorOrCode, message ?? errorOrCode, options);
  return { ok: false, error } as const;
}
