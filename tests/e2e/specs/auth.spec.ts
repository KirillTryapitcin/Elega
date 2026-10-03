import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = 'тихий-вечер-над-рекой-2026';

interface MailpitList {
  messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
}

/** Waits for the newest email to `to` with this subject and returns its plain text. */
async function emailText(page: Page, to: string, subject: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (
          await page.request.get(`${MAILPIT}/api/v1/messages?limit=100`)
        ).json()) as MailpitList;
        id = list.messages.find(
          (message) =>
            message.Subject === subject && message.To.some((item) => item.Address === to),
        )?.ID;
        return id;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  const message = (await (await page.request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
    Text: string;
  };
  return message.Text;
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);
}

test('sign-in and sign-up pages have no serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto('/signup');
  await expect(page.getByLabel('Код приглашения')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('pages carry a nonce-based CSP', async ({ page }) => {
  const response = await page.goto('/login');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
});

test('register, confirm email, sign out, sign in, sign out everywhere', async ({
  page,
}, testInfo) => {
  // Registration is limited per IP; one full run per stack start is enough.
  test.skip(testInfo.project.name !== 'desktop', 'runs once, on desktop');
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    // Chromium logs expected 4xx responses (the wrong password below) as errors.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      consoleErrors.push(message.text());
    }
  });
  const inviteCode = process.env.E2E_INVITE_CODE;
  expect(inviteCode, 'globalSetup creates an invite code').toBeTruthy();
  const id = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const email = `e2e_${id}@example.ru`;
  const username = `e2e_${id}`;

  await test.step('register with an invite', async () => {
    await page.goto('/signup');
    await page.getByLabel('Почта').fill(email);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByLabel('Имя', { exact: true }).fill('Тестовый Пользователь');
    await page.getByLabel('Имя пользователя').fill(username);
    await page.getByLabel('Дата рождения').fill('1995-04-20');
    await page.getByLabel('Код приглашения').fill(inviteCode!);
    await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
    await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('signed-in-as')).toContainText(`@${username}`);
    await expect(page.getByText(`Подтвердите почту ${email}`)).toBeVisible();
  });

  await test.step('confirm the email from Mailpit', async () => {
    const text = await emailText(page, email, 'Подтвердите адрес почты');
    const link = /https?:\/\/\S+\/verify-email#token=[\w-]+/.exec(text)?.[0];
    expect(link, 'verification link in the email').toBeTruthy();
    await page.goto(new URL(link!).pathname + new URL(link!).hash);
    await expect(page.getByText('Почта подтверждена.')).toBeVisible();
    // The one-time token is removed from the address bar.
    await expect(page).toHaveURL('/verify-email');
    await page.getByRole('link', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('signed-in-as')).toBeVisible();
    await expect(page.getByText(`Подтвердите почту ${email}`)).toHaveCount(0);
  });

  await test.step('the session survives a reload', async () => {
    await page.reload();
    await expect(page.getByTestId('signed-in-as')).toContainText(`@${username}`);
  });

  await test.step('sign out, then sign in with the username', async () => {
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible();
    await page.getByRole('link', { name: 'Войти' }).click();
    await page.getByLabel('Почта или имя пользователя').fill(username);
    await page.getByLabel('Пароль').fill('wrong password here');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Неверная почта, имя пользователя или пароль.')).toBeVisible();
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByTestId('signed-in-as')).toContainText(`@${username}`);
  });

  await test.step('sign out everywhere from the security settings', async () => {
    await page.goto('/settings/security');
    await expect(page.getByRole('heading', { name: 'Сеансы' })).toBeVisible();
    await expect(page.getByText('Это устройство')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Выйти на всех устройствах' }).click();
    await page.getByLabel('Текущий пароль').last().fill(PASSWORD);
    await page.getByRole('button', { name: 'Выйти на всех устройствах' }).click();
    await expect(page).toHaveURL('/login');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible();
  });

  expect(consoleErrors).toEqual([]);
});
