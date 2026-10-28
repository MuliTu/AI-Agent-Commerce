import { expect, test } from '@playwright/test';
import { runTestOrchestration } from '../fixtures/orchestration';

async function runExample(page: import('@playwright/test').Page, name: string) {
  const example = page.getByRole('button', { name });
  if (!await example.isVisible()) await page.getByText('Example prompts', { exact: true }).click();
  await example.click();
  await page.getByRole('button', { name: /Find products|Refine results/ }).click();
}

async function persistedState(conversationId: string, turnId: string, prompt: string) {
  const result = await runTestOrchestration({ conversationId, turnId, prompt });
  const now = '2026-10-28T12:00:00.000Z';
  return {
    conversation: { id: conversationId, title: prompt, createdAt: now, updatedAt: now },
    turns: [{ id: turnId, conversationId, status: result.status, createdAt: now, updatedAt: now, completedAt: now, result }],
    messages: [
      { id: `${turnId}:user`, turnId, role: 'user', content: prompt, status: 'completed', createdAt: now },
      { id: `${turnId}:assistant`, turnId, role: 'assistant', content: result.response, status: 'completed', createdAt: now },
    ],
  };
}

test.beforeEach(async ({ page, context }) => {
  let savedState: Record<string, unknown> | undefined;
  let conversations: Array<{ id: string; title?: string; createdAt: string; updatedAt: string }> = [];
  await context.route('**/api/conversations*', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ conversations }) });
    }
    const id = new URL(route.request().url()).searchParams.get('conversationId') ?? '';
    const mutation = route.request().postDataJSON();
    if (mutation.action === 'rename') conversations = conversations.map((item) => item.id === id ? { ...item, title: mutation.title } : item);
    if (mutation.action === 'archive') conversations = conversations.filter((item) => item.id !== id);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ conversation: { id, title: mutation.title ?? 'Saved search', createdAt: 'now', updatedAt: 'now' } }) });
  });
  await context.route('**/api/orchestrate*', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: savedState ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(savedState ?? { error: { code: 'conversation_not_found', message: 'Conversation not found.' } }),
      });
    }
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON();
    const result = await runTestOrchestration(input);
    savedState = await persistedState(input.conversationId, input.turnId, input.prompt);
    conversations = [{ id: input.conversationId, title: input.prompt, createdAt: 'now', updatedAt: 'now' }];
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ result }),
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Bazak message').filter({ hasText: 'Hi! I’m your shopping assistant. What would you like to find today?' })).toHaveCount(1);
  await expect(page.getByRole('alert').filter({ hasText: 'Model configuration required' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo' })).toHaveCount(0);
});

test('saved conversation can be renamed and reversibly removed from the navigation', async ({ page }) => {
  await runExample(page, 'Single intent');
  await expect(page.getByRole('navigation', { name: 'Conversation history' }).getByText('Find me a reliable laptop for work')).toBeVisible();
  await page.getByRole('button', { name: 'Rename Find me a reliable laptop for work' }).click();
  await page.getByLabel('Conversation title').fill('Work laptop shortlist');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Work laptop shortlist')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Work laptop shortlist' }).click();
  await expect(page.getByText('Conversation removed.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
});

test('disabled live mode fails honestly and never falls back to demo', async ({ request }) => {
  const turnId = `live-disabled-${Date.now()}`;
  const response = await request.post('/api/orchestrate', {
    data: { prompt: 'Find a laptop', conversationId: 'e2e', turnId },
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
  await page.getByRole('button', { name: /Requests/ }).click();
  await expect(page.getByText('1 intent processed')).toBeVisible();
});

test('a broken catalog image is replaced by an accessible fallback', async ({ page }) => {
  await runExample(page, 'Single intent');
  const image = page.getByRole('img', { name: 'Apple MacBook Pro 14 Inch Space Grey' });
  await image.evaluate((element) => element.dispatchEvent(new Event('error')));
  await expect(page.getByRole('img', { name: 'Image unavailable for Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
});

test('refresh and a second page restore the authoritative conversation by stable URL ID', async ({ page, context }) => {
  await runExample(page, 'Single intent');
  await expect(page).toHaveURL(/conversation=/);
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await page.getByText('How results and recovery work').click();
  await expect(page.getByText(/not a server shutdown/)).toBeVisible();

  const secondPage = await context.newPage();
  await secondPage.goto(page.url());
  await expect(secondPage.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
});

test('refresh and saved-conversation switching restore every turn as structured result blocks', async ({ page }) => {
  const first = await persistedState('conversation-a', 'turn-a1', 'Find me a reliable laptop for work');
  const second = await persistedState('conversation-a', 'turn-a2', 'I need a work laptop and basketball shoes');
  const other = await persistedState('conversation-b', 'turn-b1', 'Find me a phone');
  const conversationA = {
    conversation: { ...first.conversation, title: 'Laptop and shoes' },
    turns: [...first.turns, ...second.turns],
    messages: [...first.messages, ...second.messages],
  };
  await page.route('**/api/conversations*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ conversations: [
    conversationA.conversation,
    { ...other.conversation, title: 'Phone search' },
  ] }) }));
  await page.route('**/api/orchestrate?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('conversationId');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(id === 'conversation-b' ? other : conversationA) });
  });

  await page.goto('/?conversation=conversation-a');
  const restoredTurns = page.locator('.conversation-turn');
  await expect(restoredTurns).toHaveCount(2);
  await expect(restoredTurns.nth(0).getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(restoredTurns.nth(1).getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(restoredTurns.nth(1).getByRole('heading', { name: 'Nike Air Jordan 1 Red And Black' })).toBeVisible();
  await page.reload();
  const reloadedTurns = page.locator('.conversation-turn');
  await expect(reloadedTurns).toHaveCount(2);
  await expect(reloadedTurns.nth(0).getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(reloadedTurns.nth(1).getByRole('heading', { name: 'Nike Air Jordan 1 Red And Black' })).toBeVisible();

  await page.locator('.conversation-nav__open').filter({ hasText: 'Phone search' }).click();
  await expect(page).toHaveURL(/conversation=conversation-b/);
  await expect(page.locator('.conversation-turn').last().getByRole('heading', { name: 'iPhone 15 Pro' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nike Air Jordan 1 Red And Black' })).toHaveCount(0);
});

test('clearing a conversation cancels an older delayed restore response', async ({ page }) => {
  const state = await persistedState('old-conversation', 'old-turn', 'Find me a reliable laptop for work');
  let release!: () => void;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/orchestrate?*', async (route) => {
    requestStarted();
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });

  await page.goto('/?conversation=old-conversation');
  await started;
  await page.getByRole('button', { name: 'New conversation' }).click();
  release();

  await expect(page).not.toHaveURL(/conversation=/);
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toHaveCount(0);
  await expect(page.getByText('Conversation saved')).toHaveCount(0);
});

test('clearing a conversation releases the composer and ignores an older delayed POST response', async ({ page }) => {
  let requestCount = 0;
  let releaseOld!: () => void;
  let oldRequestStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => { oldRequestStarted = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  await page.route('**/api/orchestrate', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requestCount += 1;
    const input = route.request().postDataJSON();
    if (requestCount === 1) {
      oldRequestStarted();
      await oldGate;
    }
    const result = await runTestOrchestration(input);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
  });

  await page.getByLabel('What are you shopping for?').fill('I need a work laptop and basketball shoes');
  await page.getByRole('button', { name: 'Find products' }).click();
  await oldStarted;
  await expect(page.getByRole('status', { name: 'Catalog results pending' })).toBeVisible();
  await page.getByRole('button', { name: 'New conversation' }).click();
  const oldResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().endsWith('/api/orchestrate'));
  releaseOld();
  await oldResponse;
  await page.waitForTimeout(50);
  await expect(page).not.toHaveURL(/conversation=/);
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toHaveCount(0);

  await page.getByLabel('What are you shopping for?').fill('Find me a reliable laptop for work');
  await page.getByRole('button', { name: 'Find products' }).click();
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find basketball shoes' })).toHaveCount(0);
  expect(requestCount).toBe(2);
});

test('conversation recovery retries transient reads with bounded backoff', async ({ page }) => {
  const state = await persistedState('retry-conversation', 'retry-turn', 'Find me a reliable laptop for work');
  let attempts = 0;
  await page.route('**/api/orchestrate?*', async (route) => {
    attempts += 1;
    if (attempts < 3) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporary' } }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });

  await page.goto('/?conversation=retry-conversation');
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  expect(attempts).toBe(3);
});

test('multi-intent request keeps each goal separate', async ({ page }) => {
  await runExample(page, 'Multi-intent');
  await expect(page.getByRole('heading', { name: 'Find a work laptop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find basketball shoes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nike Air Jordan 1 Red And Black' })).toBeVisible();
  await page.getByRole('button', { name: /Requests/ }).click();
  await expect(page.getByText('2 intents processed')).toBeVisible();
});

test('clarification can refine the same intent without inventing products', async ({ page }) => {
  await runExample(page, 'Clarification');
  await expect(page.getByRole('heading', { name: 'Which product category should I focus on?' })).toBeVisible();
  await page.getByLabel('Laptops').check();
  await expect(page.getByLabel('What are you shopping for?')).toHaveValue('Find a suitable gift: Laptops');
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
  await page.getByRole('button', { name: /Requests/ }).click();
  await expect(page.getByText('2 intents processed')).toBeVisible();
  await page.getByLabel('Laptops').check();
  await page.getByRole('button', { name: 'Refine results' }).click();
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await expect(page.getByText('A little more detail would help')).toHaveCount(1);
  await expect(page.locator('fieldset:not(:disabled)')).toHaveCount(1);
  await expect(page.getByText('Clarification completed')).toBeVisible();
  await expect(page.getByText('Selected: Laptops')).toBeVisible();
  await expect(page.getByText('Clarification queued', { exact: true })).toHaveCount(1);
});

test('partial failure keeps the successful sibling visible', async ({ page }) => {
  await runExample(page, 'Partial failure');
  await expect(page.locator('.conversation-turn').last().getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unavailable catalog search' })).toBeVisible();
  await expect(page.getByText('This intent failed safely')).toBeVisible();
  await expect(page.getByText('Partial result')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this intent' })).toBeVisible();
});

test('retry keeps the successful sibling visible and recovers only the failed intent', async ({ page }) => {
  await runExample(page, 'Partial failure');
  const retry = page.getByRole('button', { name: 'Retry this intent' });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  const retryStatus = page.getByRole('status').filter({ hasText: 'Retrying this intent' });
  await expect(retryStatus).toBeVisible();
  await expect(retryStatus).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Essence Mascara Lash Princess' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this intent' })).toHaveCount(0);
});

test('a failed retry becomes a permanent scoped failure', async ({ page }) => {
  await runExample(page, 'Permanent retry failure');
  await expect(page.getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry this intent' }).click();
  await expect(page.getByText('Retrying this intent')).toBeVisible();
  await expect(page.getByText('This catalog request cannot be retried safely.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this intent' })).toHaveCount(0);
  await expect(page.locator('.conversation-turn').last().getByRole('heading', { name: 'Dell Latitude 5440' })).toBeVisible();
});

test('empty catalog results are announced and offer one focused next step', async ({ page }) => {
  await runExample(page, 'Empty results');
  const emptyStatus = page.getByRole('status').filter({ hasText: 'No catalog matches yet' });
  await expect(emptyStatus).toBeVisible();
  await expect(emptyStatus).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByText('The current request returned no trusted products.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What kind of product should I focus on?' })).toHaveCount(1);
});

test('same-tick double activation sends only one shopping request', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/orchestrate')) requests += 1;
  });
  await page.getByLabel('What are you shopping for?').fill('I need a work laptop and basketball shoes');
  const submit = page.getByRole('button', { name: 'Find products' });
  await submit.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('heading', { name: 'Find a work laptop' })).toBeVisible();
  expect(requests).toBe(1);
});

