# Independent Live QA Retest Plan — 2026-10-30

Status: ready for an independent QA run after build verification. This is a test plan, not a live-result report. The “before” observations come from `QA_LIVE_AI_REPORT_2026-10-30.md`; all “after” fields must be filled from new configured-provider requests using isolated conversations and unique turn IDs.

## Execution controls

- Use an isolated database and do not modify existing user conversations.
- Record provider/model path, build identifier, request duration, persisted outcome, constraints, products and user-visible copy.
- Use one conversation per independent case. Keep every multi-turn sequence in its own single conversation.
- Do not score a harness failure as product behavior. Retry only with a new globally unique turn ID and record the excluded attempt.
- Verify hard filters against trusted catalog fields. Do not infer IP68, wireless charging, eSIM, NFC or other facts absent from trusted title, description and tags.
- Keep deterministic/unit results separate from this live-provider report.

## Before/after replay matrix

| ID | Replay | Before | Required after | After evidence |
|---|---|---|---|---|
| L01 | Shallow-pockets phone, $350, in stock; repeat 3× | Pass | Stable smartphone/maxPrice/inStock result | Pending |
| L02 | Fragrance under $80 → rated at least 4 | Pass | Preserve category and $80; add rating | Pending |
| L03 | Camera phone $400 + evening fragrance $100, both in stock | Hard filters passed; soft evidence weak | Two scoped intents; explain or avoid claiming unsupported soft evidence | Pending |
| L04 | Phone + fragrance, $500 total; repeat 2× | Misleading success; budget lost/mis-scoped | Explicitly state aggregate budget is unsupported; no product recommendations claimed compliant | Pending |
| L05 | Phone under $500, not/except Samsung; repeat variants + positive control | Exclusion inverted to Samsung | Negative form explicitly unsupported, never inverted; positive control remains Samsung-only | Pending |
| L06 | Verified IP68 + wireless charging; no guessing | Generic phones returned | No generic matches; state catalog evidence is unavailable | Pending |
| L07 | Verified eSIM; no guessing | Generic phones returned | No generic matches; state catalog evidence is unavailable | Pending |
| L08 | Description mentions camera capabilities | Pass | Only evidence-backed camera matches | Pending |
| L09 | Laptop under $900 + quantum explanation | Quantum became product clarification | Laptop handled honestly; quantum receives catalog-only refusal | Pending |
| L10 | Pure quantum explanation | Product clarification | Single catalog-only refusal | Pending |
| L11 | Fragrance under $80 + 17×29 | Arithmetic became product clarification | Fragrance succeeds; arithmetic receives catalog-only refusal | Pending |
| L12 | Broad Hebrew kitchen request | Safe but unhelpful unknown category | Focused, honest category clarification or unknown-category response; no unrelated categories/budget | Pending |
| L13 | Natural Hebrew phone $400 + evening fragrance $80, both in stock | Two smartphone intents | Smartphone and fragrance, each with its own price and stock constraints | Pending |
| L14 | Numbered Hebrew equivalent | Pass | Remains passing | Pending |
| L15 | Explicit English equivalent | Pass | Remains passing | Pending |
| L16 | Phone + fragrance → “Make it under $300” | Budget applied to fragrance | Ask which active product is meant; do not select one silently | Pending |
| L17 | Phone + fragrance → explicitly smartphone under $300 | Pass | Update phone only; preserve fragrance | Pending |
| L18 | Phone + fragrance → both under $300 each | Pass | Update both independently | Pending |
| L19 | Phone under $200 and over $800 | Minimum silently discarded | Focused contradiction response; no products claimed compliant | Pending |
| L20 | Smartphone + London weather | Pass | Product succeeds; weather refused separately | Pending |
| L21 | Pure London weather | Pass | One friendly catalog-only refusal | Pending |

## Twenty new live cases

Creativity is a prompt-composition rating (0 ordinary, 5 unusually adversarial or figurative), not an expected model-temperature setting.

| ID | Creativity | Prompt / sequence | Pass criteria |
|---|---:|---|---|
| N01 | 0 | `Show Samsung smartphones under $450.` | Positive brand inclusion remains Samsung-only and ≤$450. |
| N02 | 0 | `Find an in-stock fragrance under $60.` | One fragrance intent; price and stock enforced. |
| N03 | 0 | `Find a phone with NFC support.` | If trusted catalog text does not establish NFC, return no verified matches and say why. |
| N04 | 1 | `Find a phone and a fragrance, each under $250.` | Two intents; independent $250 ceilings. |
| N05 | 1 | `Find a laptop under $700 and tell me a joke.` | Laptop handled honestly; joke refused, never turned into product clarification. |
| N06 | 1 | `Find a telescope in the catalog.` | Unknown product category is distinguished from off-topic refusal; no unrelated category suggestions. |
| N07 | 2 | `Find a phone and perfume.` → `Only the perfume should be under $55.` | Update fragrance only and preserve phone. |
| N08 | 2 | `Find a phone and perfume.` → `Make them cheaper.` | Ask which product(s) are intended; no silent target choice. |
| N09 | 2 | `Find a phone under $300.` → `It should have a good camera.` | Preserve $300 and phone context; rank/evidence behavior remains honest. |
| N10 | 2 | `מצא לי טלפון ובושם.` → `רק הבושם עד 70 דולר.` | Update fragrance only; preserve phone. |
| N11 | 3 | `I want a phone below $400, anything but Apple.` | Exclusion explicitly unsupported; never convert to Apple inclusion. |
| N12 | 3 | `Find a phone costing at least $250.` | Minimum-price limitation stated; no recommendation claimed compliant. |
| N13 | 3 | `Find a phone and charger for $420 all in.` | Aggregate budget limitation stated; do not silently apply $420 per intent or one intent. |
| N14 | 3 | `מצא לי טלפון עד 350 דולר ובושם עד 75 דולר, שניהם במלאי.` | Natural Hebrew yields one correctly scoped intent per named category. |
| N15 | 4 | `My total purse is $320: split it somehow between a phone and a scent.` | Ask for separate ceilings or state aggregate-budget limitation; no invented split. |
| N16 | 4 | `Find a waterproof phone, but only count it if the catalog literally says IP68.` | Evidence gate; no generic phone results without literal trusted evidence. |
| N17 | 4 | `Find a fragrance under $80 and explain why the sky is blue.` | Fragrance succeeds; explanation is separately refused. |
| N18 | 4 | `Find a phone under $500 but over $700.` | Contradiction surfaced; no result claimed valid. |
| N19 | 5 | `No galaxies, just gadgets: find a phone under $350, then explain quantum tunneling.` | Figurative wording does not hide two goals; phone handled, science refused. |
| N20 | 5 | `תן לי טלפון ובושם, יחד עד 500 דולר, ואל תנחש איך לחלק.` | Aggregate Hebrew budget is not silently distributed; limitation/clarification is explicit. |

## Report requirements

For every case, record pass/fail, creativity, quality 0–5, exact persisted constraints, product IDs/prices/stock where relevant, response copy, duration and evidence ID. Conclude with a before/after table for L01–L21, a separate N01–N20 table, regressions among previously passing controls, provider-plan diagnostic summaries, and residual unsupported semantics. Never include credentials, raw provider payloads or private conversation data.
