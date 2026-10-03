/**
 * CAPTCHA hook (brief §8.3: interface only). The planned provider is Yandex SmartCaptcha,
 * hosted in the RF. Until it is wired in, `NoCaptcha` is used in every environment: it does
 * not pretend to verify anything, it reports that no challenge is configured, and the login
 * lockout and rate limits carry the load. See docs/security.md.
 */
export const CAPTCHA = Symbol('CAPTCHA');

export interface CaptchaVerifier {
  /** Whether a provider is configured; when false, callers never ask clients for a token. */
  readonly enabled: boolean;
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export class NoCaptcha implements CaptchaVerifier {
  readonly enabled = false;

  verify(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
