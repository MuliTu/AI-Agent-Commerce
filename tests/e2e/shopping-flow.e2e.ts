import { expect, test } from '@playwright/test';

async function runExample(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: /Find products|Refine results/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find products through conversation.' })).toBeVisible();
  await expect(page.getByText('Demo mode is explicit:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Live OpenAI' })).toBeDisabled();
});

test('disabled live mode fails honestly and never falls back to demo', async ({ request }) => {
  const response = await request.post('/api/orchestrate', {
    data: { prompt: 'Find a laptop', conversationId: 'e2e', turnId: 'live-disabled' },
  });
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'provider_authentication', retryable: false },
  });
});

test('single intent returns catalog-grounded products', async ({ page }) => {
  await runExample(page, 'Single intent');
  await expect(page.getByRole('heading', { name: 'Find a catalog product' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(page.getByText('1 intent processed')).toBeVisible();
});

test('multi-intent request keeps each goal separate', async ({ page }) => {
  await runExample(page, 'Multi-intent');
  await expect(page.getByRole('heading', { name: 'Find a work laptop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find basketball shoes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nike Air Jordan 1 Red And Black' })).toBeVisible();
  await expect(page.getByText('2 intents processed')).toBeVisible();
});

test('clarification can refine the same intent without inventing products', async ({ page }) => {
  await runExample(page, 'Clarification');
  await expect(page.getByRole('heading', { name: 'Which product category should I focus on?' })).toBeVisible();
  await page.getByLabel('Laptops').check();
  await expect(page.getByLabel('What are you shopping for?')).toHaveValue('Laptops');
  await page.getByRole('button', { name: 'Refine results' }).click();
  await expect(page.getByText('kept your earlier requirements and focused the search on laptops')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /What kind of product/ })).toHaveCount(0);
});

test('two ambiguous intents render exactly one clarification prompt', async ({ page }) => {
  await page.getByLabel('What are you shopping for?').fill('Run the two ambiguous shopping example');
  await page.getByRole('button', { name: 'Find products' }).click();
  await expect(page.getByText('A little more detail would help')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Which product category should I focus on?' })).toHaveCount(1);
  await expect(page.getByText('Clarification queued', { exact: true })).toBeVisible();
  await expect(page.getByText('2 intents processed')).toBeVisible();
  await page.getByLabel('Laptops').check();
  await page.getByRole('button', { name: 'Refine results' }).click();
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(page.getByText('A little more detail would help')).toHaveCount(1);
  await expect(page.getByText('Clarification queued', { exact: true })).toHaveCount(0);
});

test('partial failure keeps the successful sibling visible', async ({ page }) => {
  await runExample(page, 'Partial failure');
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unavailable catalog search' })).toBeVisible();
  await expect(page.getByText('This intent failed safely')).toBeVisible();
  await expect(page.getByText('Partial result')).toBeVisible();
});

test('prompt injection cannot create a product outside the trusted catalog', async ({ page }) => {
  await runExample(page, 'Injection defense');
  await expect(page.getByText('ignored untrusted product claims')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'iPhone 15 Pro' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Galaxy Ultra 999' })).toHaveCount(0);
  await expect(page.getByText('Catalog-grounded only')).toBeVisible();
});

test('shopper flow remains usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await runExample(page, 'Single intent');
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
