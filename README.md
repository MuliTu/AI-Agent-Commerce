# Bazak AI Agent Commerce

Conversational product discovery using a Single Agent, grounded in the DummyJSON catalog.

## Current implementation

Tasks `BAZAK-AAC-001` through `BAZAK-AAC-003`, plus the hosted-model boundary from `BAZAK-AAC-006`: Next.js App Router foundation, TypeScript domain contracts, runtime product validation, a typed DummyJSON client, stable offline catalog fixtures, a process-local expiring snapshot cache, and schema-validated Vercel AI SDK catalog tools.

Semantic ranking, multi-intent orchestration, clarification, product cards, retries, and persistence are planned and not yet implemented. The hosted-model boundary is implemented, but the current UI does not invoke it and automated tests make no live model calls.

## Local setup

Use Node.js 22.12 or newer and npm. Run `npm ci`, then `npm run dev`. Open http://localhost:3000.

The default `AI_PROVIDER=disabled` mode needs no credentials. To enable the hosted boundary, set `AI_PROVIDER=openai` and provide a nonempty server-side `OPENAI_API_KEY`. `OPENAI_MODEL` is intentionally pinned to `gpt-5.4-mini`; the application rejects silent substitution rather than falling back to a different model. Never put credentials in `NEXT_PUBLIC_*` variables or commit environment files.

GPT-5.4-mini access is an environment assumption and has not been verified by the offline suite. `src/lib/agent/` configures three schema-validated, catalog-grounded tools (`searchCatalog`, `getProduct`, and `listCategories`) and stops an AI SDK tool loop after five completed steps. Catalog/provider failures are translated to typed errors; unknown product IDs are rejected before product data can be returned. A future orchestration task will connect this boundary to a server route and shopper UI.

## Verification

- `npm run check`: lint, generated Next.js route types, TypeScript, and unit tests.
- `npm run build`: production compilation.
- `npm start`: run the production build.

MSW is installed for later boundary simulations. Playwright, Ollama, and live OpenAI evaluation will be introduced by their respective tasks; they are not claimed as passing.

## Scope and delivery

Canonical specification, plan, decisions, and test plan are in `outputs/`. Delivery target: November 1, 2026 at 23:59 Asia/Jerusalem.

SQLite remains conditional scope. The current application stores no conversations. The planned persistence does not imply that execution survives server shutdown; deployment durability depends on storage.

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
