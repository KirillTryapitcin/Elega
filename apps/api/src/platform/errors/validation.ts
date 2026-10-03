import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { ErrorDetail } from '@elega/shared';
import { ValidationError } from './http-error.filter.js';

type Issue = {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined;
};

export function issuesToDetails(issues: readonly Issue[]): ErrorDetail[] {
  return issues.map((issue) => {
    const field = issue.path
      ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.');
    return field ? { field, message: issue.message } : { message: issue.message };
  });
}

/** Validates every `@Body/@Query/@Param({ schema })` with Zod (Standard Schema). */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) => new ValidationError(issuesToDetails(issues)),
  });
}
