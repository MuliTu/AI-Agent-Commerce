# Open-Vocabulary Evidence Live Retest — 2026-10-31

## Verdict

**PASS — the open-vocabulary evidence gate is verified on the current live OpenAI build.**

The previously failing satellite-calling requests now fail closed with no generic products in 6/6 live attempts. Three additional unseen features (`quantum-resistant encryption`, `foldable display`, and `solar charging`) also returned honest empty results in 6/6. Positive controls proved the gate is not merely emptying every explicit-proof request: `fresh and clean scent` returned only CK One, `mango` returned only Dolce Shine, and all returned camera products contained camera/photography/selfie evidence in trusted catalog text.

No regression was found in ordinary browsing, multi-intent scoping, eSIM/NFC/evening evidence, brand exclusions, Hebrew exclusive follow-up, aggregate budgets, or final structured-output handling.

No product code, configuration, credentials, security settings, or existing user data were changed.

## Candidate and isolation

- Repository: `/Users/mulituriel/Documents/Projects/AI-Agent-Commerce`
- Candidate HEAD: `81899cc310777659c562d2f18425c82490c95522`
- Candidate state: developer-supplied dirty working tree; all pre-existing work preserved.
- Handoff: `outputs/QA_OPEN_VOCAB_EVIDENCE_FIX_HANDOFF_2026-10-31.md`
- Fresh production server: `127.0.0.1:3343`
- Isolated database: `/tmp/bazak-open-vocab.jGRtp7/commerce.sqlite`
- Isolated conversation IDs: `open-vocab-*`
- Provider: configured live OpenAI provider, authorized by the user.
- Security testing: out of scope.

## Scoring

- Quality: 0 complete failure, 1 poor/major defect, 2 weak/substantial fixes needed, 3 acceptable but flawed, 4 good/minor improvement, 5 excellent.
- Creativity: 0 ordinary, 5 exceptionally unusual or inventive.

## Execution summary

| Check | Result | Evidence |
|---|---:|---|
| Production build | PASS | `npm run build`, exit 0 |
| Unit/integration | PASS | 27 files, 311 tests, exit 0 |
| Browser E2E | PASS | 34/34 Playwright tests, exit 0 |
| Live OpenAI POSTs | 42/42 HTTP 200 structured application results | No harness exception or timeout |
| Final schema failures | 0/42 | No `invalid_tool_output` |
| Observed latency | 80–4,358 ms | End-to-end per POST |
| Tokens/cost | Not observable | The application exposes no usage/cost fields; no estimate is invented |
| Internal model attempt count | Not observable | Logs expose sanitized final plan summaries, not regeneration count |

The Playwright suite uses its configured deterministic provider. It verifies UI mechanics but is not counted as live-provider semantic evidence.

## Before/after: arbitrary unknown feature evidence

### Satellite calling — `state`

- Exact input, repeated three times: `Find a smartphone with satellite calling. If the catalog does not state satellite calling support, return no products.`
- Expected (specified): since no trusted DummyJSON phone title/description/tag states satellite calling, return no products and explain the evidence limitation.
- Before: 2/2 returned 16 generic smartphones and ordinary success copy. Quality 0/5.
- Actual now: 3/3 returned a smartphone intent with zero products and exact response `The catalog does not state the requested feature, so I won’t present generic products as verified matches.`
- Evidence IDs: `open-vocab-sat_state-1..3`; 2,336–3,357 ms.
- Classification: **fixed**.
- Creativity: 3/5. Quality: **5/5**.

### Satellite calling — `mention`

- Exact input, repeated three times: `Find a smartphone with satellite calling. If the catalog does not mention satellite calling, return no products.`
- Expected: same evidence-safe empty result.
- Before: 2/2 returned the same 16 generic phones. Quality 0/5.
- Actual now: 3/3 zero products with the same honest evidence response.
- Evidence IDs: `open-vocab-sat_mention-1..3`; 1,966–2,022 ms.
- Classification: **fixed**.
- Creativity: 3/5. Quality: **5/5**.

## New unseen-feature negative controls

| ID | Exact input | Expected | Actual | Attempts | Creativity | Quality |
|---|---|---|---|---:|---:|---:|
| QUANTUM | `Find a phone with quantum-resistant encryption, but only if the catalog description lists quantum-resistant encryption.` | No generic phone without exact trusted evidence | Zero products, honest evidence copy | 2/2 | 5 | 5 |
| FOLDABLE | `Find a smartphone with a foldable display only if the product details mention foldable display.` | Same | Zero products, honest evidence copy | 2/2 | 4 | 5 |
| SOLAR | `Find a phone with solar charging only if the product text says solar charging.` | Same | Zero products, honest evidence copy | 2/2 | 5 | 5 |

These six results show the fix is not limited to the satellite phrase or a hard-coded satellite synonym.

