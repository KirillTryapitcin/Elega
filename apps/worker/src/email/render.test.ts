import { describe, expect, it } from 'vitest';
import { renderEmail } from './render.js';

describe('renderEmail', () => {
  it('renders Russian copy with the link on the web app', () => {
    const email = renderEmail(
      {
        template: 'verify_email',
        to: 'anya@example.ru',
        locale: 'ru',
        linkPath: '/verify-email#token=abc',
        params: { name: 'Аня' },
      },
      'https://elega.ru',
    );
    expect(email.subject).toBe('Подтвердите адрес почты');
    expect(email.text).toContain('Здравствуйте, Аня!');
    expect(email.text).toContain('https://elega.ru/verify-email#token=abc');
    expect(email.html).toContain('href="https://elega.ru/verify-email#token=abc"');
  });

  it('escapes parameters in HTML', () => {
    const email = renderEmail(
      {
        template: 'new_device_login',
        to: 'x@example.ru',
        locale: 'en',
        params: {
          name: '<script>alert(1)</script>',
          device: 'Chrome · Android',
          time: '2026-10-02T12:00:00Z',
        },
      },
      'https://elega.ru',
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain('Chrome · Android');
  });
});
