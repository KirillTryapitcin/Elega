import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ErrorBody, ErrorCode, ErrorDetail } from '@elega/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitedError, setRateHeaders } from '../rate-limit.js';
import { AppError } from './app-error.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_failed',
  429: 'rate_limited',
};

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: 'Authentication required',
  forbidden: 'Not allowed',
  not_found: 'Not found',
  validation_failed: 'Validation failed',
  conflict: 'Conflict',
  rate_limited: 'Too many requests',
  payload_too_large: 'Payload too large',
  unsupported_media_type: 'Unsupported media type',
  internal_error: 'Internal error',
  mfa_required: 'Second factor required',
  registration_closed: 'Registration is closed',
  account_suspended: 'Account suspended',
  account_banned: 'Account banned',
  reauth_required: 'Confirm it is you',
};

interface Mapped {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

/** Maps any thrown value to the unified error body. Unknown errors never leak their message. */
export function mapError(exception: unknown): Mapped {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      ...(exception.details ? { details: exception.details } : {}),
    };
  }
  if (exception instanceof ValidationError) {
    return {
      status: 400,
      code: 'validation_failed',
      message: SAFE_MESSAGES.validation_failed,
      details: exception.details,
    };
  }
  const status = exception instanceof HttpException ? exception.getStatus() : statusOf(exception);
  const code = status !== undefined ? CODE_BY_STATUS[status] : undefined;
  if (status !== undefined && code) {
    return { status, code, message: SAFE_MESSAGES[code] };
  }
  return { status: 500, code: 'internal_error', message: SAFE_MESSAGES.internal_error };
}

/** Fastify errors (body too large, bad JSON, wrong content type) carry a numeric statusCode. */
function statusOf(exception: unknown): number | undefined {
  if (typeof exception === 'object' && exception !== null && 'statusCode' in exception) {
    const value = (exception as { statusCode: unknown }).statusCode;
    if (typeof value === 'number' && value >= 400 && value < 500) return value;
  }
  return undefined;
}

/** Raised by the validation pipe; carries field-level details. */
export class ValidationError extends Error {
  constructor(readonly details: ErrorDetail[]) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const mapped = mapError(exception);
    if (exception instanceof RateLimitedError) setRateHeaders(reply, exception.result);

    if (mapped.status >= 500) {
      this.logger.error({ err: exception, requestId: request.id }, 'Unhandled error');
    }

    const body: ErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
        requestId: String(request.id),
      },
    };
    void reply.status(mapped.status).send(body);
  }
}
