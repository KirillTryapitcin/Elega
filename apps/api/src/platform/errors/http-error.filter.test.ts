import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { mapError, ValidationError } from './http-error.filter.js';

describe('mapError', () => {
  it('keeps AppError code, message and details', () => {
    const error = new AppError('conflict', 'Username taken', [
      { field: 'username', message: 'taken' },
    ]);
    expect(mapError(error)).toEqual({
      status: 409,
      code: 'conflict',
      message: 'Username taken',
      details: [{ field: 'username', message: 'taken' }],
    });
  });

  it('maps Nest HTTP exceptions by status with a safe message', () => {
    expect(mapError(new NotFoundException('Cannot GET /secret/path'))).toEqual({
      status: 404,
      code: 'not_found',
      message: 'Not found',
    });
    expect(mapError(new BadRequestException()).code).toBe('validation_failed');
  });

  it('maps Fastify errors that carry a statusCode', () => {
    const tooLarge = Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    expect(mapError(tooLarge)).toMatchObject({ status: 413, code: 'payload_too_large' });
  });

  it('hides unknown errors behind internal_error', () => {
    const mapped = mapError(new Error('password=hunter2 leaked in a stack'));
    expect(mapped).toEqual({ status: 500, code: 'internal_error', message: 'Internal error' });
  });

  it('carries validation details', () => {
    const mapped = mapError(new ValidationError([{ field: 'email', message: 'Invalid email' }]));
    expect(mapped).toMatchObject({
      status: 400,
      details: [{ field: 'email', message: 'Invalid email' }],
    });
  });
});
