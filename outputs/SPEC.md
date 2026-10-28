# Bazak AI Agent Commerce — Product and Technical Specification

## 1. Purpose

Build a conversational commerce experience in which a shopper can express one or more shopping goals in natural language, refine them through conversation, inspect product recommendations in structured React UI, and preserve the conversation and agent state on the server.

This document separates the employer assignment from project-authored design targets. The current implementation status and deferred targets are stated explicitly.

## 2. Delivery boundary

- Original submission deadline: **November 1 at 23:59**. The source email did not specify a timezone; any timezone used in planning is an internal assumption.
- Delivery should be staged: establish the reliable core first, then add ranking and UI quality, then resilience and evaluation, and finally documentation and polish.
- The prompt's “what would you change with another week?” question is a **README reflection**, not a requirement to implement another week of features.
- The employer requires refresh/new-conversation/list/resume behavior. Server-side SQLite is this project's implementation choice for that observable persistence requirement, not a mandated technology.

## 3. Project-selected stack

- **Application:** Next.js with TypeScript
- **Agent integration:** Vercel AI SDK
- **Primary hosted model:** GPT-5.4-mini (project choice; the assignment permits OpenAI mini/nano models but does not mandate this model)
- **Persistence:** server-side SQLite
- **Unit and integration tests:** Vitest and MSW
- **Browser tests:** Playwright
- **Model evaluation:** deterministic fixtures plus a separately budgeted configured-provider check; local LiteLLM is an optional development path, not an employer requirement
- **Product source:** the supplied DummyJSON Products OpenAPI contract

## 4. User experience

### 4.1 Core journey

1. The shopper submits a natural-language request.
2. The agent identifies every shopping intent in the request.
3. It determines which constraints are explicit, which can be inferred safely, and which materially affect the result.
4. It resolves the most specific trusted catalog category that matches the shopper's product type.
5. It retrieves candidates from that category, applies explicit constraints, and then ranks the remaining candidates against the shopper's contextual wording.
6. It either:
   - returns useful product recommendations immediately; or
   - asks one concise, high-information clarification question.
7. Product results are rendered as composable React product UI rather than as model-authored HTML.
8. The shopper can refine, compare, or introduce another intent without losing earlier context.

### 4.2 Multi-intent example

“I need a phone for photography and a fragrance gift under $80” is one conversation turn containing two intents. A **Single Agent** owns the turn, decomposes it into separate intent records, invokes the appropriate catalog tools, and synthesizes one coherent response. This avoids the operational complexity and inconsistent context of a multi-agent system while still allowing parallelizable tool work internally.

### 4.3 Adaptive clarification

The agent should not ask for every missing preference. It asks only when the missing information is likely to change the recommendation set materially.

Guidelines:

- Proceed with stated constraints when there are sufficiently good candidates.
- When the product category is known, return useful category matches immediately. Missing optional preferences such as budget, minimum rating, brand, or tags must not trigger clarification before the first result set.
- Make a transparent, reversible assumption for low-risk ambiguity.
- Ask one focused question when results are too broad, empty, or meaningfully split.
- Preserve already supplied constraints; do not ask the shopper to repeat them.
- If several intents need clarification, prefer the question with the greatest expected reduction in uncertainty, while allowing unaffected intents to progress.

## 5. Agent architecture

### 5.1 Single Agent, multi-intent orchestration

The application has one shopper-facing agent. It maintains a structured turn plan:

```ts
type ShoppingIntent = {
  id: string;
  goal: string;
  query: string;
  category?: string;
  constraints: {
    maxPrice?: number;
    minRating?: number;
    brands?: string[];
    requiredTags?: string[];
  };
  status: "ready" | "needs_clarification" | "completed" | "failed";
};
```

In the implemented live route, the model is responsible for structured intent extraction and draft shopper prose. Deterministic application code resolves categories, selects and invokes catalog operations, validates explicit constraints, clarifies, filters, scores, persists, and renders. The application replaces unusable provider prose with bounded shopper-safe copy. A separate experimental tool-loop runtime exists under `src/lib/agent/`, but it is not the live orchestration path.

### 5.2 Tool boundary

Implemented deterministic catalog boundaries:

- `searchCatalog`: retrieve fallback candidates when no category resolves.
- `getProduct`: revalidate persisted products when preserving prior results.
- `listCategories` and category-product retrieval: resolve ambiguity and load the complete bounded category candidate set.
- `CommerceRepository`: persist validated conversation and execution state transactionally.

Tool inputs and outputs must be schema-validated. Product IDs and fields returned to the UI must originate from trusted catalog data, not free-form model output.

## 6. Catalog-first semantic ranking

### 6.1 Catalog ingestion

Use the supplied OpenAPI contract to load and normalize product data from:

- `GET /products`
- `GET /products/{id}`
- `GET /products/search?q=...`
- `GET /products/categories`
- `GET /products/category-list`
- `GET /products/category/{slug}`