test('prompt injection cannot create a product outside the trusted catalog', async ({ page }) => {
  await runExample(page, 'Injection defense');
  await expect(page.getByText('ignored untrusted product claims')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'iPhone 15 Pro' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Galaxy Ultra 999' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Product recommendations' })).toBeVisible();
});

test('shopper flow remains usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await runExample(page, 'Single intent');
  await expect(page.getByRole('heading', { name: 'Apple MacBook Pro 14 Inch Space Grey' })).toBeVisible();
  await page.getByRole('button', { name: 'Open saved conversations' }).click();
  await expect(page.getByRole('navigation', { name: 'Conversation history' }).getByText('Find me a reliable laptop for work')).toBeVisible();
  await page.getByRole('complementary', { name: 'Saved conversations' }).getByRole('button', { name: 'Close saved conversations' }).click();
  await page.getByRole('button', { name: /Requests/ }).click();
  await expect(page.getByRole('heading', { name: 'Request activity' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('a long restored conversation remains scrollable without horizontal overflow', async ({ page }) => {
  const base = await persistedState('long-conversation', 'long-turn-0', 'Find a laptop');
  const turns = Array.from({ length: 24 }, (_, index) => ({ ...base.turns[0], id: `long-turn-${index}` }));
  const messages = turns.flatMap((turn, index) => [
    { id: `${turn.id}:user`, turnId: turn.id, role: 'user', content: `Request ${index + 1}`, status: 'completed', createdAt: base.conversation.createdAt },
    { id: `${turn.id}:assistant`, turnId: turn.id, role: 'assistant', content: `Response ${index + 1}`, status: 'completed', createdAt: base.conversation.createdAt },
  ]);
  await page.route('**/api/orchestrate?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...base, turns, messages }) }));
  await page.goto('/?conversation=long-conversation');
  await expect(page.getByLabel('You message')).toHaveCount(24);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
