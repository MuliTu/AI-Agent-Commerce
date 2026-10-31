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
| D-14 | Model-assisted semantic evidence judge in shadow mode | Proposed experiment |

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

## D-14 — Experiment with a semantic evidence judge without replacing the baseline

**Context:** Conservative lexical evidence may miss valid paraphrases. The repository already supports hosted OpenAI and a local LiteLLM-compatible Qwen/Ollama route.

**Proposed decision:** On a separate local branch, evaluate a model-assisted evidence stage after deterministic hard filtering. The structured output must distinguish `supported`, `contradicted`, and `unknown`, include confidence, product ID, and exact trusted catalog evidence. Initially run it in shadow mode so baseline user-visible results do not change.

**Why:** Shadow mode provides disagreement data and latency/reliability evidence without weakening the verified product boundary before submission.

**Alternatives considered:**

1. Replace deterministic ranking and filters with a model reranker. Rejected: price, stock, category, rating, and positive-brand rules must remain deterministic.
2. Use embeddings alone. Rejected for hard proof because similarity cannot establish factual equivalence, though embeddings remain viable for soft ordering later.
3. Call a model once per product. Rejected because it multiplies latency, cost, and failure surface; a bounded batch per intent is preferable.
4. Enable the judge immediately in production results. Rejected until labelled evaluation demonstrates precision and exact-evidence validation.

**Risks and gates:** Exact evidence spans must be verified against trusted fields; confidence is not proof; provider failure falls back to the lexical baseline; unknown fails closed for hard requirements. Local LiteLLM reduces external cost but may have weaker schema reliability and hardware-dependent latency. Hosted OpenAI may be more reliable but adds network latency and usage cost.

## Decisions still requiring evidence or confirmation

- Whether server-side persistence is mandatory, optional, or outside scope
- Whether the review environment supports durable SQLite storage
- Whether GPT-5.4-mini credentials/access are supplied
- The semantic representation and final ranking weights
- Whether authentication, cart, checkout, or transactional actions are required
