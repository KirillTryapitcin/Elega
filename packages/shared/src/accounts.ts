import { z } from 'zod';
import {
  ageOn,
  DISPLAY_NAME_MAX_LENGTH,
  MAX_AGE,
  MIN_SIGNUP_AGE,
  usernameProblem,
} from './account-rules.js';
import { hasForbiddenChars } from './text.js';

export * from './account-rules.js';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const problem = usernameProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: `username_${problem}` });
  });

/** A name shown to other people: no control, bidi or invisible characters, NFC. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX_LENGTH)
  .refine((value) => !hasForbiddenChars(value), 'display_name_invalid')
  .transform((value) => value.normalize('NFC'));

export const birthdateSchema = z.string().superRefine((value, ctx) => {
  const age = ageOn(value);
  if (age === null) ctx.addIssue({ code: 'custom', message: 'birthdate_invalid' });
  else if (age < MIN_SIGNUP_AGE) ctx.addIssue({ code: 'custom', message: 'birthdate_too_young' });
  else if (age > MAX_AGE) ctx.addIssue({ code: 'custom', message: 'birthdate_invalid' });
});
