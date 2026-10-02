import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home page renders in Russian by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    'Друзья, близкие и сообщества рядом',
  );
});

test('theme choice persists across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Тема').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('language can be switched to English', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Язык').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Language')).toBeVisible();
});

test('home page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => v.id)).toEqual([]);
});

test('API is reachable through the proxy and ready', async ({ request }) => {
  const res = await request.get('/api/v1/readyz');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
});

test('API errors carry the proxy request id', async ({ request }) => {
  const res = await request.get('/api/v1/does-not-exist');
  expect(res.status()).toBe(404);
  const requestId = res.headers()['x-request-id'];
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await res.json()).toEqual({
    error: { code: 'not_found', message: 'Not found', requestId },
  });
});
