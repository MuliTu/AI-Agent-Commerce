import { HttpResponse, delay, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogError, DummyJsonCatalogClient, type CatalogFetch } from '../../src/lib/catalog';

const product = {
  id: 1,
  title: 'Essence Mascara',
  description: 'Validated description',
  category: 'beauty',
  price: 9.99,
  rating: 4.5,
  stock: 12,
  tags: ['beauty'],
  thumbnail: 'https://example.test/product.png',
  images: ['https://example.test/product.png'],
};

const page = { products: [product], total: 1, skip: 0, limit: 30 };
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImplementation: CatalogFetch, timeoutMs = 100): DummyJsonCatalogClient {
  return new DummyJsonCatalogClient({
    baseUrl: 'https://catalog.test',
    fetch: fetchImplementation,
    timeoutMs,
  });
}

describe('DummyJsonCatalogClient', () => {
  it('validates and normalizes every supplied endpoint family', async () => {
    server.use(
      http.get('https://catalog.test/products', () => HttpResponse.json(page)),
      http.get('https://catalog.test/products/1', () => HttpResponse.json(product)),
      http.get('https://catalog.test/products/search', () => HttpResponse.json(page)),
      http.get('https://catalog.test/products/categories', () => HttpResponse.json([
        { slug: 'beauty', name: 'Beauty', url: 'https://dummyjson.com/products/category/beauty' },
      ])),
      http.get('https://catalog.test/products/category-list', () => HttpResponse.json(['beauty'])),
      http.get('https://catalog.test/products/category/beauty', () => HttpResponse.json(page)),
    );
    const client = clientWith(globalThis.fetch);

    await expect(client.listProducts()).resolves.toMatchObject({ products: [{ id: 1 }], total: 1 });
    await expect(client.getProduct(1)).resolves.toMatchObject({ id: 1, tags: ['beauty'] });
    await expect(client.searchProducts({ query: 'mascara' })).resolves.toMatchObject({ products: [{ id: 1 }] });
    await expect(client.listCategories()).resolves.toEqual([
      { slug: 'beauty', name: 'Beauty', url: 'https://dummyjson.com/products/category/beauty' },
    ]);
    await expect(client.listCategorySlugs()).resolves.toEqual(['beauty']);
    await expect(client.listProductsByCategory('beauty')).resolves.toMatchObject({ products: [{ category: 'beauty' }] });
  });

  it('supports empty pages and emits encoded, documented query parameters', async () => {
    const urls: string[] = [];
    const fetchImplementation: CatalogFetch = async (input) => {
      urls.push(String(input));
      return jsonResponse({ products: [], total: 0, skip: 2, limit: 5 });
    };
    const client = clientWith(fetchImplementation);

    await expect(client.listProducts({
      limit: 5,
      skip: 2,
      select: ['title', 'price'],
      sortBy: 'price',
      order: 'desc',
    })).resolves.toEqual({ products: [], total: 0, skip: 2, limit: 5 });
    await client.searchProducts({ query: 'phone & case', limit: 5, skip: 2 });
    await client.listProductsByCategory('smart phones', { limit: 5, skip: 2 });

    expect(urls).toEqual([
      'https://catalog.test/products?limit=5&skip=2&select=id%2Ctitle%2Ccategory%2Cprice&sortBy=price&order=desc',
      'https://catalog.test/products/search?q=phone+%26+case&limit=5&skip=2',
      'https://catalog.test/products/category/smart%20phones?limit=5&skip=2',
    ]);
  });

  it('rejects invalid request parameters before calling the transport', async () => {
    const fetchImplementation = vi.fn<CatalogFetch>();
    const client = clientWith(fetchImplementation);

    await expect(client.listProducts({ limit: -1 })).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(client.listProducts({ order: 'asc' })).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(client.searchProducts({ query: '   ' })).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(client.getProduct(0)).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('normalizes malformed JSON and schema-invalid product facts', async () => {
    server.use(http.get('https://catalog.test/products', () => new HttpResponse('{', { status: 200 })));
    const malformedClient = clientWith(globalThis.fetch);

    await expect(malformedClient.listProducts()).rejects.toMatchObject({
      kind: 'invalid_response',
      endpoint: '/products',
    });

    server.use(http.get('https://catalog.test/products', () => HttpResponse.json({
      products: [{ ...product, price: -4 }],
      total: 1,
      skip: 0,
      limit: 30,
    })));
    const invalidClient = clientWith(globalThis.fetch);
    await expect(invalidClient.listProducts()).rejects.toMatchObject({
      kind: 'invalid_response',
      endpoint: '/products',
    });
  });

  it.each([404, 500])('normalizes HTTP %i without reading untrusted response bodies', async (status) => {
    server.use(http.get('https://catalog.test/products/1', () => new HttpResponse('unsafe details', { status })));
    const client = clientWith(globalThis.fetch);
    const error = await client.getProduct(1).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CatalogError);
    expect(error).toMatchObject({ kind: 'http', status, endpoint: '/products/1' });
    expect((error as Error).message).not.toContain('unsafe details');
  });

  it('distinguishes network failure from a bounded timeout', async () => {
    server.use(
      http.get('https://catalog.test/products/category-list', () => HttpResponse.error()),
      http.get('https://catalog.test/products/categories', async () => {
        await delay('infinite');
        return HttpResponse.json([]);
      }),
    );
    const networkClient = clientWith(globalThis.fetch);
    const timeoutClient = clientWith(globalThis.fetch, 5);

    await expect(networkClient.listCategorySlugs()).rejects.toMatchObject({
      kind: 'network',
      endpoint: '/products/category-list',
    });
    await expect(timeoutClient.listCategories()).rejects.toMatchObject({
      kind: 'timeout',
      endpoint: '/products/categories',
    });
  });

  it('classifies a timeout while reading the response body as timeout', async () => {
    const fetchImplementation: CatalogFetch = async (_input, init) => new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const client = clientWith(fetchImplementation, 5);

    await expect(client.listProducts()).rejects.toMatchObject({
      kind: 'timeout',
      endpoint: '/products',
    });
  });
});
