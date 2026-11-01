# Bazak AI Agent Commerce — Architecture Decision Record

This log records current decisions and proposals. “Accepted” means accepted for the intended design, not proof that it has been implemented.

## Decision summary

| ID | Decision | Status |
|---|---|---|
| D-01 | Next.js and TypeScript | Accepted design |
| D-02 | Vercel AI SDK with GPT-5.4-mini | Accepted design |
| D-03 | Single Agent with multi-intent orchestration | Accepted design |
| D-04 | Catalog-first semantic ranking | Accepted design |
| D-05 | Adaptive clarification | Accepted design |
| D-06 | Composable React product UI | Accepted design |
| D-07 | SQLite server-side persistence and client-independent execution | Proposed/accepted pending scope confirmation |
| D-08 | Five total attempts for transient failures | Accepted design |
| D-09 | Vitest, MSW, Playwright, Ollama, then OpenAI | Accepted design |
| D-10 | Staged delivery with README reflection | Accepted plan |
| D-11 | Conversation-owned result groups and independent scroll regions | Accepted design |
| D-12 | Central, one-file-per-system-prompt organization | Accepted design |
| D-13 | Fail-closed open-vocabulary catalog evidence | Accepted and implemented |
| D-14 | Model-assisted evidence-tier reranker on the local experiment branch | Active experiment |

## D-01 — Use Next.js with TypeScript

**Context:** The assignment needs server routes, a conversational React experience, and one deployable application.

**Decision:** Use Next.js and TypeScript for UI and server boundaries.

**Why:** It supports React composition, streaming/server endpoints, shared schemas, and a compact submission footprint.

**Trade-offs:** Framework conventions can hide runtime boundaries, and serverless deployment affects long-running execution and local SQLite durability. These constraints must be tested and documented.

## D-02 — Use Vercel AI SDK and GPT-5.4-mini

**Context:** The agent must stream interaction, use typed tools, and provide strong reasoning at appropriate latency/cost.

**Decision:** Use Vercel AI SDK as the orchestration/streaming integration and GPT-5.4-mini as the primary hosted model.

**Why:** The SDK provides typed tool and streaming primitives suitable for a Next.js application. GPT-5.4-mini is the chosen balance for this assignment.

**Trade-offs:** Provider availability, model drift, cost, and rate limits require explicit configuration, mocks, bounded evaluation, and graceful errors. Access must be confirmed; the design must not silently substitute a different model.

## D-03 — One agent, multiple structured intents

**Context:** A shopper can ask for several unrelated products in one message.

**Decision:** Keep one shopper-facing agent. Decompose each turn into structured intents and run catalog operations per intent.

**Why:** One agent preserves a coherent conversation and avoids cross-agent coordination overhead. Structured intents still isolate errors and permit concurrent tool work.

**Trade-offs:** The orchestrator prompt and state machine are more sophisticated. Large multi-intent turns need limits and partial-success behavior.

**Rejected alternative:** A separate autonomous agent for every intent. It adds coordination, cost, inconsistent context, and debugging difficulty without clear value for the assignment.

## D-04 — Catalog-first semantic ranking

**Context:** Recommendations must reflect the supplied commerce data, while keyword search alone may miss a shopper's underlying use case.

**Decision:** Retrieve and validate real catalog candidates, enforce hard filters, then rank candidates semantically with bounded secondary signals.

**Why:** This combines factual grounding with natural-language relevance and prevents the model from inventing purchasable items.

**Trade-offs:** Semantic scores require an embedding or comparable representation, evaluation fixtures, latency controls, and tuning. A lexical baseline should remain available for deterministic tests and fallback.

## D-05 — Clarify adaptively

**Context:** Asking too many questions creates friction; guessing material preferences creates poor recommendations.

**Decision:** Ask a single high-information question only when missing information is likely to materially alter the results. Otherwise proceed with transparent assumptions.

**Why:** It balances momentum and recommendation quality.

