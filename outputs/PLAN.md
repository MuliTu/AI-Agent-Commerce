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

**Status (October 31):** Active on local-only branch `local/semantic-evidence-shadow`, based on verified baseline commit `828f4e8`. Direction changed from observation-only to a user-visible evidence-tier reranker using the existing assignment OpenAI configuration. The branch must not be pushed, merged, or deployed without a separate decision.

1. Add a provider-neutral semantic evaluator interface and strict structured result schema: product ID, requirement, `supported | partial | contradicted | unknown`, confidence, relevance score, and exact catalog evidence.
2. Insert the experiment after deterministic hard filtering and before final soft ranking. Never let the evaluator restore a product removed by price, stock, rating, category, or brand constraints.
3. After hard filtering, order normal relevance results by evidence tier (`supported`, `partial`, `unknown`) and then by bounded semantic relevance score; exclude `contradicted`.
4. Preserve strict exclusion for explicit only-verified requests. Related or unknown products must never be labeled as verified.
5. Reuse the existing configured OpenAI provider and assignment credential without printing, copying, or changing it. Keep the provider abstraction compatible with LiteLLM/Ollama for later work.
6. Validate every returned evidence quote as an exact substring of trusted title, description, or tags. Treat confidence and similarity as advisory, never proof.
7. Add deterministic evaluator fixtures for supported, partial, contradicted, unknown, malformed output, provider timeout, synonym ambiguity, scoring boundaries, multi-intent isolation, strict-only behavior, and UI labels.
8. Prepare 15 creative ambiguous/colloquial prompts against real catalog fields for independent QA. Do not run this live matrix during implementation.
9. Run static, unit/integration, build, and Playwright gates. Independent QA then runs the 15 live OpenAI cases and records expected versus actual tiers, scores, ordering, latency, and fallback behavior.

### Live A/B remediation after the first 15-case run

1. Broaden strict activation to natural `confirms`/documented wording and keep strict fallback fail-closed.
2. Add deterministic evidence consistency so literal full-feature quotes (for example `slim`) cannot be rejected as merely partial, without promoting related-only evidence such as satellite SOS to satellite calling.
3. Evaluate every product that will receive a semantic label. Remove unevaluated overflow instead of presenting it as `unknown: 0`.
4. Persist a user-safe semantic status and disclose deterministic fallback in both API copy and UI summary.
5. Derive response claims from actual card tiers so mixed verified/partial/unknown results cannot be described as verified-only.
6. Fix upstream contextual-negation and category-synonym failures that prevent retrieval before reranking.
7. Replay the same failed live cases independently and compare latency, tiers, evidence, ordering and fallback with the first A/B report.

### Second live retest closure

1. Extract strict adjective-before-category requirements before semantic evaluation so Q08 uses `slim`, not a planner-expanded sentence.
2. Permit deterministic direct support to combine exact spans across title, description and tags, covering Q10's color title plus basketball description without weakening hard constraints.
3. Add a bounded negative-preference evidence rule for Q11's reviewed daytime-fresh wording: both normalized unwanted terms must appear as complete tokens in trusted text before a product is excluded; unrelated free-form negation remains model-assessed rather than becoming a new hard filter.
4. Match deterministic evidence at normalized token/phrase boundaries and test substring traps, over-budget slim distractors, and out-of-stock exact shoes.
5. Keep related-only satellite evidence partial, preserve strict fail-closed behavior, and rerun Q08 plus Q10/Q11 controls independently.

### Submission-comparison Q02 closure

1. Extract a bounded high-quality-selfie requirement from explicit English or Hebrew selfie-quality wording, rather than passing only a broad provider-generated query to the evidence evaluator.
2. Promote only literal whole-phrase catalog evidence such as `high-quality selfies`; do not treat a generic selfie/front-camera mention as proof of sharp or flattering output.
3. Add real-shaped Vivo V9, generic selfie-camera, unrelated camera-phone, and over-budget controls; verify deterministic price filtering still occurs before semantic evaluation.
4. Rerun deterministic and browser gates, then hand Q02 to independent live QA. Do not use the implementation run to self-certify model stability.

## Semantic action resolution implementation sequence (approved)

