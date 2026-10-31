# Third-Fix Live OpenAI QA Retest — 2026-10-30

## Verdict

**FAIL — three of four residual fixes pass; one clean eSIM negation bug remains.**

The current candidate is substantially improved and stable under live OpenAI execution:

- 42/42 live POSTs returned HTTP 200 with a structured application result.
- `invalid_tool_output`: 0/42. Across the second and third fix retests this is now 0/83 live requests, compared with 5/64 in the first final retest.
- Exclusive Hebrew/English refinements now return only the named fragrance outcome, while an ordinary named refinement still preserves its phone sibling.
- `no more than` is now correctly distinguished from minimum-price language.
- Hebrew evening-fragrance evidence enforcement passed 7/7 despite varied model wording.
- One residual defect remains: the exact phrase `does not mention eSIM` is still misclassified as an unsupported brand exclusion in 2/2 identical clean reproductions.

No product code, provider settings, credentials, security settings, or existing user data were changed during this run.

## Candidate and isolation

- Repository: `/Users/mulituriel/Documents/Projects/AI-Agent-Commerce`
- Candidate HEAD: `81899cc310777659c562d2f18425c82490c95522`
- Candidate state: developer-supplied dirty working tree; all pre-existing work was preserved.
- Handoff: `outputs/QA_SECOND_RETEST_FIX_HANDOFF_2026-10-30.md`
- Build: fresh `npm run build` before live execution.
- Runtime: fresh production server at `127.0.0.1:3341`.
- Isolated database: `/tmp/bazak-third-retest.DMJ8LB/commerce.sqlite`.
- Isolated conversation IDs: `third-fix-*`; no existing conversations were read, edited, or deleted.
- Live provider: the application's configured OpenAI provider, explicitly authorized by the user.
- Security testing: out of scope.

## Scoring

- Quality: 0 complete failure, 1 poor/major defect, 2 weak/substantial fixes needed, 3 acceptable but noticeably flawed, 4 good/minor improvement, 5 excellent.
- Creativity: 0 ordinary, 5 exceptionally unusual or inventive.

## Verification summary

| Check | Result | Evidence |
|---|---:|---|
| Production build | PASS | `npm run build`, exit 0 |
| Unit/integration | PASS | 27 files, 293 tests, exit 0 |
| Browser E2E | PASS | 34/34 Playwright tests, exit 0 |
| Live OpenAI POSTs | 42/42 structured results | No harness exceptions/timeouts/malformed JSON |
| Live schema failures | 0/42 | No `invalid_tool_output` |
| Conversation restore GETs | 6/6 | Each restored two turns and four messages |
| Observed latency | 78–4,725 ms | End-to-end POST duration |
| Model regeneration attempts | Not observable | Logs expose sanitized final plan summaries, not per-request generation count |
| Tokens/cost | Not observable | No usage/cost telemetry exposed; no estimate invented |

The Playwright suite uses its configured deterministic provider and is regression evidence for UI mechanics only, not a substitute for the 42 live-provider requests.

## Fix 1 — Exclusive refinement versus ordinary refinement

### Hebrew exclusive refinement

- Exact sequence, repeated three times:
  1. `מצא לי טלפון ובושם.`
  2. `רק הבושם עד 70 דולר.`
- Expected (specified): the new result must contain one fragrance intent with `maxPrice=70`; no phone intent/cards in the new assistant block. Earlier turns must remain in conversation history.
- Before: the planner updated fragrance but the new result incorrectly merged the entire old phone outcome; quality 2/5.
- Actual: 3/3 new results contained exactly one fragrance outcome, `category=fragrances`, `maxPrice=70`, with only Calvin Klein CK One $49.99 and Dolce Shine $69.99. No phone outcome or phone card appeared in the new result. Response: `חיפשתי בקטלוג עבור בקשת הקנייה שלך.`
- History evidence: each GET returned two turns/four messages. The first historical turn retained its original phone and fragrance outcomes; the second historical turn retained only the fragrance outcome. Thus history was preserved without contaminating the new result.
- Attempts: 3 two-turn sequences = 6 live POSTs plus 3 read-only GETs.
- Evidence IDs: `third-fix-ex_he-1..3`.
- Classification: **fixed**.
- Creativity: 2/5. Quality: **5/5**.

