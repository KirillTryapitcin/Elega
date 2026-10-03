import { ERROR_STATUS, type ErrorCode, type ErrorDetail } from '@elega/shared';

/** Throw this from services for any expected failure; the filter turns it into the error body. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    status?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status ?? ERROR_STATUS[code];
  }
}
