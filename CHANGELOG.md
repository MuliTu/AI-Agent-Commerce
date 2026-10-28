# Changelog

All notable product changes are recorded here.

## 0.3.0-local.3 — 2026-10-28 (unreleased local candidate)

- Fixed the independently reproduced multi-intent empty-result bug by preventing provider-inferred tags from becoming exact catalog filters and by replacing unusable provider prose with bounded shopper-safe copy.
- Fixed the 30-second completion race with bounded read-only reconciliation that distinguishes terminal, still-running, unavailable, and cancelled states without repeating the accepted operation.
- Added deterministic regression coverage for the observed provider plan and timeout-boundary recovery outcomes.
- Rewrote setup, architecture, retrieval, persistence-failure, test-limit, rejected-alternative, and another-week documentation; separated original employer requirements from project-authored targets.

This local prerelease has not been tagged, published, or deployed.

## 0.3.0-local.2 — 2026-10-28 (unreleased local candidate)

- Added SQLite-backed conversation history, stable URL recovery, and persisted turn lifecycle.
- Added saved-conversation navigation with rename and reversible removal.
- Added explicit real-provider configuration for OpenAI and local LiteLLM testing; runtime demo fallback remains removed.
- Refined the responsive commerce UI, clarification routing, retry states, and development-only request activity.
- Fixed category-first shopping search with deterministic DummyJSON category aliases and validation, complete bounded pagination, explicit per-intent filters, and stable ranking.
- Added ascending price sorting for “cheap” requests without inventing a budget, plus explicit USD-only budget handling that rejects ILS as USD without blocking independent intents.
- Added five-at-a-time “Show more” results with stable IDs, preserved ordering and filters, recovery-safe state, and regression coverage for category, multi-intent, currency, empty-result, pagination, and clarification behavior.
- Reworked the conversation shell with independent chat/history scrolling, a sticky composer, right-aligned shopper messages, left-aligned assistant responses, and clearer grouping for multi-intent results.
- Removed internal/demo-facing Requests, model labels, prompt starters, example prompts, recovery explainer, and detached partial-result UI from the shopper experience.
- Scoped each result group to its originating assistant turn, reset unrelated prior results on a new topic, added an honest product-catalog boundary for flight requests, and cleared/restored composer drafts safely around send failures.
- Centralized actual LLM system prompts in `src/lib/ai/prompts`, one named prompt per file, while keeping deterministic UI copy separate.

This local prerelease has not been tagged, published, or deployed.

## [0.2.0] - 2026-10-27

### Added

- Typed DummyJSON catalog client for product listing, detail, search, and category endpoints.
- Runtime request and response validation with normalized catalog errors.
- MSW-backed coverage for success, malformed payload, HTTP failure, network failure, and timeout behavior.

## [0.1.0] - 2026-10-27

### Added

- Next.js and TypeScript application foundation.
- Environment validation and shared domain contracts.
- Product specification, delivery plan, architecture decisions, and test plan.