### English exclusive refinement

- Exact sequence, repeated twice:
  1. `Find me a phone and a fragrance.`
  2. `Only the fragrance should be under $70.`
- Expected: same exclusive behavior in English.
- Actual: 2/2 new results contained only the $70 fragrance outcome and the same two valid cards; no phone outcome. Both histories retained the original two-intent turn and the one-intent refinement turn.
- Attempts: 2 sequences = 4 live POSTs plus 2 GETs.
- Evidence IDs: `third-fix-ex_en-1..2`.
- Classification: **fixed**.
- Creativity: 2/5. Quality: **5/5**.

### Ordinary named refinement control

- Exact sequence:
  1. `Find me a phone and a fragrance.`
  2. `Make the fragrance under $70.`
- Expected (specified contrast): unlike “Only,” preserve the unchanged phone sibling while updating fragrance.
- Actual: the new result contained both outcomes: the original phone outcome and fragrance with `maxPrice=70`/CK One/Dolce Shine. Restored history contained two turns and four messages.
- Attempts: 1 sequence = 2 live POSTs plus 1 GET.
- Evidence ID: `third-fix-ord_en-1`.
- Classification: **pass; no overcorrection**.
- Creativity: 1/5. Quality: **5/5**.

## Fix 2 — eSIM evidence language versus true brand exclusion

| ID | Exact input | Expected | Actual | Attempts | Creativity | Quality | Result |
|---|---|---|---|---:|---:|---:|---|
| ESIM-STATED | `Find a smartphone with verified eSIM support. If eSIM is not stated in the catalog, say that rather than recommending generic phones.` | Evidence-unavailable, no generic products | Correct empty smartphone outcome; exact evidence-unavailable copy | 1 | 4 | 5 | Pass |
| ESIM-LISTED | `Find a smartphone with eSIM. If it isn't listed in the catalog details, return no generic substitutes.` | Same | Correct empty evidence result | 1 | 4 | 5 | Pass |
| ESIM-DONT-GUESS | `Find a phone with eSIM support, but do not guess when the catalog is silent.` | Same; no false exclusion | Correct empty evidence result | 1 | 3 | 5 | Pass |
| ESIM-CONTRACTION | `Find a smartphone with eSIM support. If the catalog doesn't mention it, return no products.` | Same | Correct empty evidence result | 1 | 3 | 5 | Pass |
| ESIM-MENTION-CLEAN | `Find a smartphone with eSIM support. If the catalog does not mention eSIM, say so and return no products.` | Same | Incorrect immediate `Brand exclusion is not supported (mention eSIM).` | 2 | 3 | 1 | **Fail 2/2** |
| ESIM-MENTION-COMPLEX | `Find a phone with eSIM only if the catalog description does not omit it; if the catalog does not mention eSIM, say so.` | Same | Incorrect `Brand exclusion is not supported (omit it, mention eSIM).` | 1 | 4 | 1 | Fail |
| BRAND-NEG | `Show smartphones under $500, but not Samsung.` | True exclusion must remain safely rejected | Correct zero-product brand-exclusion response naming Samsung | 2 | 2 | 5 | Pass 2/2 |

Before this fix pass, `not stated` failed. It now passes, as do `isn't listed`, `do not guess`, and the contraction `doesn't mention it`. However, the handoff explicitly required `does not mention`; the clean two-attempt reproduction proves that variant remains broken.

