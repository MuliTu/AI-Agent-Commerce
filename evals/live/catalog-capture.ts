import type { CatalogBoundaryCall, ProductEvidence } from './types';

function productEvidence(value: unknown): ProductEvidence[] {
  const candidates = value && typeof value === 'object' && 'products' in value && Array.isArray(value.products)
    ? value.products
    : value && typeof value === 'object' && 'id' in value
      ? [value]
      : [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const product = candidate as Record<string, unknown>;
    if (typeof product.id !== 'number' || typeof product.title !== 'string' || typeof product.price !== 'number' || typeof product.category !== 'string') return [];
    return [{ id: product.id, title: product.title, price: product.price, category: product.category }];
  });
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.clone().text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { nonJsonBody: text.slice(0, 2_000) };
  }
}

export async function withCatalogCapture<T>(run: () => Promise<T>): Promise<{
  result?: T;
  error?: unknown;
  calls: CatalogBoundaryCall[];
  captureComplete: boolean;
}> {
  const originalFetch = globalThis.fetch;
  const calls: CatalogBoundaryCall[] = [];
  const occurrences = new Map<string, number>();
  let captureComplete = true;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input));
    if (url.hostname !== 'dummyjson.com') return originalFetch(input, init);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const occurrenceKey = `${method} ${url.href}`;
    const requestOccurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, requestOccurrence);
    const startedAt = new Date().toISOString();
    try {
      const response = await originalFetch(input, init);
      let rawOutput: unknown = null;
      try {
        rawOutput = await responsePayload(response);
      } catch (error) {
        captureComplete = false;
        rawOutput = { captureError: error instanceof Error ? error.message : String(error) };
      }
      calls.push({
        sequence: calls.length,
        requestOccurrence,
        url: url.href,
        method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams),
        startedAt,
        completedAt: new Date().toISOString(),
        status: response.status,
        ok: response.ok,
        rawOutput,
        returnedProducts: productEvidence(rawOutput),
        error: null,
      });
      return response;
    } catch (error) {
      calls.push({
        sequence: calls.length,
        requestOccurrence,
        url: url.href,
        method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams),
        startedAt,
        completedAt: new Date().toISOString(),
        status: null,
        ok: false,
        rawOutput: null,
        returnedProducts: [],
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  try {
    return { result: await run(), calls, captureComplete };
  } catch (error) {
    return { error, calls, captureComplete };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
