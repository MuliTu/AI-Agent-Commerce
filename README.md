# Bazak AI Agent Commerce

Bazak is a small shopping assistant. You write what you want in normal language, and it shows product cards from the DummyJSON catalog.

It can handle requests such as:

- “Show me smartphones under $300.”
- “Find a laptop and a fragrance.”
- “Show me the second product from each list.”
- “Make that option cheaper.”

The language model helps understand the request. It is **not** allowed to invent products, prices, IDs, or HTML. Product facts come from DummyJSON and are checked by application code.

## Run locally: install and start

You need:

- Node.js 22.13 or newer and npm.
- Network access to `dummyjson.com` for real catalog searches.
- For real shopping conversations, the assignment OpenAI key. The UI can still start without it, but shopping requests intentionally return a configuration error.

```bash
git clone https://github.com/MuliTu/AI-Agent-Commerce.git
cd AI-Agent-Commerce
npm ci
cp .env.example .env
```

The copied file uses the safe default `LLM_PROVIDER=disabled`; shopping requests then fail honestly instead of using a fake model. For real shopping, replace that provider section in the ignored `.env` file with all four active lines below, then replace the placeholder key:

```text
LLM_PROVIDER=openai
LLM_API_KEY=your-key
LLM_MODEL=gpt-5.4-mini
LLM_BASE_URL=https://api.openai.com/v1
```

Never use a `NEXT_PUBLIC_*` name for a secret and never commit `.env`.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For a production-mode local check, run `npm run build` followed by `npm run start`.

### Environment variables

| Variable | Required? | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | Yes | `disabled`, `openai`, or the local-only `litellm` option shown in `.env.example`. |
| `LLM_API_KEY` | When a provider is enabled | Server-only provider credential. Never expose it with `NEXT_PUBLIC_*`. |
| `LLM_MODEL` | No | With OpenAI, defaults to and accepts only `gpt-5.4-mini`. |
| `LLM_BASE_URL` | No | With OpenAI, defaults to and accepts only `https://api.openai.com/v1`. |
| `BAZAK_DATABASE_PATH` | No | SQLite path; defaults to `var/data/commerce.sqlite`. |
| `BAZAK_SERVER_DIAGNOSTICS` | No | Development-only `off`, `summary`, or `verbose`; production forces diagnostics off. |
| `BAZAK_EVAL_ARTIFACT_DIR` | Only for a named live-eval output | Ignored local directory for reproducible evaluation evidence. |

The assignment allowed `gpt-5.4-mini` and `gpt-5.4-nano`; this repository deliberately validates and uses `gpt-5.4-mini`. The application does not silently switch models. The assignment key may expire after the deadline; obtain a valid replacement from the reviewer rather than committing another key.

Conversation data defaults to `var/data/commerce.sqlite`. To use a separate database:

```bash
BAZAK_DATABASE_PATH=var/data/my-test.sqlite npm run dev
```

## What you should see

1. A chat box and example shopping prompts.
2. Your message in the conversation.
3. One result group for each shopping goal.
4. Product cards with catalog title, description, price, rating, stock, image, and evidence label.
5. Saved conversations that can be opened again after refresh.
6. A focused clarification when the application cannot safely decide which product or list you mean.

The application supports English and Hebrew input. The interface follows the detected conversation direction.

## Architecture and trade-offs

Think of the system as five small jobs:

1. **The model interprets language.** It returns a schema-validated structured model plan with product goals and actions.
2. **The orchestrator checks the plan.** It resolves categories, previous results, budgets, clarifications, and selected products.
3. **The catalog client fetches trusted data.** Application code invokes DummyJSON; the model does not call the catalog directly.
4. **Deterministic code filters first.** Category, USD price, rating, stock, and other hard constraints must pass before semantic ranking.
5. **React renders typed results.** Model text cannot create product cards or executable UI.

SQLite stores conversations, messages, turns, intents, product snapshots, compact conversation state, decision events, and sanitized catalog-call evidence. This supports refresh, saved conversations, recovery, and references such as “the second one.”

## DummyJSON retrieval

The main catalog calls are:

| Purpose | Endpoint and parameters |
| --- | --- |
| Discover categories | `GET /products/categories` or `/products/category-list` |
| Read a category | `GET /products/category/{slug}?limit=100&skip=N` |
| Search an unknown term | `GET /products/search?q={query}&limit=20&skip=0` |
| Revalidate one product | `GET /products/{id}` |

Known categories use category-first retrieval. This is important because a phrase such as “phone for photography” describes a use case, not necessarily a product title. Results are deduplicated by ID, hard-filtered, and then ranked.

## Ambiguity, off-catalog requests, and failures

- A request for a phone and a fragrance becomes two independent intents in one conversation turn.
- A clear budget stays with its intended product. If the budget could apply to two products, the app asks which one.
- A reference such as “the second one” uses the saved displayed order; it is not resolved by searching again.
- A request for the second item from each displayed list returns one saved product per list when the reference is unambiguous.
- Comparative “cheaper” needs a real reference price or a clarification. It is not treated as “sort by price.” The adjective “cheap” may request price-ascending order.
- Flights, weather, checkout, and other off-catalog requests receive a bounded limitation message and must not reuse stale products.
- Unsupported constraints fail honestly instead of being silently inverted or discarded.

