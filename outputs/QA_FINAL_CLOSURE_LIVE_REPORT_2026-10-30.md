# Final-Closure Live OpenAI QA Report — 2026-10-30

## Verdict

**FAIL — the targeted eSIM/brand-exclusion fix passes, but a broader unknown-feature evidence defect remains.**

The exact final bug from the previous report is fixed:

- `If the catalog does not mention eSIM...` passed 2/2 with an honest empty evidence result.
- The same active construction for NFC passed 2/2.
- `does not state/list/show`, `doesn't mention`, `not stated`, `not listed`, `do not guess`, `does not omit`, and `does not sell or describe` controls no longer become brand exclusions when used with the recognized eSIM/NFC evidence features.
- Genuine brand exclusions (`not Samsung`, `anything but Apple`, `except Google`) remain safely rejected.

However, a new clean contrast revealed a still-material product-fact problem: an unknown feature such as **satellite calling** is not evidence-gated. Both `does not state satellite calling` and `does not mention satellite calling` returned 16 generic smartphones in 2/2 attempts each, despite the explicit instruction to return no products if the catalog lacks the fact. The final parser fix is correct; the evidence system is still limited to a known feature vocabulary.

No product code, credentials, provider configuration, security settings, or existing user data were changed.

## Candidate and isolation

- Repository: `/Users/mulituriel/Documents/Projects/AI-Agent-Commerce`
- Candidate HEAD: `81899cc310777659c562d2f18425c82490c95522`
- Candidate state: developer-provided dirty working tree; pre-existing changes preserved.
- Handoff: `outputs/QA_THIRD_RETEST_FIX_HANDOFF_2026-10-30.md`
- Fresh production build and server: `127.0.0.1:3342`
- Isolated DB: `/tmp/bazak-final-close.2K8bpt/commerce.sqlite`
- Isolated conversation IDs: `final-close-*`
- Provider: configured live OpenAI provider, authorized by the user.
- Security testing: out of scope.

## Scoring

- Quality: 0 complete failure, 1 poor/major defect, 2 weak/substantial fixes needed, 3 acceptable but flawed, 4 good/minor improvement, 5 excellent.
- Creativity: 0 ordinary, 5 exceptionally unusual or inventive.

## Run summary

| Check | Result | Evidence |
|---|---:|---|
| Production build | PASS | `npm run build`, exit 0 |
| Unit/integration | PASS | 27 files, 303 tests, exit 0 |
| Browser E2E | PASS | 34/34 Playwright tests, exit 0 |
| Live OpenAI POSTs | 44/44 HTTP 200 structured results | No harness exception or timeout |
| Live final schema failures | 0/44 | No `invalid_tool_output` |
| Observed latency | 77–4,033 ms | Per-request end-to-end timing |
| Token/cost telemetry | Not available | No usage fields exposed; no estimate invented |
| Internal model attempt count | Not available | Logs expose only sanitized final plan summaries |

One deliberately awkward satellite prompt (`only if the catalog does not state the feature; otherwise...`) was logically ambiguous and is marked **harness design error / N/A**. It is not used in the verdict. Four later clean satellite requests establish the defect independently.

## Final fix: evidence language versus true brand exclusion

### Exact previously failing phrase

- Question, repeated twice: `Find a smartphone with eSIM support. If the catalog does not mention eSIM, say so and return no products.`
- Expected (specified): reach catalog evidence handling, return no generic matches, and never call `mention eSIM` a brand.
- Before: 2/2 immediate false brand-exclusion failures, exact bad copy `Brand exclusion is not supported (mention eSIM).` Quality 1/5.
- Actual: 2/2 completed smartphone intents with zero products and exact copy `The catalog does not state the requested feature, so I won’t present generic products as verified matches.`
- Attempts/evidence: 2; `final-close-esim_mention-1..2`; 1,965–2,762 ms.
- Classification: **fixed**.
- Creativity: 3/5. Quality: **5/5**.

### Evidence-language matrix