## Positive trusted-text controls

### Camera/photography curated evidence

- Exact input, repeated twice: `Find a smartphone whose catalog description mentions camera capabilities.`
- Expected: every returned card must have camera/photography/selfie evidence in title, description, or tags.
- Actual: 2/2 returned the same ten evidence-backed phones. Examples:
  - Galaxy S8: description says `advanced camera capabilities`.
  - Vivo X21 and Realme X: descriptions say `camera capabilities`.
  - Oppo F19 Pro Plus: `camera capabilities` and `photography features`.
  - Realme XT: `camera technology`, `camera sensors`, `photos and videos`.
  - Vivo V9: `selfies` and `dual-camera setup`.
  - Remaining iPhone 13 Pro, Vivo S1, Galaxy S7, and Galaxy S10 descriptions each explicitly mention camera/camera system.
- No evidence-free smartphone card survived.
- Creativity: 1/5. Quality: **5/5**.

### Open-vocabulary positive: fresh and clean scent

- Exact input, repeated twice: `Find a fragrance, but only if the catalog description mentions fresh and clean scent.`
- Expected: only cards whose trusted text contains that phrase.
- Actual: 2/2 returned exactly one product: Calvin Klein CK One $49.99. Its trusted description says `known for its fresh and clean scent.`
- Classification: **pass; exact lexical evidence confirmed**.
- Creativity: 3/5. Quality: **5/5**.

### Open-vocabulary positive: mango

- Exact input, repeated twice: `Find a fragrance only if the catalog description mentions mango.`
- Expected: only descriptions containing mango.
- Actual: 2/2 returned exactly Dolce Shine Eau de $69.99. Its trusted description says `featuring notes of mango, jasmine, and blonde woods.`
- Classification: **pass; exact lexical evidence confirmed**.
- Creativity: 3/5. Quality: **5/5**.

These positive controls demonstrate that empty unknown-feature results are caused by missing catalog evidence rather than blanket rejection of proof-language requests.

## Curated-feature controls

| ID | Exact input | Expected from trusted catalog | Actual | Attempts | Creativity | Quality |
|---|---|---|---|---:|---:|---:|
| EVENING | `Find an evening fragrance under $80, but only if the catalog text states evening or night use.` | No under-$80 fragrance has evening/night evidence | Zero products with honest evidence response | 2/2 | 2 | 5 |
| ESIM | `Find a smartphone with eSIM support. If the catalog does not mention eSIM, return no products.` | No eSIM evidence | Zero products; no false brand exclusion | 2/2 | 2 | 5 |
| NFC | `Find a smartphone with NFC support. If the catalog does not mention NFC, return no products.` | No NFC evidence | Zero products; no false brand exclusion | 2/2 | 2 | 5 |

## Ordinary browsing must remain non-mandatory

### Generic smartphones

- Exact input, repeated twice: `Show me smartphones.`
- Expected (specified): ordinary category browsing; must not be failed by the evidence gate.
- Actual: 2/2 ordinary completed smartphone searches with the catalog list and neutral response `I searched the catalog for your shopping request.`
- Creativity: 0/5. Quality: **5/5**.

### Long-lasting battery for travel

- Exact input, repeated twice: `Find a phone with a long-lasting battery for travel.`
- Expected (specified limitation): because the shopper did not explicitly demand catalog proof, treat this as browsing/ranking context rather than a literal evidence gate.
- Actual: 2/2 completed ordinary smartphone searches. The response did not claim that battery life was verified; it only said the catalog was searched.
- Classification: **pass under specified semantics**. The returned cards should not be interpreted as proven long-lasting-battery matches; this is an acknowledged ranking-context behavior.
- Creativity: 2/5. Quality: **4/5**, because the neutral response is safe but does not explicitly remind the user that battery longevity is unverified.

## Multi-intent scoping

### Unknown proof requirement plus ordinary fragrance

- Exact input, repeated three times: `Find a phone with satellite calling and a fragrance. If the catalog does not mention satellite calling, return no phone products.`
- Expected: satellite evidence applies only to phone; phone outcome empty, fragrance outcome remains ordinary and populated.
- Actual: 3/3 produced two outcomes:
  - Smartphone: zero products.
  - Fragrance: CK One, Chanel Coco Noir, Dolce Shine, Dior J'adore, and Gucci Bloom.
- No satellite requirement leaked into fragrance.
- Overall response mentions missing evidence because one sibling is empty, while the populated fragrance outcome remains present.
- Creativity: 4/5. Quality: **5/5**.

### Positive phone evidence plus budgeted ordinary fragrance

- Exact input: `Find a phone whose catalog description mentions camera capabilities and an ordinary fragrance under $80.`
- Expected: evidence-filter only phone; fragrance receives only `maxPrice=80`.
- Actual: phone outcome contained the ten camera-evidence cards; fragrance outcome contained CK One $49.99, Dolce Shine $69.99, and Gucci Bloom $79.99. No camera requirement leaked into fragrance.
- Creativity: 3/5. Quality: **5/5**.

