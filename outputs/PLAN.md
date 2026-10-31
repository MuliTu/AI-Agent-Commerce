# Bazak AI Agent Commerce — Delivery Plan

## Planning principles

The plan prioritizes a demonstrable vertical slice, then correctness, then resilience and polish. It is staged to finish before **November 1, 2026 at 23:59 (Asia/Jerusalem)** and intentionally leaves contingency time.

No phase below should be reported as complete until its exit checks pass.

## Stage 0 — Confirm and baseline (October 26)

### Work

- Record assumptions and send the optional persistence clarification only if useful.
- Initialize Next.js, TypeScript, linting, environment validation, and test commands.
- Add the supplied OpenAPI file to the repository as reference material.
- Define shared product, conversation, intent, tool-result, and error types.
- Draft the README structure early so evidence is captured during implementation.

### Exit checks

- Application and test runner start locally.
- Required environment variables fail with a clear message.
- Scope and unresolved questions are visible in the repository.

## Stage 1 — Catalog vertical slice (October 27)

### Work

- Build a typed DummyJSON client for list, detail, search, categories, and category endpoints.
- Normalize product records into the application model.
- Cache or snapshot the catalog appropriately for development and deterministic tests.
- Implement hard constraint filtering.
- Implement the first semantic/lexical ranking baseline and grounded match reasons.
- Render a basic product grid using application-owned React components.

### Exit checks

- A typed search request returns only real catalog products.
- Price, category, and availability constraints behave deterministically.
- Empty catalog results are handled clearly.
- Ranking tests use known fixtures and stable expected ordering.

## Stage 2 — Single Agent orchestration (October 28)

### Work

- Integrate the Vercel AI SDK and GPT-5.4-mini.
- Define schema-validated tools and structured intent extraction.
- Support multiple intents in one turn with per-intent state.
- Add adaptive clarification logic.
- Stream conversational text/status while keeping product payloads typed and trusted.
- Render separate intent sections and partial results.

### Exit checks

- Single-intent, multi-intent, refinement, and clarification flows work.
- A prompt-injected product name cannot bypass the catalog.
- One intent failure does not erase another intent's successful results.
- The system never executes model-authored HTML.

## Stage 3 — Server persistence and recoverable client flow (October 29)

### Work

- Add SQLite migrations and repositories for conversations, messages, turns, intents, and tool runs.
- Assign stable conversation and turn IDs.
- Separate accepted server work from the browser stream.
- Add status reads/polling or reconnection so a new client can recover persisted results.
- Detect stale `running` turns at startup and transition or safely retry them according to a documented policy.
- Document the deployment-storage limitation explicitly.

### Exit checks

- Refreshing during or after a turn recovers the recorded state.
- A second client with the conversation ID sees the same persisted conversation.
- Disconnecting the first client does not itself cancel accepted server work.
- A server shutdown is represented honestly: work does not falsely appear completed or continuously running.

## Stage 4 — Reliability and automated tests (October 30)

### Work

- Add a shared transient-error classifier.
- Implement capped exponential backoff with jitter and **five total attempts**.
- Add idempotency protection and attempt records.
- Cover domain logic with Vitest.
- Mock the catalog and provider boundaries with MSW.
- Add Playwright paths for primary, clarification, multi-intent, reconnect, empty, and error journeys.
- Run local agent/evaluation cases with Ollama, then a smaller provider-realistic suite with OpenAI.

### Exit checks

- The retry suite proves exactly five total attempts, not five retries after the initial attempt.
- Permanent failures are not retried.
- Automated tests cover partial success and stale execution recovery.
- Provider-dependent tests are tagged, budget-bounded, and not required for every offline unit run.

## Stage 5 — UX, evaluation, and documentation (October 31)

### Work

- Improve responsive and accessible product UI.
- Add loading, queued, partial, empty, retrying, failed, and reconnected states.
- Run a prompt/evaluation matrix and record results.
- Complete the README, architecture notes, limitations, setup, and evidence.
- Record a concise demo path and screenshots if appropriate.

### Exit checks

- A reviewer can set up and run the project from the README alone.
- The README distinguishes implemented, partially implemented, and proposed behavior.
- Known limitations include SQLite/deployment durability and server-shutdown semantics.
- The “another week” response is included as reflection, not disguised unfinished scope.

## Stage 6 — Submission buffer (November 1, before 23:59)

### Work

- Run clean-install, lint, type-check, unit/integration, and Playwright smoke checks.
- Verify required environment-variable and fallback instructions.
- Review repository for secrets, generated noise, broken links, and unsupported claims.
- Tag or package the final submission and verify it from a clean checkout.

### Scope fallback order

If time is constrained, preserve in this order:

1. Catalog-grounded recommendation correctness
2. Single Agent multi-intent orchestration
3. Clear, composable product UI
4. Deterministic automated tests
5. Server-side persistence and reconnect behavior
6. Advanced semantic tuning and visual polish

