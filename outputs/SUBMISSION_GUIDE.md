# Bazak submission and study guide

This is the final review guide before sending the repository. It maps the recorded employer-email requirements to the project, explains what to demonstrate, and lists claims to avoid.

## Five-minute walkthrough

1. Run `npm ci` and `npm run dev`, then open `http://localhost:3000`.
2. Ask: `Show me smartphones under $300.` Point out trusted title, price, stock, and evidence label.
3. Ask: `Show me smartphones and fragrances.` Point out the independent groups.
4. Ask: `Show me the second product from each list.` Explain that saved display order is used without a new search.
5. Start another conversation, return through the sidebar, and refresh to demonstrate persistence.
6. Ask: `Find me a flight to Rome.` Explain that off-catalog requests must not reuse stale products.

The typed product cards are the trusted answer. Do not demonstrate only the chat sentence.

## Employer requirements map

| Recorded requirement | Project evidence |
| --- | --- |
| Setup and run | `README.md` → Run locally |
| Natural-language product discovery | `src/lib/orchestration/orchestrator.ts` and the live UI |
| DummyJSON endpoints and parameters | `src/lib/catalog/client.ts`, README table, supplied OpenAPI file |
| Ambiguous and off-catalog behavior | clarification/off-catalog orchestration and tests |
| Multiple intents | structured plan, independent outcomes, grouped React UI |
| Composable product UI | `src/app/components/` |
| Refresh/new/list/resume | SQLite repository, conversation API, Playwright recovery tests |
| Persistence choice and full/corrupt/cleared storage | README Persistence, full disks, corruption, and cleared storage |
| Input → retrieval → rendering evaluation | integration tests, Playwright, separate live harness |
| What tests catch and miss | README End-to-end evaluation and Important limitations |
| At least two rejected alternatives | README Alternatives considered and rejected |
| Limitations and another week | final README sections |

The assignment allowed `gpt-5.4-mini` and `gpt-5.4-nano`; this project uses configured `gpt-5.4-mini`. The key is server-only and must not be committed or sent in logs.

## Architecture in plain language

- **Model:** understands flexible language and returns a typed plan. It is probabilistic and is not trusted with product facts.
- **Orchestrator:** validates actions, references, budgets, clarification, intent isolation, catalog work, and state transitions.
- **Catalog/domain code:** owns trusted IDs, prices, categories, stock, hard filters, exact evidence, and persistence invariants.
- **React UI:** renders typed results; it never executes model-authored HTML.
- **Evaluation harness:** drives defined conversations, captures real boundaries/state, runs objective assertions, and optionally asks a semantic judge.

The judge cannot override deterministic failures. The default judge runs separately but uses the same provider/model, so it is not provider- or model-independent.

## Why one agent and application-owned tools

One shopper-facing plan keeps a coherent conversation while representing multiple independent intents. A planner/searcher/writer agent team would add handoff state, cost, latency, and failure modes without helping this small catalog.

The model does not invoke DummyJSON directly. Application code owns permitted catalog operations, arguments, filtering, retries, IDs, and prices. This is intentionally less autonomous and more inspectable.

## State and recovery

Keep three concepts separate:

1. **Transcript:** the visible conversation.
2. **Structured conversation state:** active or paused intents, focus, pending clarification, last operation, selected product, and displayed group order.
3. **Trusted snapshots/evidence:** actual products and catalog boundaries used for the turn.

The transcript alone cannot safely resolve “the second one.” The persisted ordered display group is required. Different conversations never share this memory.

SQLite is suitable for a local reviewable prototype. It is not a distributed job system and cannot continue computation after the server process dies.

For a rollback across migration 6, follow the recorded procedure in `outputs/DECISIONS.md`: stop every writer and back up the SQLite file before changing the migration marker. Do not improvise recovery against user data.

## Local diagnostics

Use bounded structured diagnostics only for controlled development reproductions:

```bash
BAZAK_SERVER_DIAGNOSTICS=summary npm run dev
BAZAK_SERVER_DIAGNOSTICS=verbose npm run dev
```

Summary mode avoids raw shopper text. Verbose mode is development-only, is bounded and secret-redacted, but may still contain shopper wording. Never share credentials, raw `.env` content, or an unreviewed verbose log.