## Evidence and ranking

After hard filtering, a bounded model-assisted stage can label catalog-backed candidates as `supported`, `partial`, `unknown`, or internally `contradicted`. Exact evidence quotes are verified against trusted title, description, or tags. Semantic confidence is useful for order, but it is never proof by itself.

“Only verified” requests fail closed. If evidence evaluation fails, the application uses the disclosed deterministic fallback; it does not invent evidence.

## Persistence, full disks, corruption, and cleared storage

SQLite is a practical local choice, not a distributed production database.

- **Disk full, read-only, or locked:** the request fails; the UI must not claim it was saved.
- **Corrupt database or schema:** the application fails closed. Restore a known-good database or intentionally start a new one.
- **Database cleared:** the conversation is not reconstructed from model text. The client offers a new conversation.
- **Server stops during work:** startup recovery marks stale work honestly. SQLite cannot continue the interrupted computation by itself.
- **Browser disconnects:** accepted work may continue in the current server process, and the client polls the persisted result without resubmitting it.

## End-to-end evaluation

Run the normal deterministic checks:

```bash
npm run check
npm run build
npm run test:e2e
npm run test:eval-harness
```

- `check` runs ESLint, generated Next.js route types, TypeScript, and Vitest unit/integration tests.
- Playwright tests browser behavior with an intercepted orchestration boundary. They do **not** prove that OpenAI or live DummyJSON works.
- `test:eval-harness` tests the evaluation machinery without paid calls.

The real-provider evaluation is separate and opt-in:

```bash
# Uses the configured real provider and live DummyJSON. No silent mocks.
BAZAK_EVAL_ARTIFACT_DIR=var/evaluations/live-ai/my-run npm run eval:live
```

The live harness uses a unique temporary SQLite database and records each turn, available state transitions, catalog arguments/results, product IDs/prices, deterministic assertion reasons, persistence evidence, judge verdict, timing, and available usage. Results are `PASS`, `FAIL`, or `INCONCLUSIVE`. A judge cannot override a deterministic failure. The default judge is independently executed but uses the same configured provider/model, so it is not provider- or model-independent.

Completed catalog boundaries are persisted as sanitized `tool_runs`. Uniform retry for initial calls remains deferred; the implemented explicit failed-intent retry is a separate bounded path.

Latest verified deterministic gate on the current candidate:

- 424/424 Vitest tests passed.
- 11/11 harness-mechanics tests passed.
- Production build passed.
- 35/35 Playwright tests passed.
- The exact uncommitted repair candidate was also checked by independent QA and architecture review before commit.

Latest live evidence must be read as samples, not a reliability percentage:

- The full service-level sample passed 27/30 turns. Two failures were judge-only response-copy failures; one was an execution failure.
- A five-scenario real-browser sample passed 4/5 and exposed a lost multi-intent budget state.
- A later targeted browser run of that budget flow passed once with a verified isolated database.
- A final targeted real-browser run verified natural confirmation (`Yes, use $500`) against OpenAI `gpt-5.4-mini` and live DummyJSON. It retained the saved laptop target and preserved the fragrance result. These successful samples do not erase earlier failures or prove a reliability percentage.

Ignored local evidence is under `var/evaluations/live-ai/`. It is intentionally not committed because it may contain full prompts and catalog data.

## Important limitations

- Model behavior is probabilistic; one successful live run is not a quality guarantee.
- The raw structured provider plan is not yet recorded in every failure path, so some stochastic divergences are difficult to explain completely.
- Initial provider and catalog operations do not share one uniform five-attempt retry policy. Explicit retry of a retryable failed intent is bounded separately.
- The semantic evaluator and default judge add latency and provider cost.
- SQLite does not provide multi-host durability or queued background execution.
- There is no cart, checkout, authentication, deployment, or production job system.
- Tests do not simulate every corrupt-database, disk-full, screen-reader, distributed-concurrency, or provider-variance case.

## Alternatives considered and rejected

1. **A planner agent, search agent, and writer agent.** This adds handoffs, cost, latency, and inconsistent context for a small catalog. One structured model plan plus deterministic application work is easier to inspect.
2. **Let the model write products or HTML.** This looks flexible but permits invented facts and breaks the composable React requirement. Only validated catalog objects reach product components.
3. **Store everything only in the browser.** Refresh and recovery become unreliable. Server-owned SQLite state was chosen for the local assignment.

## What I would change with another week

I would first add raw-plan diagnostics around every validation path and expand the structured clarification contracts to more natural answer phrasings and currencies. Then I would replace process-bound SQLite execution with a durable database and queue/worker lease, add fault-injection for initial retries, calibrate semantic evaluation on a labelled dataset, and complete a keyboard and screen-reader audit.

## Assignment map and study guide

The supplied employer requirements are mapped to the implementation in [outputs/SUBMISSION_GUIDE.md](outputs/SUBMISSION_GUIDE.md). That guide also explains what to demonstrate, what to study, likely interview questions, and which limitations to say out loud.

Detailed design history is preserved in `outputs/SPEC.md`, `outputs/PLAN.md`, `outputs/DECISIONS.md`, and `outputs/TEST_PLAN.md`. The supplied DummyJSON OpenAPI reference remains unchanged at `docs/dummyjson_products_openapi.yaml`.