| ID | Exact question | Expected | Actual | Attempts | Creativity | Quality |
|---|---|---|---|---:|---:|---:|
| NFC-MENTION | `Find a smartphone with NFC support. If the catalog does not mention NFC, say so and return no products.` | Empty evidence result | Empty evidence result, no false exclusion | 2/2 | 3 | 5 |
| STATE-ESIM | `Find a smartphone with eSIM support. If the catalog does not state eSIM support, return no products.` | Empty evidence result | Empty evidence result | 2/2 | 3 | 5 |
| LIST-ESIM | `Find a smartphone with eSIM only if the catalog does not list the feature; otherwise return no products.` | No false exclusion; no generic cards | Empty evidence result | 2/2 | 3 | 5 |
| SHOW-NFC | `Find a phone with NFC support. If the catalog does not show NFC, return no products.` | Empty evidence result | Empty evidence result | 2/2 | 4 | 5 |
| OMIT-ESIM | `Find a phone with eSIM only if the catalog does not omit the feature; otherwise return no products.` | No false exclusion; evidence-safe result | Empty evidence result | 2/2 | 4 | 5 |
| SELL-ESIM | `Find a phone with eSIM, but if the catalog does not sell or describe such a phone, return no products.` | No false exclusion; evidence-safe result | Empty evidence result | 2/2 | 4 | 5 |
| CONTRACTED | `Find a smartphone with eSIM support. If the catalog doesn't mention it, return no products.` | Empty evidence result | Empty evidence result | 2/2 | 2 | 5 |
| NOT-STATED | `Find a smartphone with eSIM support. If eSIM is not stated in the catalog, return no products.` | Empty evidence result | Empty evidence result | 2/2 | 2 | 5 |
| NOT-LISTED | `Find a smartphone with eSIM support. If eSIM is not listed in the catalog, return no products.` | Empty evidence result | Empty evidence result | 2/2 | 2 | 5 |
| DONT-GUESS | `Find a smartphone with eSIM support, but do not guess if the catalog is silent.` | Empty evidence result | Empty evidence result | 2/2 | 2 | 5 |

All 20 valid recognized-feature evidence requests passed.

### True exclusion controls

| Question | Expected | Actual | Attempts | Creativity | Quality |
|---|---|---|---:|---:|---:|
| `Show smartphones under $500, but not Samsung.` | Safe unsupported brand exclusion | Zero products; copy names Samsung | 1 | 1 | 5 |
| `Find a phone under $600, anything but Apple.` | Same | Zero products; copy names Apple | 1 | 2 | 5 |
| `Show me smartphones except Google.` | Same | Zero products; copy names Google | 1 | 2 | 5 |

The recognized-feature evidence cases took provider-path timings (~1.7–2.8 s), while true exclusions were deterministic preflight results (77–96 ms). This supports, but does not by itself prove, that the final false-exclusion parser fix is functioning as intended.

## Newly confirmed residual defect: arbitrary unknown feature claims

### `does not state satellite calling`

- Exact question, repeated twice: `Find a smartphone with satellite calling. If the catalog does not state satellite calling support, return no products.`
- Expected (specified by the prompt and handoff principle): no generic matches when the catalog does not state the requested feature.
- Actual: 2/2 returned 16 ordinary smartphones, including Realme XT, Galaxy S8, Vivo X21, Realme C35, iPhone 13 Pro, and others. No returned title, description, or tag stated satellite calling. Response falsely implied success: `I searched the catalog for your shopping request.`
- Intent plan: smartphone category only, with no evidence constraint/required tag.
- Evidence IDs: `final-close-feature-state-clean-1..2`.
- Creativity: 3/5. Quality: **0/5**.

### `does not mention satellite calling`

- Exact question, repeated twice: `Find a smartphone with satellite calling. If the catalog does not mention satellite calling, return no products.`
- Expected: same evidence-safe empty result.
- Actual: again 16 generic smartphones in 2/2; no satellite evidence and ordinary success copy.
- Evidence IDs: `final-close-satellite-mention-1..2`.
- Creativity: 4/5. Quality: **0/5**.