## Test layers

### Deterministic gates

```bash
npm run check
npm run build
npm run test:e2e
npm run test:eval-harness
```

- `check`: lint, generated Next route types, TypeScript, unit and integration tests.
- `test:e2e`: browser rendering/recovery with an intercepted orchestration API; no real OpenAI proof.
- `test:eval-harness`: evaluation mechanics without paid calls.

### Real live evaluation

```bash
BAZAK_EVAL_ARTIFACT_DIR=var/evaluations/live-ai/review npm run eval:live
```

Before running, record the exact commit, provider/model, isolated DB, scenario count, and artifact directory. Report every PASS, FAIL, INCONCLUSIVE, skip, and attempt. Never rerun until green or substitute a mock.

## Current evidence: safe wording

You can say:

- “The reviewed candidate passed 424 Vitest tests, 11 harness tests, production build, and 35 Playwright tests.”
- “The full live sample passed 27 of 30 turns.”
- “The five-scenario real-browser sample passed four and found one pending-budget failure.”
- “Later isolated executions passed the repaired budget flow, including a natural typed confirmation against the real provider and catalog.”
- “That rerun proves the successful path can work; it does not prove the stochastic divergence is fixed.”

Do not say:

- “The product is 90% reliable.”
- “All tests passed.”
- “The product is bug-free.”
- “The judge is independent.”
- “Normal Playwright uses the real model.”

## Known issues to explain honestly

1. Earlier ambiguous multi-product budget runs exposed lost target state. The current structured repair passed deterministic and targeted live checks, but the raw provider plan is still not recorded on every failure path.
2. The terminal assistant sentence can be generic while grounded product cards contain the useful answer. Two judge failures exposed this mismatch.
3. One scoped camera-phone/fragrance request failed in a service run and passed in a browser sample.
4. Initial provider/catalog retries do not use one uniform policy.
5. SQLite and process-bound work are local-prototype choices.

These are reasons for deterministic guards and better traces, not reasons to hide results.

## Likely interview questions

### Why not let the LLM call tools directly?

Application-owned catalog calls make permissions, filters, IDs, prices, retries, and evidence deterministic. The model still handles semantic interpretation.

### Why is the judge not enough?

A judge is probabilistic and may share the application model’s blind spots. Catalog/state assertions remain authoritative.

### Why category-first retrieval?

A use case such as “phone for photography” may not appear in a title. Fetching the trusted category first avoids discarding every candidate because of an overly literal search.

### How are fabricated products prevented?

Only schema-validated DummyJSON products enter product snapshots and React cards. IDs, prices, and fields are compared with actual catalog evidence.

### What happens when one intent fails?

Each intent owns a separate outcome. A successful sibling remains visible while the failed intent has its own failure or retry state.

### What would you productionize first?

Raw-plan diagnostics and deterministic plan-shape guards, followed by durable database/queue execution, uniform initial retries, labelled semantic evaluation, and a full accessibility audit.

## Final checklist

- [ ] `main` and `origin/main` point to the intended commit.
- [ ] GitHub CI is green for that exact commit.
- [ ] No secret, `.env`, DB, log, build directory, or personal report is accidentally tracked.
- [ ] `npm ci`, `npm run check`, `npm run build`, and `npm run test:e2e` work from a clean checkout.
- [ ] README setup is accurate.
- [ ] Demo data uses a separate local DB.
- [ ] Known live failures remain documented.
- [ ] Repository link is correct.
- [ ] The assignment email is not claimed as sent unless the user explicitly sends it.

## Source documents

- `README.md` — reviewer-facing setup and overview.
- `outputs/SPEC.md` — behavior and boundaries.
- `outputs/PLAN.md` — implementation history.
- `outputs/DECISIONS.md` — decisions and alternatives.
- `outputs/TEST_PLAN.md` — test strategy.
- `var/evaluations/live-ai/` — ignored local live evidence.

Specific evidence from the final review is local and ignored, so it will not exist in a clean clone:

- `var/evaluations/live-ai/full-current-2026-11-01-run-01/`
- `var/evaluations/live-ai/browser-final-2026-11-01/`
- `var/evaluations/live-ai/postmerge-browser-3ed708c-2026-11-01/`
