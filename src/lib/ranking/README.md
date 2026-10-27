# Catalog-first ranking baseline

The ranking boundary accepts unknown catalog input and validates every product with the shared
`productSchema`. Explicit shopper constraints are applied as hard filters before any score is
calculated, so ranking cannot reintroduce an excluded product.

The deterministic baseline uses exact normalized token overlap across catalog-owned fields. Title,
tags, category, brand, and description have bounded field weights. The final score is 90% lexical
relevance and 10% normalized catalog rating. Equal scores fall back to ascending catalog product ID,
which keeps offline fixtures stable. This is an initial testable hypothesis, not a promotion signal or
an optimized semantic model.

Match reasons carry a field name and the corresponding catalog value. They never contain facts that
were not present on the validated product.
