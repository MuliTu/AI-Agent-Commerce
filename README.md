# Bazak AI Agent Commerce

Conversational product discovery using a Single Agent, grounded in the DummyJSON catalog.

## Current implementation

Task `BAZAK-AAC-001`: Next.js App Router foundation, TypeScript domain contracts, runtime product validation, server configuration validation, an honest development landing page, ESLint, and Vitest.

Catalog retrieval, semantic ranking, Vercel AI SDK integration, multi-intent orchestration, clarification, product cards, retries, and persistence are planned and not yet implemented. No live model calls are made.

## Local setup

Use Node.js 22.12 or newer and npm. Run `npm ci`, then `npm run dev`. Open http://localhost:3000.

The foundation needs no credentials. `.env.example` documents planned provider configuration. When `AI_PROVIDER=openai`, a nonempty server-side `OPENAI_API_KEY` is required. Never put credentials in `NEXT_PUBLIC_*` variables or commit environment files. GPT-5.4-mini is the planned target; access has not been verified.

## Verification

- `npm run check`: lint, generated Next.js route types, TypeScript, and unit tests.
- `npm run build`: production compilation.
- `npm start`: run the production build.

MSW, Playwright, Ollama, and OpenAI evaluation will be introduced by their respective tasks. They are not currently installed or claimed as passing.

## Scope and delivery

Canonical specification, plan, decisions, and test plan are in `outputs/`. Delivery target: November 1, 2026 at 23:59 Asia/Jerusalem.

SQLite remains conditional scope. The current application stores no conversations. The planned persistence does not imply that execution survives server shutdown; deployment durability depends on storage.

Cart, checkout, authentication, deployment, and production job infrastructure are outside the current implementation scope.

## Source materials

`docs/dummyjson_products_openapi.yaml` is the supplied assignment reference, preserved unchanged. Product validation tolerates omitted optional metadata while requiring identity, title, category, and price for usable catalog results.

## What I would change with another week

This section is a required reflection to complete using delivery evidence. Candidate improvements include durable queued execution, broader ranking evaluations, and stronger access isolation. They are future work, not additional mandatory scope or implemented functionality.

## Conventions

Use named exports for domain code and reusable components. Next.js route pages/layouts use the framework-required default exports. Tests live in `tests/`.
