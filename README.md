# Bazak AI Agent Commerce

Conversational product discovery using a Single Agent, grounded in the DummyJSON catalog.

## Current implementation

The prototype includes the Next.js App Router foundation, TypeScript domain contracts, runtime product validation, a typed DummyJSON client, stable offline catalog fixtures, a process-local expiring snapshot cache, schema-validated Vercel AI SDK catalog tools, semantic ranking, multi-intent orchestration, adaptive clarification, product cards, scoped partial failures, and explicit per-intent retry.

The shopper UI has no runtime demo or mock mode. Every shopping turn uses the explicitly configured server-side model provider and the DummyJSON catalog, or returns a clear configuration/provider error. Deterministic model and catalog fixtures exist only in automated tests. Server-side conversation persistence and reconnect recovery are not implemented.

## Local setup

Use Node.js 22.12 or newer and npm. Run `npm ci`, then `npm run dev`. Open http://localhost:3000.

The default `LLM_PROVIDER=disabled` mode needs no credentials and fails closed. To enable the hosted boundary, set `LLM_PROVIDER=openai`, a nonempty server-side `LLM_API_KEY`, `LLM_MODEL=gpt-5.4-mini`, and `LLM_BASE_URL=https://api.openai.com/v1`. The application rejects model or endpoint substitution instead of falling back to a different provider. Never put credentials in `NEXT_PUBLIC_*` variables or commit environment files.

On the local-only `local/litellm-testing` branch, `LLM_PROVIDER=litellm` uses the OpenAI-compatible endpoint `LLM_BASE_URL=http://127.0.0.1:4001/v1` with `LLM_MODEL=qwen3.5-9b`. Put its credential only in the ignored `LLM_API_KEY` field. The provider choice determines the protocol (OpenAI Responses or LiteLLM Chat Completions), and credentials are never forwarded to another endpoint.

GPT-5.4-mini access is an environment assumption and has not been verified by the offline suite. `src/lib/agent/` configures three schema-validated, catalog-grounded tools (`searchCatalog`, `getProduct`, and `listCategories`) and stops an AI SDK tool loop after five completed steps. Catalog/provider failures are translated to typed errors; unknown product IDs are rejected before product data can be returned. The live route and shopper UI are connected, but the repository contains no credentials and automated tests make no live model calls.

## Verification

- `npm run check`: lint, generated Next.js route types, TypeScript, and unit tests.
- `npm run build`: production compilation.
- `npm run test:e2e`: deterministic Chrome shopper journeys, including clarification, partial failure, retry, empty results, injection defense, and responsive layout.
- `npm start`: run the production build.

Playwright intercepts the provider route at the browser-test boundary and supplies deterministic schema-validated fixtures; the production application exposes no mock selector or fixture route. The suite also checks the real disabled-provider 503 boundary. A successful live OpenAI request is not claimed until a reviewer supplies an authorized local server credential and runs a separate provider check.

## Scope and delivery

Canonical specification, plan, decisions, and test plan are in `outputs/`. Delivery target: November 1, 2026 at 23:59 Asia/Jerusalem.

The current application stores no conversations. SQLite/reconnect scope is still awaiting an explicit requirement decision. If implemented, it would not imply that execution survives server shutdown; deployment durability would still depend on storage.

Cart, checkout, authentication, deployment, and production job infrastructure are outside the current implementation scope.

## Source materials

`docs/dummyjson_products_openapi.yaml` is the supplied assignment reference, preserved unchanged. Product validation tolerates omitted optional metadata while requiring identity, title, category, and price for usable catalog results.

## Catalog fixtures and snapshot policy

Offline catalog tests use the versioned files in `tests/fixtures/catalog/`.
Their provenance and manual refresh procedure are recorded alongside the data;
tests parse them with the same `catalogPageSchema` and `productSchema` used by
the live client. Unit tests never depend on network access or live API ordering.

`ExpiringSnapshotCache` is a process-local helper with an explicit caller-set
TTL. A miss or expired value invokes the supplied loader; concurrent misses are
coalesced; `refresh` replaces a snapshot only after a successful load. Values
are lost on restart and are not shared between application instances. This is
appropriate for demonstration catalog snapshots only: it does not guarantee
current price, stock or transactional inventory and is not a distributed cache.

## What I would change with another week

This section is a required reflection to complete using delivery evidence. Candidate improvements include durable queued execution, broader ranking evaluations, and stronger access isolation. They are future work, not additional mandatory scope or implemented functionality.

## Conventions

Use named exports for domain code and reusable components. Next.js route pages/layouts use the framework-required default exports. Tests live in `tests/`.
