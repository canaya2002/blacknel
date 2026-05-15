/**
 * Typed application errors. Every error that crosses a server boundary
 * (Server Action, Route Handler, RPC) is either an `AppError` or gets
 * wrapped in one. Callers in the UI layer can switch on `error.code`
 * and render the right message.
 */

export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'PLAN_LIMIT_REACHED'
  | 'FEATURE_NOT_AVAILABLE_ON_PLAN'
  | 'CAPABILITY_NOT_AVAILABLE'
  | 'INTEGRATION_DISCONNECTED'
  | 'AI_GENERATION_BLOCKED'
  | 'AI_COMPLIANCE_VIOLATION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface AppErrorOptions {
  meta?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly meta: Record<string, unknown> | undefined;
  public readonly httpStatus: number;

  constructor(code: AppErrorCode, message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.meta = options?.meta;
    this.httpStatus = httpStatusFor(code);
  }

  toJSON(): { code: AppErrorCode; message: string; meta?: Record<string, unknown> } {
    return this.meta
      ? { code: this.code, message: this.message, meta: this.meta }
      : { code: this.code, message: this.message };
  }
}

function httpStatusFor(code: AppErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'FEATURE_NOT_AVAILABLE_ON_PLAN':
    case 'CAPABILITY_NOT_AVAILABLE':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'VALIDATION_ERROR':
    case 'AI_GENERATION_BLOCKED':
    case 'AI_COMPLIANCE_VIOLATION':
    case 'INTEGRATION_DISCONNECTED':
      return 422;
    case 'PLAN_LIMIT_REACHED':
    case 'RATE_LIMITED':
      return 429;
    case 'INTERNAL_ERROR':
      return 500;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
