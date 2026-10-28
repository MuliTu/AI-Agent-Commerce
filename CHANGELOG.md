# Changelog

All notable product changes are recorded here.

## 0.3.0-local.1 — 2026-10-28 (unreleased local candidate)

- Added SQLite-backed conversation history, stable URL recovery, and persisted turn lifecycle.
- Added saved-conversation navigation with rename and reversible removal.
- Added explicit real-provider configuration for OpenAI and local LiteLLM testing; runtime demo fallback remains removed.
- Refined the responsive commerce UI, clarification routing, retry states, and development-only request activity.

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
