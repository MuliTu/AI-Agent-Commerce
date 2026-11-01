# Technical study notes

## Request path

1. `POST /api/orchestrate` accepts a stable conversation and turn ID.
2. SQLite persists the request before model or catalog work begins.
3. One configured orchestration model returns a typed semantic action plan.
4. Application code validates intent targets, displayed references, budgets, and lifecycle operations.
5. DummyJSON is the only product-fact source. Hard filters run before ranking and optional semantic evidence.
6. The terminal result, ordered product snapshots, selected references, and state projection are persisted atomically.

The model interprets language. Deterministic code owns authorization, state, catalog grounding, ordinal resolution, persistence, and validation.

## Important choices

- A compact structured state is passed between turns instead of replaying an unlimited transcript.
- Display groups preserve exact product order, source turn, intent, and lifecycle. Ordinals resolve against these groups without a new search.
- Selected products are persisted as exact catalog objects and revalidated against historical display evidence.
- Comparative “cheaper” requires a trusted product/price baseline or clarification; `cheap` may simply request price ordering.
- Off-catalog intents fail independently so valid product siblings can still complete.

Rejected alternatives: model-authored products/HTML would break grounding; a multi-agent planner/searcher/writer pipeline would add latency and handoff failure without helping this bounded catalog; browser-only memory would not survive refresh or service recreation.

## Evaluation harness

Normal Vitest and Playwright suites remain deterministic and mocked where appropriate. `npm run eval:live` is separate: it requires the configured real provider and real DummyJSON boundary, uses an isolated temporary SQLite database, captures per-turn evidence, and never silently mocks either boundary. Deterministic failures cannot be overridden by the judge. `PASS`, `FAIL`, and `INCONCLUSIVE` are distinct.

Likely review questions:

- Why not let the model call tools directly? Application-owned retrieval makes arguments, retries, grounding, and persistence inspectable.
- Why SQLite? It is adequate and reviewable for a local prototype, but not distributed durability.
- Why not solve references with another LLM call? The exact displayed order is authoritative state; a second probabilistic call would add cost and ambiguity.
- What can tests miss? Provider variance, catalog changes, infrastructure failures, disk corruption, and unlabelled semantic-quality gaps.

## Known limitations

Initial provider/catalog retries are not uniformly applied; local SQLite cannot resume interrupted computation on another host; the same configured model currently performs the independent judge execution unless a distinct approved judge configuration is provided; live samples do not establish a general quality percentage.
