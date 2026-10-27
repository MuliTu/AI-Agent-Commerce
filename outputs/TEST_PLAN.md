# Bazak AI Agent Commerce — Test Plan

## 1. Objectives

Verify that the intended application is catalog-grounded, handles multiple shopping intents coherently, clarifies only when useful, renders trusted product UI, persists state server-side, recovers from client disconnects, and fails predictably.

This is a planned verification strategy; it does not assert that these tests or features already exist.

## 2. Test layers

| Layer | Primary tooling | Purpose |
|---|---|---|
| Unit | Vitest | Parsing, filtering, ranking, state transitions, retry classification |
| Integration | Vitest + MSW | Catalog/provider boundaries, persistence repositories, orchestration events |
| Browser | Playwright | Full shopper journeys, UI states, refresh/reconnect, accessibility smoke |
| Local model evaluation | Ollama | Cheap repeatable intent/clarification exercises without hosted-provider dependence |
| Target-provider evaluation | OpenAI / GPT-5.4-mini | Validate the actual model integration and behavioral rubric |

## 3. Unit tests with Vitest

### Catalog and constraints

- Normalize every relevant Product field from the supplied contract.
- Reject malformed or missing product IDs.
- Enforce maximum price, category, availability, minimum rating, brand, and tags.
- Treat explicit hard constraints as filters, not ranking suggestions.
- Produce stable lexical fallback order for fixtures.
- Ensure ranking reasons cite only fields available on the product.

### Multi-intent orchestration

- Convert one request into one intent.
- Convert a combined request into distinct intents without losing shared context.
- Preserve intent IDs and constraints across refinement turns.
- Allow ready intents to proceed while another awaits clarification.
- Combine completed/failed intent states into correct turn status (`completed`, `partial`, or `failed`).

### Adaptive clarification

- Do not clarify when strong candidates satisfy explicit constraints.
- Clarify when there are no candidates because a likely-correctable constraint is ambiguous.
- Clarify when candidate groups differ on a high-impact preference.
- Ask only one focused question per clarification step.
- Do not ask again for a value already present in conversation state.

### Retry policy

- Success on attempt 1 performs exactly one call.
- Four transient failures followed by success perform exactly five total calls.
- Five transient failures stop after exactly five total calls.
- A permanent 4xx, schema error, or authentication error performs one call.
- Backoff is capped and jitter is injectable/deterministic under test.
- Repeating a turn/tool operation uses the same idempotency key where required.

### Persistence state machine

- Legal turn transitions succeed; illegal transitions are rejected.
- Persisted messages and intent results reload in order.
- Replaying a completion event does not duplicate results.
- Startup recovery identifies stale `running` records and applies the documented transition/retry policy.

## 4. Integration tests with MSW

Mock network boundaries rather than internal implementation details.

### DummyJSON API

- Successful list, search, category, detail, and pagination responses
- Empty results
- Malformed payload
- Timeout/network failure
- Rate limit and retryable 5xx responses
- Permanent 4xx response
- Partial field availability and missing image fallback

### Model/provider boundary

- Valid single-intent tool call
- Valid multi-intent structured output
- Clarification response without a catalog call
- Invalid tool arguments rejected by schema validation
- Unknown product ID rejected before rendering
- Tool-call loop bounded by a maximum step count
- Provider timeout/rate limit follows the five-total-attempt policy

### SQLite

- Migrations work on an empty database.
- Conversation, messages, turns, intents, tool attempts, and results round-trip.
- Transaction rollback prevents half-written completed turns.
- Two client reads observe the same committed state.
- Temporary test databases are isolated.

## 5. Playwright journeys