**Trade-offs:** “Materially alter” needs a testable heuristic. The system may occasionally ask too early or proceed too broadly, so evaluation examples are required.

## D-06 — Render application-owned, composable React UI

**Context:** Products need richer presentation than prose, but model-generated UI/HTML is unsafe and inconsistent.

**Decision:** The model emits validated intent and tool data; the app maps that data to components such as intent sections, product cards, comparisons, and clarification prompts.

**Why:** This improves safety, accessibility, testing, reuse, and visual consistency.

**Trade-offs:** The component/event contract must evolve carefully and accommodate partial streaming states.

## D-07 — Persist state in server-side SQLite

**Context:** Browser-only state is lost on refresh and ties accepted work to one client. The assignment's exact persistence expectation remains an open question.

**Decision:** Deliberately design for server-side SQLite persistence, stable turn IDs, and server-owned execution status. Confirm whether this is expected scope or an elective production-minded extension.

**Why:** It enables reconnect and cross-client recovery without introducing a larger database stack.

**Trade-offs and boundary:** Local SQLite is simple but single-node. Its durability depends on the deployment filesystem. It does not keep code running through server shutdown. Client-independent means browser disconnect does not cancel accepted server work; it does **not** mean server-independent or shutdown-proof execution.

**Startup recovery policy:** When a server process first opens the repository, any leftover `queued` or `running` turn is transitioned to `failed` with the machine-readable reason `server_restart`. The application does not automatically replay it because a provider or catalog request may already have consumed cost or produced an uncertain outcome. The UI reports the interruption and the shopper may submit a new turn explicitly. This policy is bounded, idempotent, and never presents stale work as still running.

**Future production alternative:** A managed durable database plus queue/worker lease model for distributed execution and restart-safe jobs.

## D-08 — Limit transient retries to five total attempts

**Context:** Catalog and model calls can fail transiently, but unbounded retries increase cost and latency.

**Decision:** Make at most five total attempts: one initial call and four retries, with capped exponential backoff and jitter.

**Why:** The wording is unambiguous, bounded, observable, and testable.

**Trade-offs:** A request may still fail during a longer outage. Permanent and validation errors must bypass retries.

## D-09 — Layer deterministic and provider-realistic testing

**Context:** Agent applications combine deterministic code with nondeterministic provider behavior.

**Decision:** Use Vitest for domain logic, MSW for boundary simulations, Playwright for user journeys, Ollama for repeatable/local model exercises, and OpenAI last for a smaller real-provider suite.

**Why:** Fast tests catch most regressions cheaply; local model runs reduce provider dependence; OpenAI verification checks the actual target integration.

**Trade-offs:** Ollama is not behaviorally identical to GPT-5.4-mini. Model evaluations should use invariants and rubrics rather than brittle exact strings.

## D-10 — Deliver in stages and treat “another week” as reflection

**Context:** The available week supports a disciplined submission but does not imply every production feature is mandatory.

**Decision:** Build and verify in staged vertical slices. Answer “what would you change with another week?” in the README as a retrospective/future-work section.

**Why:** It protects core quality and distinguishes required work from thoughtful extension.

**Trade-offs:** Some polish may be deferred. Deferred work must be explicit rather than implied to exist.

## D-11 — Keep results inside the conversation turn that produced them

**Context:** Detached result panels and a shared “latest results” area make old products look current after the shopper changes topics. A growing page also causes the composer and saved-conversation history to compete with document scrolling.

**Decision:** Render each structured result group inside its originating Bazak message. A new, unrelated intent starts a new result scope; explicit refinements may retain the referenced intent and its successful siblings. The chat transcript and saved-conversation list scroll independently, while the composer remains anchored at the bottom of the workspace. Shopper messages align right and Bazak messages align left.

**Why:** Conversation ownership makes context visible, prevents stale results from masquerading as the latest answer, and matches familiar chat interaction. Independent scroll regions keep navigation and input available without duplicating content.