Classification: **confirmed residual capability defect, 4/4 clean reproductions**. It is not the repaired brand-exclusion bug: these requests reach provider planning and catalog search, but the resulting plan lacks an evidence requirement. Preliminary hypothesis: feature-evidence derivation recognizes a bounded vocabulary (eSIM, NFC, IP68, camera, evening fragrance, etc.) instead of enforcing the shopper's explicit “catalog must state/mention X” condition for arbitrary feature X. This is a behavioral hypothesis, not a proven code cause.

## Earlier regression cases

| Scenario | Exact input/sequence | Expected | Actual | Attempts | Creativity | Quality |
|---|---|---|---|---:|---:|---:|
| Exclusive Hebrew | `מצא לי טלפון ובושם.` → `רק הבושם עד 70 דולר.` | New result contains fragrance only, ≤$70 | One fragrance intent only; CK One $49.99 and Dolce Shine $69.99 | 2 sequences | 2 | 5 |
| Hebrew evening | `תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי.` | Correct phone constraints; no fragrance without evening evidence | Phone cards all ≤$400/in stock; empty fragrance outcome with honest Hebrew copy | 3 | 3 | 5 |
| Aggregate budget | `Find a phone and a fragrance together for no more than $500 total.` | Aggregate-only limitation, no minimum warning | Exact correct aggregate explanation, zero products | 1 | 3 | 5 |
| Structured-output stress | `Find two separate things: an in-stock phone under $400, and an in-stock evening fragrance under $80.` | No schema failure; evidence-safe outcomes | 3/3 structured success; constrained phones and empty fragrance | 3 | 2 | 5 |
| Positive brand control | `Show Samsung smartphones under $450.` | Samsung only, ≤$450 | 2/2 only Galaxy S7 $299.99 | 2 | 0 | 5 |

No regression was observed in these previously sensitive cases.

## VerificationReport

```yaml
ticket_id: final-evidence-negation-closure
candidate_revision: 81899cc310777659c562d2f18425c82490c95522-plus-dirty-working-tree
criteria:
  - id: exact_does_not_mention_esim
    status: pass
    evidence: 2/2 live requests reached evidence handling and returned zero products
  - id: nearby_recognized_evidence_phrases
    status: pass
    evidence: 20/20 valid recognized-feature evidence requests passed
  - id: genuine_brand_exclusions
    status: pass
    evidence: not Samsung, anything but Apple, except Google each safely rejected
  - id: arbitrary_explicit_feature_evidence
    status: fail
    evidence: satellite calling returned 16 generic phones in 4/4 clean requests
  - id: prior_sensitive_regressions
    status: pass
    evidence: exclusive Hebrew 2/2, evening Hebrew 3/3, aggregate 1/1, L15 3/3, Samsung 2/2
checks:
  - command: npm run build
    exit_code: 0
    result: production build passed
  - command: npm test
    exit_code: 0
    result: 27 files, 303 tests passed
  - command: npm run test:e2e
    exit_code: 0
    result: 34 Playwright tests passed
  - command: live isolated OpenAI matrix
    exit_code: 0
    result: 44 POSTs; exact target fixed; one broader residual defect confirmed
changed_scope: developer-supplied dirty candidate preserved; QA added only this report
regressions_checked: evidence negation, true brand exclusions, exclusive follow-up, Hebrew evening evidence, aggregate budgets, structured output, positive brand filtering
limitations: no token/cost/internal-model-attempt telemetry; no security/load/deployment testing; finite sample under provider nondeterminism
residual_risks: arbitrary feature claims outside the recognized evidence vocabulary can still receive generic products
overall: fail
```

## Recommendation

The final eSIM parser patch itself can be accepted as fixed, but the product should not receive full QA sign-off while explicit arbitrary feature-evidence instructions can return unsupported generic recommendations.

The next fix should generalize evidence derivation: when the shopper explicitly says the catalog must `state`, `mention`, `list`, `show`, or `describe` a feature, extract that feature phrase and require trusted title/description/tag evidence regardless of whether it is in a predefined vocabulary. Then rerun:

1. Satellite calling with `state` and `mention` — must return zero products.
2. A positive trusted-text control such as `description mentions camera` — must still return evidence-backed cards.
3. eSIM/NFC controls — must remain empty and honest.
4. True brand exclusions — must remain safely rejected.
