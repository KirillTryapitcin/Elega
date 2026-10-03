import type { Schemas } from '@elega/api-client';
import {
  birthdateSchema,
  displayNameSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  usernameSchema,
} from '@elega/shared';
import { z } from 'zod';

export type AuthResult = Schemas['AuthResult'];
export type MfaChallenge = Schemas['MfaChallenge'];

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// Login and confirmation accept any length so that old or mistyped passwords get the uniform
// 401, not a validation error that hints at the policy.
const anyPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const token = z.string().min(16).max(128);
const displayName = displayNameSchema;

const consents = {
  acceptedTermsVersion: z.string().min(1).max(32),
  acceptedPrivacyVersion: z.string().min(1).max(32),
  acceptedPdProcessingVersion: z.string().min(1).max(32),
};

export const registerSchema = z.strictObject({
  email,
  password: newPassword,
  displayName,
  username: usernameSchema,
  birthdate: birthdateSchema,
  inviteCode: z.string().max(64).optional(),
  locale: z.enum(['ru', 'en']).optional(),
  captchaToken: z.string().max(4096).optional(),
  ...consents,
});
export type RegisterBody = z.infer<typeof registerSchema>;

export const oauthCompleteSchema = z.strictObject({
  token,
  email: email.optional(),
  displayName,
  username: usernameSchema,
  birthdate: birthdateSchema,
  inviteCode: z.string().max(64).optional(),
  locale: z.enum(['ru', 'en']).optional(),
  ...consents,
});
export type OAuthCompleteBody = z.infer<typeof oauthCompleteSchema>;

export const loginSchema = z.strictObject({
  identifier: z.string().trim().min(1).max(254),
  password: anyPassword,
  rememberDevice: z.boolean().optional(),
  captchaToken: z.string().max(4096).optional(),
});
export type LoginBody = z.infer<typeof loginSchema>;

export const mfaLoginSchema = z.strictObject({
  mfaToken: token,
  code: z.string().regex(/^([0-9]{6}|[A-Z0-9]{10})$/),
});

export const tokenSchema = z.strictObject({ token });
export const emailSchema = z.strictObject({ email });
export const resetPasswordSchema = z.strictObject({ token, newPassword });
export const changePasswordSchema = z.strictObject({ currentPassword: anyPassword, newPassword });
export const changeEmailSchema = z.strictObject({ currentPassword: anyPassword, newEmail: email });
export const passwordConfirmSchema = z.strictObject({
  password: anyPassword.optional(),
  code: z.string().max(16).optional(),
});
export type PasswordConfirm = z.infer<typeof passwordConfirmSchema>;
export const totpConfirmSchema = z.strictObject({ code: z.string().regex(/^[0-9]{6}$/) });

export const providerSchema = z.enum(['vk', 'yandex', 'google']);
export type OAuthProviderName = z.infer<typeof providerSchema>;