**Trade-offs:** Long historical turns remain in the transcript and may still be expensive to render. The implementation therefore needs stable persisted turns and focused browser coverage for long conversations, topic changes, and mobile layouts.

## D-12 — Store actual LLM system prompts in one central directory

**Context:** Inline prompt strings are difficult to discover, review, and test, and can be confused with deterministic UI copy.

**Decision:** Store actual application LLM system prompts in `src/lib/ai/prompts`, with one clearly named file per prompt and a single barrel export. Call sites import prompt constants. UI messages, validation errors, workflow instructions, and environment configuration remain outside this directory because they are not model system prompts.

**Why:** Centralization makes prompt ownership explicit, prevents accidental duplication, and enables focused tests without coupling the UI to model instructions.

**Trade-offs:** Dynamic shopper data and previous intents are still composed at the call site, where their typed runtime context belongs.

## D-13 — Fail closed for explicit open-vocabulary evidence

**Context:** A shopper may require proof of a feature that is absent from the reviewed vocabulary, such as satellite calling. Returning generic category products would imply unsupported facts; exact wording alone can miss unknown synonyms.

**Decision:** Detect explicit proof language, extract a bounded feature phrase, and accept products only when trusted title, description, or tags contain catalog evidence. Keep reviewed synonyms for known features. If the feature or evidence cannot be resolved safely, return `unknown`/no verified products. Ordinary descriptive browsing remains soft ranking context.

**Why:** The assignment values catalog grounding over recall. An honest false negative is safer and easier to defend than a fabricated feature match.

**Alternatives considered:**

1. Treat every adjective or use case as a hard filter. Rejected because it would over-block normal browsing and empty many useful category searches.
2. Use fuzzy similarity as proof. Rejected because related text is not necessarily equivalent: satellite SOS does not establish satellite voice calling.
3. Maintain only a fixed feature vocabulary. Retained as a high-quality fast path, but insufficient alone for unseen explicit proof requests.

**Trade-offs:** Unknown synonyms can produce false negatives. Generic evidence extraction is intentionally lexical and conservative. Curated features retain broader reviewed synonyms.

## D-14 — Use evidence tiers for visible semantic reranking on the local experiment branch

**Context:** Conservative lexical evidence may miss valid paraphrases. The repository already supports hosted OpenAI and a local LiteLLM-compatible Qwen/Ollama route.

**Experimental decision:** On the local-only `local/semantic-evidence-shadow` branch, let the configured assignment OpenAI provider reorder post-filter candidates into truthful evidence tiers: `supported`, `partial`, `unknown`, and internal `contradicted`. Each assessment includes confidence, a separate relevance score, product ID, requirement, and exact trusted catalog evidence. Supported products appear first, partial/related products next with a visible qualification, unknown products last, and contradicted products are excluded. An explicit “only verified” request keeps only supported products.

**Why:** Customers benefit when colloquial wording and catalog paraphrases influence ordering, but relevance must not be presented as proof. Tier-first ordering makes “satellite voice calling” stronger than related “satellite SOS messaging” while still allowing the related option to appear honestly for a normal relevance request.

**Alternatives considered:**

1. Replace deterministic ranking and filters with a model reranker. Rejected: price, stock, category, rating, and positive-brand rules must remain deterministic.
2. Use embeddings alone. Rejected for hard proof because similarity cannot establish factual equivalence, though embeddings remain viable for soft ordering later.
3. Call a model once per product. Rejected because it multiplies latency, cost, and failure surface; a bounded batch per intent is preferable.
4. Treat every semantically related product as satisfying the feature. Rejected because related evidence is not verification and would mislead the shopper.
5. Hide every non-supported product. Rejected for normal relevance requests because it discards useful alternatives; retained when the shopper explicitly asks for only verified matches.

**Score policy:** Evidence tier is the primary order and cannot be overridden by a score. The model relevance score orders products only within the same tier; ties preserve the deterministic pre-rerank order—lexical relevance normally, or price ascending when requested. Confidence describes the model assessment, not product truth. Every non-unknown claim requires a validated catalog quote.