1. **Single intent:** Ask for a product with a price constraint; receive catalog-backed cards.
2. **Multi-intent:** Ask for two product types; receive separate intent sections in one coherent answer.
3. **Adaptive clarification:** Submit an ambiguous, materially broad request; answer one focused follow-up; receive results without repeating prior constraints.
4. **Refinement:** Tighten the price or change a preference; verify state and cards update.
5. **Partial success:** One intent succeeds and another fails; successful cards remain visible and the failure is scoped.
6. **Empty state:** No product satisfies hard constraints; see a useful recovery path without fabricated products.
7. **Transient retry:** Simulate eligible failures; show bounded retry status and eventual success/failure.
8. **Permanent failure:** Simulate a non-retryable error; verify no retry loop.
9. **Refresh/reconnect:** Start a turn, refresh or open a second client, and recover persisted status/results by conversation ID.
10. **Server interruption representation:** Seed or create stale `running` state, restart the test server, and verify recovery marks/retries according to policy—never falsely claiming uninterrupted execution.
11. **Accessibility smoke:** Keyboard traversal, focus visibility, labels, product image alternatives, and live status announcements.
12. **Responsive layout:** Product cards and conversation controls remain usable at mobile and desktop widths.

## 6. Model evaluation strategy

### Order

1. Run prompt cases with **Ollama** for fast/local feedback.
2. Run deterministic mocks for application invariants.
3. Run a smaller, budget-bounded suite against **OpenAI GPT-5.4-mini**.

Ollama is a development aid, not a behavioral substitute for the target model.

### Evaluation dataset

Include cases for:

- Direct product/category requests
- Lifestyle or use-case requests with no exact keyword match
- Multiple independent intents
- Shared constraint across intents
- Ambiguous budget or recipient
- Overconstrained/no-result request
- Follow-up using pronouns or prior context
- Attempts to make the agent invent products or ignore the catalog
- Requests unrelated to commerce
- Extremely long or contradictory requests

### Rubric

Score each case on:

- Intent coverage: all and only intended goals recognized
- Constraint fidelity: explicit requirements preserved
- Catalog grounding: no invented product facts or IDs
- Clarification quality: necessary, concise, and high-information
- Recommendation relevance: ranked products fit the stated use case
- Explanation faithfulness: rationales are supported by catalog data
- Multi-intent coherence: results remain separated but conversationally unified
- Safety and robustness: prompt injection does not cross trusted boundaries

Use structured assertions for invariants and a rubric for subjective quality. Avoid exact-string snapshots of model prose.

## 7. Non-functional checks

- Measure first status feedback and end-to-end completion time.
- Verify concurrent intents do not corrupt shared state.
- Confirm logs contain request/turn IDs and retry counts but no credentials.
- Confirm secrets remain server-side.
- Check database growth and indexes for common conversation/status lookups.
- Confirm cached catalog entries have a documented freshness policy.

## 8. Acceptance traceability

| Requirement | Primary evidence |
|---|---|
| Single Agent multi-intent | Vitest state tests + Playwright multi-intent journey |
| Catalog-first semantic ranking | Ranking fixtures + grounding evaluation |
| Adaptive clarification | Unit heuristic cases + browser follow-up journey |
| Composable product UI | Component tests if added + Playwright accessibility/responsive checks |
| SQLite server persistence | Repository integration tests + reconnect journey |
| Client-independent execution | Disconnect/reconnect test and recorded server status |
| Five total attempts | Fake-timer unit tests + MSW transient failures |
| Ollama/OpenAI validation | Versioned evaluation cases and summarized results |

## 9. Test data and reproducibility

- Store a small versioned catalog fixture derived from the supplied schema for deterministic tests.
- Do not depend on the live DummyJSON ordering for unit assertions.
- Pin model names and record evaluation date/configuration.
- Use fixed seeds/temperature where supported, while still asserting invariants rather than prose.
- Keep live-provider tests opt-in when credentials are absent.

## 10. Release gate

Before submission:

- Lint and type-check pass.
- Unit and integration suites pass from a clean checkout.
- Playwright critical-path smoke passes.
- At least the defined target-provider smoke set has been reviewed, or its absence is documented.
- No test or README statement claims execution survives server shutdown.
- Known flaky or incomplete tests are disclosed rather than hidden.