## Previous regression controls

| Scenario | Exact input/sequence | Expected | Actual | Attempts | Creativity | Quality |
|---|---|---|---|---:|---:|---:|
| True exclusion | `Show smartphones under $500, but not Samsung.` | Safe exclusion limitation | Zero products; Samsung named in copy | 1 | 1 | 5 |
| True exclusion | `Find a phone under $600, anything but Apple.` | Same | Zero products; Apple named | 1 | 2 | 5 |
| True exclusion | `Show me smartphones except Google.` | Same | Zero products; Google named | 1 | 2 | 5 |
| Hebrew exclusive follow-up | `מצא לי טלפון ובושם.` → `רק הבושם עד 70 דולר.` | New result contains only fragrance ≤$70 | 2/2 sequences returned one fragrance outcome, CK One and Dolce Shine only | 2 sequences | 2 | 5 |
| Aggregate budget | `Find a phone and a fragrance together for no more than $500 total.` | Aggregate-only limitation | Correct explanation, zero products | 1 | 3 | 5 |
| Structured-output stress | `Find two separate things: an in-stock phone under $400, and an in-stock evening fragrance under $80.` | No final schema failure; correct hard filters/evidence | 2/2 valid results; phones ≤$400/in stock, fragrance empty | 2 | 2 | 5 |

## Pass/fail accounting

- 42/42 live application requests produced valid structured results.
- 12/12 unseen-feature negative attempts were evidence-safe: satellite 6, quantum 2, foldable 2, solar 2.
- 6/6 open-vocabulary positive attempts returned only products with exact trusted text evidence.
- 6/6 curated eSIM/NFC/evening attempts were evidence-safe.
- 4/4 ordinary browsing attempts remained usable.
- 4/4 multi-intent attempts scoped evidence to the correct outcome.
- 10/10 previous-regression requests passed, counting four POSTs in the two Hebrew sequences.
- Confirmed bugs: **0**.
- Harness errors: **0**.
- N/A/unrun: no cost/token assertion because telemetry is absent; semantic synonym entailment beyond curated features is intentionally unsupported.

## VerificationReport

```yaml
ticket_id: open-vocabulary-evidence-fix
candidate_revision: 81899cc310777659c562d2f18425c82490c95522-plus-dirty-working-tree
criteria:
  - id: unseen_explicit_evidence_fails_closed
    status: pass
    evidence: 12/12 satellite/quantum/foldable/solar live requests returned no generic products
  - id: positive_trusted_text_survives
    status: pass
    evidence: camera 2/2, fresh-and-clean 2/2, mango 2/2; every card verified against title/description/tags
  - id: ordinary_queries_not_overblocked
    status: pass
    evidence: generic smartphones 2/2 and battery/travel 2/2 completed normally
  - id: multi_intent_scoping
    status: pass
    evidence: unknown phone proof plus fragrance 3/3; positive camera plus fragrance 1/1
  - id: prior_regressions
    status: pass
    evidence: exclusions, Hebrew exclusive follow-up, aggregate budget, eSIM/NFC/evening and schema-output stress all passed
checks:
  - command: npm run build
    exit_code: 0
    result: production build passed
  - command: npm test
    exit_code: 0
    result: 27 files, 311 tests passed
  - command: npm run test:e2e
    exit_code: 0
    result: 34 Playwright tests passed
  - command: node /tmp/bazak-open-vocab-runner.mjs
    exit_code: 0
    result: 42 live OpenAI POSTs completed; all assessed scenarios met expectations
changed_scope: developer-supplied dirty candidate preserved; QA added only this report
regressions_checked: arbitrary and curated evidence, positive matches, ordinary browsing, multi-intent scoping, exclusions, follow-up, aggregate budget, structured output
limitations: conservative lexical matching for unseen synonyms; neutral ordinary-preference response does not explain lack of verification; no token/cost/internal-attempt telemetry; no security/load/deployment testing
residual_risks: provider nondeterminism beyond sampled attempts; honest false negatives for unseen synonymous wording
overall: pass
```

## Limitations and recommendation

- Open-vocabulary evidence uses conservative lexical matching. An unseen synonym can produce an honest false negative; the application does not claim semantic entailment.
- Ordinary preference language remains soft context. `long-lasting battery` cards are not verified battery-life recommendations unless the user explicitly requests catalog proof.
- Empty outcomes were validated against trusted catalog text and positive controls; emptiness alone was never treated as proof of correctness.
- Token counts, dollar cost, and internal provider regeneration attempts were not exposed.

The candidate is ready for final review within the tested product scope. No further live paid rerun is required unless the evidence parser or surrounding orchestration changes.