1. Strengthen the separate live harness first: preserve Q01–Q15, assert unique grounded IDs, hard-filter precedence, exact evidence quotes, tier/score ordering, strict-only behavior, fallback disclosure and explicit price-first ordering. Preserve ordinary Vitest/Playwright discovery.
2. Add a provider-facing ordered action schema while retaining the existing single provider call. Use opaque application-resolved displayed-product references and trusted existing-intent IDs.
3. Validate the complete action plan before product search. Invalid/stale references, ambiguous budget ownership and comparative price requests without a trusted baseline clarify or fail closed without catalog retrieval.
4. Execute actions through a staged reducer. Persist active results, bounded durable paused outcomes, focus and decision/tool evidence in the existing atomic completion transaction. Old state remains readable without a destructive migration.
5. Add English/Hebrew paraphrase, negative, idempotency and process/repository recreation tests. Run the same named live scenarios before and after; reuse trustworthy saved evidence where acceptance criteria have not changed, and mark changed-criterion judge evidence inconclusive rather than spending calls implicitly.
6. Obtain independent verification and review before a local commit. No push, merge or deployment is part of this plan.

Stop and request approval if implementation requires another LLM call, a destructive data rewrite, a new dependency, or a production raw-prompt logging policy.

### Additive-topic follow-up and correlated diagnostics

1. Reproduce phone → “Also show me perfumes under $100” → “Show me cheaper options” with a deterministic three-turn regression.
2. Prevent an unmatched explicit new category from being rebound to the sole prior intent; preserve prior outcomes only when the prompt explicitly marks the new topic as additive.
3. Clarify the target for a category-free comparative follow-up when both preserved topics remain active; after the category is known, require an explicit maximum price unless a displayed product supplies a trustworthy comparison baseline.
4. Add opt-in structured server diagnostics for request, plan, target decision, search constraints, results and errors, correlated without exposing credentials or full provider/catalog envelopes.
5. Verify summary versus bounded development-only verbose logging, run full checks, and leave all existing conversations untouched.

### Experiment exit criteria

- Offline tests prove schema validation, exact-quote validation, provider-failure fallback, multi-intent isolation, tier ordering, strict-only filtering, and visible labels.
- The evaluator observes only bounded post-filter candidates and cannot restore a product removed by deterministic constraints.
- Any local LiteLLM/Ollama smoke run reports availability and behavior without changing credentials or persistent configuration.
- A local commit records the experiment; no remote branch, merge, or deployment occurs.

## Versioned conversation-memory remediation

1. Add an additive SQLite migration for versioned conversation state and bounded decision events; do not rewrite existing rows.
2. Centralize context projection so runtime context comes from server persistence rather than the client-supplied `previous` payload.
3. Persist explicit add/replace/refine/clarify/select-product transitions and an unambiguous focus in the same completion transaction.
4. Resolve displayed ordinals from stored result order; bypass the LLM for selection-only turns, validate and enforce the referenced intent/category for compound turns, treat comparative `cheaper` as a strict saved-price boundary, request `maxPrice` when that boundary is absent, and leave generic `cheap` as sorting only.
5. Make explicit price ordering authoritative through semantic reranking without inventing a new budget.
6. Persist catalog tool input summaries and returned product IDs, with no raw provider or secret-bearing payloads.
7. Verify migration compatibility, restart recovery, idempotent retry, additive multi-intent behavior, ordinal selection, price order, static checks, build and browser regression gates.

**Rollback boundary:** v5 rejects an applied migration marker it does not know, so code rollback is not automatic. Stop all application writers, back up the SQLite file, and transactionally delete only `schema_migrations.version = 6`; retain both additive tables and every row. The v5 application then starts while ignoring the retained tables. Migration 6 uses `IF NOT EXISTS`, so roll-forward records the marker again without replacing state or decision data. This procedure is covered by a rollback/roll-forward repository test.
# Submission recovery addendum — 2026-11-01

1. Preserve the dirty main checkout and rebuild on a stable isolated branch.
2. Restore durable display groups, selected references, strict harness grounding, and failed manual regressions.
3. Run deterministic unit/integration, harness, build, and Playwright gates.
4. Run the original 23 live turns plus bounded flight/weather/mixed creative cases with real OpenAI and DummyJSON.
5. Store raw artifacts and a human-readable consolidated report under project-local `var/evaluations/live-ai/`.