Relevant product fields include title, description, category, price, discount percentage, rating, stock, tags, brand, availability, images, thumbnail, warranty, and shipping information.

### 6.2 Ranking strategy

The catalog is the source of truth. The model must not invent products. Candidate generation and ranking use a category-first pipeline:

1. Infer the shopper's product category from natural-language intent and resolve it to a trusted catalog category slug. For example, “phone,” “mobile,” and “smartphone” resolve to `smartphones` when that category exists.
2. Retrieve the candidate pool from the resolved category endpoint. Do not use the shopper's raw wording as a product-name or free-text pre-filter when a category is known.
3. Apply hard filters to the category candidates: price ceiling, stock/availability, brand, rating, tags, and other explicit constraints.
4. Normalize searchable context from title, description, category, tags, and brand.
5. Calculate contextual or semantic relevance between the shopper's goal/query and every remaining candidate. The query is a ranking signal, not an exact-name requirement.
6. Blend semantic relevance with bounded business-neutral signals such as rating and constraint coverage.
7. Return ranked products with a short, evidence-grounded rationale.

When no category can be resolved confidently, the system may use catalog free-text search as a fallback or ask one focused category clarification question. It must not silently treat an unresolved category as proof that no products exist. An empty free-text result is not a valid reason to discard products from a known category.

Category aliases are resolved deterministically and validated against the current DummyJSON category list. Product terms such as “iPhone” resolve to `smartphones` and “perfume” resolves to `fragrances`; unknown or stale category names are never sent to the category endpoint as if they were trusted.

The category client follows bounded upstream pagination until the complete matching candidate set is loaded (subject to a documented safety cap), deduplicates by stable catalog product ID, applies explicit filters, and ranks or sorts the remaining candidates. The UI initially displays five products per intent and exposes “Show more” in stable five-item batches without reordering, changing filters, or duplicating products. Persisted/recovered results retain the same ordered candidate set.

“Cheap,” “cheapest,” and equivalent wording means ascending catalog price. It does not imply a maximum budget. Sorting, category, budget, rating, brand, and tag constraints remain scoped to the intent that stated them.

Catalog prices are USD. No foreign-exchange conversion is performed or implied. A budget explicitly denominated in ILS/NIS/₪ must not be applied as a USD value; the affected intent explains the limitation and asks for a USD budget while independent intents may still complete.

An initial score can be documented and tuned, for example:

`score = 0.70 × semantic relevance + 0.20 × constraint coverage + 0.10 × normalized rating`

The weights are a testable starting hypothesis, not a universal truth. Price and availability remain hard filters when the shopper states them as requirements.

“Catalog-first” means the system obtains and validates candidates before the model explains them. It does not use the model's general knowledge as a substitute for catalog evidence.

## 7. Composable React product UI

The response UI should be assembled from application-owned components, for example:

- `ConversationMessage`
- `IntentSection`
- `ClarificationPrompt`
- `ProductGrid`
- `ProductCard`
- `ProductComparison`
- `ToolStatus`
- `EmptyState`
- `ErrorState`

Product cards should show only supported catalog facts, including image, title, brand/category, price, rating, availability, and a grounded “why it matches” explanation. The UI must support loading, partial success, empty results, and individual intent failure without collapsing the entire turn.

The conversation shell uses three bounded regions: a saved-conversation list with its own vertical scroll, a transcript with its own vertical scroll, and a sticky bottom composer that remains available while either list grows. Shopper messages align right; assistant messages align left. Results, clarifications, failures, and recovery actions render inside the assistant turn that produced them. Multiple intents receive clearly separated groups; a single intent avoids redundant outer framing.

Internal diagnostics and demo affordances are not part of the shopper UI. The visible experience omits request/model panels, prompt-starter collections, example-prompt chips, and architecture/recovery explainers. Operational failures remain actionable, but use shopper-facing language rather than provider terminology.

An unrelated new topic starts a new result scope instead of carrying forward prior products or filters. A genuine refinement may reference and update an existing intent. Requests outside the product catalog, including flight search or booking, receive an honest bounded response and never reuse old product results.

Actual LLM system prompts live centrally in `src/lib/ai/prompts`, one prompt per file. The structured intent extractor receives the shopper text and previous intent state as a separate typed dynamic payload. Deterministic UI copy is not treated as a system prompt.

## 8. Persistence and execution semantics

SQLite stores conversation records, messages, structured intents, tool executions, and result references on the server. This makes state independent of a particular browser instance and allows a reconnecting client to recover persisted state.

Client-independent execution means a request, once accepted by the server, is not owned by the browser connection. The server records job/turn status and completes work through a server-side execution path. Reconnecting clients read status from SQLite rather than relying on an open streaming connection.