Any omitted or simplified item must be described plainly in the README.

## Workstreams and dependencies

| Workstream | Depends on | Deliverable |
|---|---|---|
| Catalog | Supplied OpenAPI contract | Typed client, normalized fixtures, filters |
| Ranking | Normalized catalog | Ranked candidates and explanations |
| Agent | Types, catalog tools | Multi-intent orchestration and clarification |
| UI | Typed agent events/results | Composable conversational product experience |
| Persistence | Domain model | SQLite schema, repositories, reconnect state |
| Reliability | Provider/catalog boundaries | Retry and partial-failure handling |
| Testing | All stable boundaries | Vitest/MSW/Playwright and model evaluations |
| Documentation | Verified behavior | Honest README and architecture notes |

## Definition of done

- Acceptance criteria in `SPEC.md` are mapped to passing tests or documented manual evidence.
- Test layers in `TEST_PLAN.md` have been executed at the appropriate level.
- Architectural choices in `DECISIONS.md` match the delivered code.
- README commands work from a clean checkout.
- No text claims that execution survives server shutdown.
- Submission is delivered before the stated deadline.

## MYW-34 implementation slice

1. Harden category resolution with Hebrew aliases and remove unrelated fallback behavior for unknown catalog categories.
2. Preserve same-conversation context for constraint-only follow-ups, deterministically repair a missing prior intent identity when only one current product topic is plausible, and clarify among only the plausible current topics when it is not.
3. Make an explicit product topic change override stale or provider-suggested categories, including Hebrew kitchen-plate requests.
4. Improve both central system prompts for follow-up context, topic switches, accurate empty results, and catalog-only boundaries.
5. Localize deterministic orchestration feedback and require provider-facing response copy to follow the shopper language.
6. Render unsupported and unknown catalog goals once as compact prose while preserving supported sibling outcomes; classify weather and other off-topic requests before catalog lookup.
7. Describe valid zero-match searches as completed empty results with relevant category/filter recovery copy. A price picker remains discussion-only and is not implemented.
8. Replace the empty chat message with the centered Bazak welcome/composer lifecycle; remove local-workspace profile chrome and strengthen Bazak identity.
9. Standardize grid/card geometry across categories, including LTR catalog content inside RTL turns and bottom-pinned match reasoning.
10. Verify exact Hebrew and English same-conversation journeys, explicit and ambiguous follow-ups, topic switches, off-topic and mixed requests, invalid choices, restore behavior, accessibility, reduced motion, desktop/mobile layout, static checks, unit/integration tests, build, and Playwright.

## Live QA remediation slice

Execute the five bounded tasks in `QA_REMEDIATION_TASKS_2026-10-30.md`, integrate them behind deterministic orchestration boundaries, run the full static/unit/browser gate, and hand the exact original scenarios plus 20 new creativity-rated cases to an independent live-provider QA run. Do not treat deterministic fixtures as live-model evidence.

## October 31 evidence-grounding closure

1. Keep deterministic price, stock, rating, category, and positive-brand constraints authoritative.
2. Detect unsupported constraint semantics before provider planning and return issue-specific guidance.
3. Scope explicit refinements and evidence requirements to the correct intent in English and Hebrew.
4. Require trusted catalog evidence for reviewed and open-vocabulary explicit feature-proof requests; fail safely when evidence is absent or unresolved.
5. Preserve ordinary descriptive browsing as soft ranking context.
6. Verify deterministic unit/integration/browser gates and run bounded independent live matrices with positive, negative, unseen-feature, and regression controls.
7. Record the final sampled provider evidence without claiming universal semantic coverage.

## Local semantic-evidence experiment (separate branch, not submission baseline)

1. Add a provider-neutral semantic evaluator interface and strict structured result schema: product ID, requirement, `supported | contradicted | unknown`, confidence, and exact catalog evidence.
2. Insert the experiment after deterministic hard filtering and before final soft ranking. Never let the evaluator restore a product removed by price, stock, rating, category, or brand constraints.
3. Run in shadow mode by default: record bounded diagnostics and disagreements while keeping baseline user-visible results unchanged.
4. Reuse the existing OpenAI-compatible model factory for both hosted OpenAI and the local LiteLLM/Ollama route; do not add credentials or change persistent network configuration.
5. Validate every returned evidence quote as an exact substring of trusted title, description, or tags. Treat confidence and similarity as advisory, never proof.
6. Add deterministic evaluator fixtures for supported, contradicted, unknown, malformed output, provider failure, synonym ambiguity, and multi-intent isolation.
7. If the local model is already reachable, run a bounded smoke evaluation and record the exact model/endpoint label without exposing credentials. Otherwise report the connection blocker and keep offline tests green.
8. Compare precision-first hard-evidence behavior separately from soft reranking quality. Do not enable result-changing semantic decisions without labelled evaluation and explicit approval.
