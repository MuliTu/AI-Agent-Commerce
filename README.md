# Bazak AI Agent Commerce

Conversational product discovery using a Single Agent, grounded in the DummyJSON catalog.

## Current implementation

The prototype includes the Next.js App Router foundation, TypeScript domain contracts, runtime product validation, a typed DummyJSON client, stable offline catalog fixtures, a process-local expiring snapshot cache, schema-validated Vercel AI SDK catalog tools, semantic ranking, multi-intent orchestration, adaptive clarification, product cards, scoped partial failures, and explicit per-intent retry.

The shopper UI supports clearly separated deterministic demo and live-provider modes. The live provider can be the assignment-target GPT-5.4-mini boundary or an explicitly selected, loopback-only LiteLLM development boundary. Both live paths use the DummyJSON catalog. Demo mode is never an automatic fallback for a failed live request. Server-side conversation persistence and reconnect recovery are not implemented.

## Local setup

Use Node.js 22.12 or newer and npm. Run `npm ci`, then `npm run dev`. Open http://localhost:3000.

The default `AI_PROVIDER=disabled` mode needs no credentials. To enable the hosted boundary, set `AI_PROVIDER=openai` and provide a nonempty server-side `OPENAI_API_KEY`. `OPENAI_MODEL` is intentionally pinned to `gpt-5.4-mini`; the application rejects silent substitution rather than falling back to a different model.

For local development only, set `AI_PROVIDER=litellm`, `LITELLM_BASE_URL=http://127.0.0.1:4001/v1`, `LITELLM_MODEL=qwen3.5-9b`, and a server-side `LITELLM_API_KEY`. The endpoint is deliberately restricted to credential-free loopback HTTP URLs, making it suitable for a local process or an explicitly established localhost SSH tunnel. LiteLLM uses the OpenAI-compatible chat-completions boundary and the same Zod output validation as OpenAI. It never activates automatically and does not count as final GPT-5.4-mini verification. Never put credentials in `NEXT_PUBLIC_*` variables or commit environment files.

GPT-5.4-mini access is an environment assumption and has not been verified by the offline suite. `src/lib/agent/` configures three schema-validated, catalog-grounded tools (`searchCatalog`, `getProduct`, and `listCategories`) and stops an AI SDK tool loop after five completed steps. Catalog/provider failures are translated to typed errors; unknown product IDs are rejected before product data can be returned. The live route and shopper UI are connected, but the repository contains no credentials and automated tests make no live model calls.

## Verification

- `npm run check`: lint, generated Next.js route types, TypeScript, and unit tests.
- `npm run build`: production compilation.
- `npm run test:e2e`: deterministic Chrome shopper journeys, including clarification, partial failure, retry, empty results, injection defense, and responsive layout.
- `npm start`: run the production build.

Playwright runs against explicit demo mode and the disabled-provider boundary. Unit tests cover the OpenAI and LiteLLM provider selection without live credentials or network calls. A successful live OpenAI request is not claimed until a reviewer supplies an authorized local server credential and runs a separate provider check.

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