**Risks and gates:** Exact evidence spans must be verified against trusted fields; similarity, relevance score and confidence are not proof; provider timeout or invalid output falls back to the existing lexical/evidence behavior; explicit only-verified requests fail closed. Hosted OpenAI adds latency and usage cost, so the batch is bounded and evaluated once per intent.

**Decision after the first live A/B run:** A semantic label is allowed only for evaluated products. We rejected appending candidates beyond the evaluator cap as `unknown: 0`, because “not evaluated” is not the same as “catalog evidence is unknown.” The experiment now evaluates the bounded displayed set and omits overflow. We also expose a user-safe fallback state rather than silently showing lexical order under a semantic-ordering claim.

**Evidence-consistency rule:** The model may identify related meaning, but deterministic code resolves direct literal support. A validated quote can promote `partial` to `supported` only when it contains every meaningful requested feature term after category/stop-word removal. This accepts Huawei’s literal `slim` evidence while preventing `satellite SOS` from proving `satellite calling`.

**Alternative considered:** Trust the model’s tier exactly. Rejected after the live run labeled Huawei’s literal slim description as partial and strict mode removed the correct product. The deterministic promotion is intentionally narrow and quote-bound, not a general semantic override.

**Second-retest refinement:** Q08 showed that the narrow promotion was not reached with the right requirement: the planner query carried category, budget and “no guessing” language. Strict adjective-before-category wording is now extracted deterministically (`documented slim laptops` → `slim`). Q10 showed that exact evidence can be distributed across fields, so direct support may combine validated title/description/tag spans rather than requiring every term in one field.

**Negative preference decision:** Scope deterministic negative preference handling to the reviewed “not a daytime freshie/fresh fragrance” wording, and exclude a product only when both normalized unwanted terms are directly present in trusted catalog text (`everyday` + `fresh`). This fixes CK One without pretending the application supports arbitrary `not a/an …` filters. The broader alternatives—parsing every free-form negation or inferring antonyms—were rejected as too speculative.

**Token-boundary decision:** Literal promotion and negative matching use normalized whole-token/phrase boundaries, not raw substring inclusion. Otherwise a term such as `red` could be falsely “proven” by a title such as `Predator Black`. Cross-field evidence remains allowed only when every complete requested token is present in trusted fields.

**Q02 selfie-quality decision:** Add one bounded bilingual extraction rule for explicit selfie-quality wording and map it to literal `high-quality selfie/selfies` catalog evidence. This lets deterministic validation repair an inconsistent model verdict for Vivo V9 without naming or special-casing that product. Alternatives considered were trusting the evaluator (rejected because the same catalog sentence was labeled inconsistently), treating every selfie-camera mention as supported (rejected because camera presence does not prove image quality), and adding broad inferred synonyms such as `beautiful` or `sharp` (rejected because the catalog does not establish those claims).

**Additive-topic identity decision:** An explicit category that matches no previous intent is a new topic, even when the prompt also contains a budget. If it is introduced with an additive marker such as “also,” preserve prior successful outcomes as active siblings. Reusing the sole prior intent ID was rejected because it silently changed a phone intent into perfume and erased the very ambiguity a later “cheaper” follow-up needed to expose.

**Development diagnostics decision:** Add structured, opt-in server diagnostics with a hashed per-turn correlation key. Summary mode records only bounded structural metadata; development-only verbose mode may include a truncated shopper prompt and trusted catalog product titles. Both modes exclude credentials, raw provider envelopes, catalog descriptions and database payloads. Always-on raw logging was rejected for privacy; error-only logging was rejected because it cannot explain successful-but-wrong routing decisions.

**Why this branch is separate:** The committed baseline already has independently verified fail-closed behavior. The visible reranker needs labelled live QA before it can be considered for the submission or production path.

## D-15 — Persist a versioned projection instead of replaying the transcript

