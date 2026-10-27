# Bazak AI Agent Commerce — Product and Technical Specification

## 1. Purpose

Build a conversational commerce experience in which a shopper can express one or more shopping goals in natural language, refine them through conversation, inspect product recommendations in structured React UI, and preserve the conversation and agent state on the server.

This document defines the intended solution. It does **not** claim that the application has already been implemented.

## 2. Delivery boundary

- Final submission deadline: **November 1, 2026 at 23:59 (Asia/Jerusalem)**.
- Delivery should be staged: establish the reliable core first, then add ranking and UI quality, then resilience and evaluation, and finally documentation and polish.
- The prompt's “what would you change with another week?” question is a **README reflection**, not a requirement to implement another week of features.
- Backend persistence is treated as a deliberate design choice unless the employer confirms that it is mandatory.

## 3. Proposed stack

- **Application:** Next.js with TypeScript
- **Agent integration:** Vercel AI SDK
- **Primary hosted model:** GPT-5.4-mini
- **Persistence:** server-side SQLite
- **Unit and integration tests:** Vitest and MSW
- **Browser tests:** Playwright
- **Model evaluation:** Ollama first for repeatable/local runs, then OpenAI for provider-realistic verification
- **Product source:** the supplied DummyJSON Products OpenAPI contract

## 4. User experience

### 4.1 Core journey

1. The shopper submits a natural-language request.
2. The agent identifies every shopping intent in the request.
3. It determines which constraints are explicit, which can be inferred safely, and which materially affect the result.
4. It searches a locally normalized catalog and ranks candidates semantically.
5. It either:
   - returns useful product recommendations immediately; or
   - asks one concise, high-information clarification question.
6. Product results are rendered as composable React product UI rather than as model-authored HTML.
7. The shopper can refine, compare, or introduce another intent without losing earlier context.

### 4.2 Multi-intent example

“I need a phone for photography and a fragrance gift under $80” is one conversation turn containing two intents. A **Single Agent** owns the turn, decomposes it into separate intent records, invokes the appropriate catalog tools, and synthesizes one coherent response. This avoids the operational complexity and inconsistent context of a multi-agent system while still allowing parallelizable tool work internally.

### 4.3 Adaptive clarification

The agent should not ask for every missing preference. It asks only when the missing information is likely to change the recommendation set materially.

Guidelines:

- Proceed with stated constraints when there are sufficiently good candidates.
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

The model is responsible for intent extraction, tool selection, clarification, and synthesis. Deterministic application code is responsible for validation, fetching, filtering, scoring, persistence, retry policy, and rendering.

### 5.2 Tool boundary

Recommended typed tools:

- `searchCatalog`: retrieve and rank catalog candidates.
- `getProduct`: load full details for a selected product.
- `listCategories`: help resolve category ambiguity.
- `saveConversationState`: persist validated server-side state.

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

The catalog is the source of truth. The model must not invent products. Ranking happens after retrieval:

1. Normalize searchable text from title, description, category, tags, and brand.
2. Apply hard filters first: price ceiling, category, stock/availability, and other explicit constraints.
3. Calculate semantic relevance between the shopper's goal and each remaining product.
4. Blend semantic relevance with bounded business-neutral signals such as rating and constraint coverage.
5. Return ranked products with a short, evidence-grounded rationale.

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

## 8. Persistence and execution semantics

SQLite stores conversation records, messages, structured intents, tool executions, and result references on the server. This makes state independent of a particular browser instance and allows a reconnecting client to recover persisted state.

Client-independent execution means a request, once accepted by the server, is not owned by the browser connection. The server records job/turn status and completes work through a server-side execution path. Reconnecting clients read status from SQLite rather than relying on an open streaming connection.

Important boundary: SQLite does **not** make an in-flight process survive server shutdown. Without a durable external worker/queue and durable deployment storage, a server stop can interrupt execution. On restart, the application may detect stale `running` records and mark or safely retry them, but the basic design must not claim uninterrupted execution across shutdown. Likewise, local SQLite is not reliably durable on ephemeral/serverless filesystems without an appropriate persistent volume or managed SQLite-compatible service.

## 9. Reliability

### 9.1 Retry policy

Transient network/provider failures receive **5 total attempts**: the initial request plus up to four retries. Use capped exponential backoff with jitter. Retry only errors classified as transient, such as timeouts, rate limits, and eligible 5xx responses.

Do not retry validation failures, authentication/authorization failures, unsupported requests, or deterministic 4xx responses. Record each attempt. Tool actions must be idempotent or protected by an idempotency key.

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
- Transient failures stop after five total attempts.
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

1. Is backend persistence explicitly expected, or is it an optional architecture choice to demonstrate production thinking?
2. Will evaluation run on a serverless environment where local SQLite is ephemeral?
3. Is GPT-5.4-mini access guaranteed for reviewers, and what fallback is acceptable?
4. Must semantic ranking use embeddings, or is a lexical/local semantic baseline acceptable?
5. Is authentication or multi-user separation required?
6. Should conversations resume across devices, or is recovery by conversation URL/ID sufficient?
7. Are purchases/cart actions in scope, or is this recommendation and discovery only?
8. May the application cache/snapshot the DummyJSON catalog, and how fresh must it be?
9. Are external evaluation calls allowed during automated review?

## 14. Explicit limitations

- DummyJSON is a demonstration catalog, not a transactional commerce backend.
- Recommendations are limited by the supplied fields and catalog quality.
- Semantic relevance is probabilistic and requires evaluation and tuning.
- Local Ollama results do not guarantee identical OpenAI behavior.
- SQLite on one process does not provide distributed coordination or automatic high availability.
- In-flight work does not continue while the server process is shut down.
- This specification describes intended behavior; implementation and verification remain to be completed.