Important boundary: SQLite does **not** make an in-flight process survive server shutdown. Without a durable external worker/queue and durable deployment storage, a server stop can interrupt execution. On restart, the application may detect stale `running` records and mark or safely retry them, but the basic design must not claim uninterrupted execution across shutdown. Likewise, local SQLite is not reliably durable on ephemeral/serverless filesystems without an appropriate persistent volume or managed SQLite-compatible service.

## 9. Reliability

### 9.1 Retry policy

**Project-authored target, not an original employer requirement:** transient network/provider failures receive **5 total attempts**: the initial request plus up to four retries. Use capped exponential backoff with jitter. Retry only errors classified as transient, such as timeouts, rate limits, and eligible 5xx responses.

Do not retry validation failures, authentication/authorization failures, unsupported requests, or deterministic 4xx responses. Record each attempt. Tool actions must be idempotent or protected by an idempotency key.

Current status: the shared retry primitive and explicit failed-intent retry path exist, but initial provider/catalog operations are not yet uniformly wrapped and completed turns currently persist no `tool_runs`. Five-attempt initial execution and persisted attempt observability are deferred rather than claimed as complete.

### 9.2 Partial failure

For multiple intents, successful intent results should remain visible even if another intent fails. The failed intent receives a scoped error and a retry option.

## 10. Data model outline

- `conversations`: identity and timestamps
- `messages`: role, content, status, and conversation relationship
- `turns`: lifecycle (`queued`, `running`, `completed`, `partial`, `failed`)
- `intents`: structured goal, constraints, and lifecycle per turn
- `tool_runs`: tool name, validated input/output reference, attempt number, timestamps, and error classification
- `product_snapshots` or result payload references: enough trusted data to reproduce what the user saw

Persist only what is necessary. Secrets, raw provider credentials, and unnecessary sensitive prompt content must not be logged.

## 11. Functional acceptance criteria

- A shopper can submit a single-intent or multi-intent request.
- The Single Agent produces separate structured intents and returns one coherent response.
- Explicit constraints are enforced deterministically.
- Recommendations are drawn only from the catalog and ranked for semantic relevance.
- The agent asks a focused clarification only when it is materially useful.
- Product results render through typed React components.
- Refreshing or reconnecting from another client can recover server-persisted conversation state.
- The project-authored reliability target is five total transient attempts; the current live initial-execution gap is documented and remains deferred.
- One intent can fail without discarding successful sibling intents.
- The UI describes interrupted/stale work honestly; it does not claim survival across server shutdown.

## 12. Non-functional requirements

- Type-safe boundaries for model and tool data
- Accessible keyboard navigation and meaningful status announcements
- Responsive product layout
- No model-authored executable UI or untrusted HTML
- Observable request, intent, and retry lifecycle without logging secrets
- Deterministic tests for orchestration and ranking where possible
- Clear fallback behavior when either the catalog or model provider is unavailable

## 13. Open questions

1. Will evaluation run on a serverless environment where local SQLite is ephemeral?
2. Which permitted mini/nano model will reviewers configure, and what unavailable-provider behavior should they expect?
3. Must semantic ranking use embeddings, or is a lexical/local semantic baseline acceptable?
4. Is authentication or multi-user separation required?
5. Is recovery by conversation URL/ID sufficient for cross-device resume, or is user-account discovery expected?
6. Are purchases/cart actions in scope, or is this recommendation and discovery only?
7. May the application cache/snapshot the DummyJSON catalog, and how fresh must it be?
8. Are external evaluation calls allowed during automated review?

## 14. Explicit limitations

- DummyJSON is a demonstration catalog, not a transactional commerce backend.
- Recommendations are limited by the supplied fields and catalog quality.
- Semantic relevance is probabilistic and requires evaluation and tuning.
- Local LiteLLM or deterministic fixture results do not guarantee identical hosted-provider behavior.
- SQLite on one process does not provide distributed coordination or automatic high availability.
- In-flight work does not continue while the server process is shut down.
- Initial-call five-attempt retry and persisted tool-attempt observability are authored targets that are not yet complete.

## 15. Multilingual conversation and empty-state refinement

- Bazak responds in the shopper's language for Hebrew and English turns while trusted catalog product fields remain in their source language and render LTR inside RTL conversation chrome.
- Every new turn starts a new intent scope unless it explicitly carries a validated clarification or retry identity from the previous result. Unknown categories fail honestly instead of falling back to an unrelated catalog category.
- Unsupported services such as flights render as concise conversational prose; supported sibling product intents remain independently actionable.
- A genuinely empty conversation presents one centered Bazak welcome, genuine catalog categories/examples, and the primary composer. The welcome disappears after the first accepted send. Restored conversations skip it and use the normal sticky-bottom composer.
- Product grids use the same responsive column policy and card anatomy for every category. Cards stretch without fixed clipping heights, preserve a stable media frame, and keep match reasoning at the bottom of the content column.
- The application does not expose a local-workspace profile block. Motion is subtle, composite-only, and reduced under `prefers-reduced-motion`.