**Decision:** Store a compact `conversation_state` projection and advance its revision atomically with each completed turn. Build model context from the current prompt and active intents, while retaining displayed result order for deterministic references.

**Why:** Full transcript replay increases tokens and leaves business state implicit. Deriving everything from the latest UI message loses focus, active siblings and displayed-product identity. A projection makes these contracts explicit without replacing the append-only turn history.

**Alternatives considered:**

1. Send all messages to the LLM. Rejected because cost grows with conversation length and product references remain probabilistic.
2. Make `product_snapshots` alone the state source. Rejected because snapshots do not encode intent lifecycle, focus or transition semantics.
3. Destructively backfill or rewrite old turns. Rejected because existing conversations must remain untouched.

**Migration and concurrency:** Migration 6 only adds tables. Old conversations lazily create revision 1 after their next completed turn. Turns are serialized per conversation before reading state, so two accepted turns cannot both plan from the same revision. Different conversations remain independent.

**Rollback procedure:** A pre-v6 binary rejects migration marker 6. Stop writers and back up the database, then delete only the version-6 marker inside `BEGIN IMMEDIATE`/`COMMIT`; do not drop or clear the new tables. The v5 binary ignores the retained additive tables. Because migration 6 uses `IF NOT EXISTS`, rolling forward preserves their rows and restores the marker. Automatic code-only rollback without this marker step is unsupported.

## D-16 — Resolve deterministic product references before model planning

**Decision:** Resolve “first/second/third one” against persisted displayed order when exactly one result group is in scope. A selection-only turn is completed deterministically as `select_product`. For a compound turn, pass only the resolved product's ID, title, price, category, position and prior intent ID to the bounded planner context, then validate that reference against persisted results and enforce the target intent/category in application code. Explicit cheaper and USD-budget clauses are applied deterministically; a separately named product category is searched while the exact selected product is preserved.

**Why:** Product IDs and order are application facts. Asking the model to reconstruct them from prose is unnecessary and unsafe.

**Alternative:** Give the full catalog result set to the planning model. Rejected because it increases tokens and permits hallucinated or reordered IDs. The compound-turn exception is one application-resolved product record, not a result replay. Ambiguous multi-group references remain unresolved rather than guessed.

## D-17 — Price intent outranks semantic relevance

**Decision:** `cheap` and `cheapest` request deterministic price-ascending ordering, including after semantic evaluation. Comparative `cheaper` requires either a deterministically selected product or an explicit maximum price; otherwise the application asks for the missing price threshold rather than presenting a re-sorted list as a comparison.

**Why:** Relevance-tier ordering could make a more expensive item appear first and make a valid cheaper request look unchanged. Inventing a maximum price imposes a preference the shopper did not state.

**Selected-product comparison:** When “cheaper” explicitly refers to a deterministically resolved displayed product, its persisted price is an observed comparison baseline rather than an invented budget. Results must be strictly below that price and exclude the selected product; an existing or explicit tighter maximum still applies. Without that selected baseline, `cheaper` produces a `maxPrice` clarification. Generic “cheap” remains price ordering only.

**Alternative:** Exclude all previously displayed products or derive a budget from their median. Rejected because both rules are surprising and can hide the only valid products.

## D-18 — Persist bounded decision and tool references

**Decision:** Persist context/state-transition events and catalog tool summaries with product ID references. Do not persist raw provider envelopes, credentials or catalog descriptions.

**Why:** Opt-in console logs alone cannot reconstruct a request after the process exits. Bounded records provide auditability without turning diagnostics into a sensitive transcript store.

**Limitation:** These records cover application catalog operations and state transitions, not every internal provider SDK event.

## Decisions still requiring evidence or confirmation

- Whether server-side persistence is mandatory, optional, or outside scope
- Whether the review environment supports durable SQLite storage
- Whether GPT-5.4-mini credentials/access are supplied
- The semantic representation and final ranking weights
- Whether authentication, cart, checkout, or transactional actions are required