Classification: **partial fix with one confirmed deterministic false positive**. The behavior appears to depend on the exact negation phrase, not on provider nondeterminism: failing variants complete in 81–120 ms before provider planning, while passing evidence variants take 1,720–1,932 ms and produce a catalog intent.

## Fix 3 — `no more than` versus minimum-price language

### Aggregate budget

- Exact input, repeated twice: `Find a phone and a fragrance together for no more than $500 total.`
- Expected (specified): aggregate-budget-only explanation, no minimum-price warning, no products.
- Before: safely rejected aggregate budget but also falsely said minimum-price filtering was unsupported; quality 3/5.
- Actual: 2/2 exact response `A combined budget across products is not supported. Please provide a separate maximum price for each product.` No minimum warning, no products.
- Attempts/evidence: 2; `third-fix-agg_no_more-1..2`; 83–84 ms.
- Classification: **fixed**.
- Creativity: 3/5. Quality: **5/5**.

### Single-product maximum control

- Exact input, repeated twice: `Find a phone for no more than $300.`
- Expected: supported maximum price, not minimum-price rejection.
- Actual: 2/2 normal smartphone searches with `maxPrice=300`; every returned phone was $299.99 or less.
- Attempts/evidence: 2; `third-fix-single_no_more-1..2`.
- Classification: **pass; no overblocking**.
- Creativity: 1/5. Quality: **5/5**.

### True minimum controls

- Exact input: `Find a phone costing more than $300.`
- Exact input: `Find a phone costing at least $300.`
- Expected: minimum-price-specific limitation, no products.
- Actual: each returned exact copy `Minimum-price filtering is not supported. Please provide a maximum price instead.` and no products.
- Attempts/evidence: 1 each; `third-fix-more_than-1`, `third-fix-at_least-1`.
- Classification: **pass; distinction preserved**.
- Creativity: 1/5 each. Quality: **5/5** each.

## Fix 4 — Hebrew evening evidence, repeated seven times

- Exact input: `תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי.`
- Expected (specified): two independent intents with phone `maxPrice=400/inStock=true` and fragrance `maxPrice=80/inStock=true`; every fragrance must contain trusted evening/night evidence, otherwise fragrance must be empty with an honest evidence-unavailable explanation.
- Before: 3/5 runs returned CK One, Dolce Shine, and Gucci Bloom despite no evening evidence; quality 3/5.
- Actual: 7/7 plans retained the correct category, price, and stock constraints. Phone cards were all in stock and at or below $400. Every fragrance outcome was empty. Every response used Hebrew evidence-unavailable copy: `הקטלוג אינו מציין את התכונה שביקשת, ולכן לא אציג מוצרים כלליים כאילו היא אומתה.`
- Provider wording varied naturally across English and Hebrew queries: `evening fragrance in stock under $80`, `evening fragrance under 80 USD in stock`, Hebrew `בושם לערב...`, and `evening fragrance perfume...`; the application behavior remained identical.
- Attempts/evidence: 7; `third-fix-evening_he-1..7`; 2,048–3,881 ms.
- Classification: **fixed/stable in this sample**.
- Creativity: 3/5. Quality: **5/5**.

## Malformed-output regression coverage

### Explicit English two-intent request

- Exact input, repeated five times: `Find two separate things: an in-stock phone under $400, and an in-stock evening fragrance under $80.`
- Expected: valid two-intent final result; no schema failure; phone cards constrained correctly and fragrance evidence-safe.
- Actual: 5/5 valid final results, no `invalid_tool_output`. All phone results were in stock/≤$400; all fragrance outcomes were honestly empty.
- Evidence IDs: `third-fix-malformed_l15-1..5`.
- Creativity: 2/5. Quality: **5/5**.

### Ordinary Samsung request

- Exact input, repeated three times: `Show Samsung smartphones under $450.`
- Expected: no schema failure; Samsung only/≤$450.
- Actual: 3/3 valid results; only Galaxy S7 $299.99, `brands=[Samsung]`, `maxPrice=450`.
- Evidence IDs: `third-fix-malformed_n01-1..3`.
- Creativity: 0/5. Quality: **5/5**.

Across this run, schema-invalid final results were 0/42. Application logs did not expose whether the 4,725 ms Samsung attempt used an internal schema-regeneration attempt, so no provider-call multiplier is inferred.

## Remaining defect

### P1 — `does not mention <feature>` is still parsed as brand exclusion

- Clean reproduction: `Find a smartphone with eSIM support. If the catalog does not mention eSIM, say so and return no products.`
- Reproduction rate: 2/2 identical attempts, plus 1/1 longer variant.
- Actual: `Brand exclusion is not supported (mention eSIM). Please name brands you do want included.`
- Expected: an evidence-unavailable smartphone outcome, as produced by the semantically equivalent contraction `doesn't mention it`.
- User impact: truthful feature-evidence requests receive a nonsensical brand message and never reach catalog evidence evaluation.
- Preliminary locus hypothesis: deterministic exclusion parsing recognizes some protected multiword forms (`not stated`, `isn't listed`, contraction `doesn't mention`) but fails to suppress candidate extraction for the uncontracted sequence `does not mention`. This is inferred from behavior/timing, not a proven code-level cause.
- Quality: **1/5**.

## VerificationReport

```yaml
ticket_id: third-live-retest-residual-fixes
candidate_revision: 81899cc310777659c562d2f18425c82490c95522-plus-dirty-working-tree
criteria:
  - id: exclusive_refinement
    status: pass
    evidence: 3/3 Hebrew and 2/2 English live sequences; new results contain fragrance only; 6/6 restores retain both historical turns
  - id: ordinary_refinement_preserves_siblings
    status: pass
    evidence: 1/1 live sequence; new result contains phone plus refined fragrance
  - id: evidence_language_not_brand_exclusion
    status: fail
    evidence: clean `does not mention eSIM` false-positive reproduced 2/2; true `not Samsung` control passed 2/2
  - id: no_more_than_classification
    status: pass
    evidence: aggregate 2/2, single maximum 2/2, true minimum controls 2/2
  - id: hebrew_evening_evidence
    status: pass
    evidence: 7/7 empty evidence-safe fragrance outcomes with correct sibling constraints
  - id: malformed_output_final_handling
    status: pass
    evidence: 0 invalid_tool_output across 42 live POSTs; L15 5/5 and N01 3/3
checks:
  - command: npm run build
    exit_code: 0
    result: production build passed
  - command: npm test
    exit_code: 0
    result: 27 files, 293 tests passed
  - command: npm run test:e2e
    exit_code: 0
    result: 34 Playwright tests passed
  - command: node /tmp/bazak-third-retest-runner.mjs plus supplemental clean eSIM contrasts
    exit_code: 0
    result: 42 live OpenAI POSTs, one residual semantic defect
changed_scope: developer-supplied dirty candidate preserved; QA added only this report
regressions_checked: exclusive/ordinary refinement, history restoration, feature evidence, true brand exclusion, maximum/minimum/aggregate budgets, Hebrew multi-intent, schema-invalid final handling
limitations: no token, dollar-cost, or internal model-attempt telemetry; no security/load/deployment testing
residual_risks: exact-language gaps in deterministic negation parsing; provider nondeterminism beyond sampled repetitions
overall: fail
```

## Recommendation

Do not give final sign-off yet. Fix the single remaining uncontracted `does not mention` false positive, then rerun these contrasts without another broad paid suite unless surrounding parsing changes materially:

1. `does not mention eSIM` and `does not mention NFC` — must reach evidence handling.
2. `doesn't mention it`, `not stated`, `not listed`, `do not guess` — must continue to reach evidence handling.
3. `not Samsung`, `anything but Apple`, `except Google` — must remain true exclusion rejections.
4. Run the live eSIM set at least twice and the deterministic full suite.
