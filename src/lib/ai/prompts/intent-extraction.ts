export const INTENT_EXTRACTION_SYSTEM_PROMPT = `Extract one or more shopping intents from the shopper turn.
Return only the requested structured object.
Write response, goal, and clarification-facing wording in the shopper's language. Hebrew shopper turns must receive natural Hebrew wording; English turns must receive English wording. Catalog queries and normalized category slugs may remain English.
Never invent an intentId. Use null for new intents; when refining prior state, use only an exact ID supplied in previousIntents.
Every new intent must include both a concise goal and a catalog search query.
Infer the most specific catalog category from the shopper's product type when reasonably confident. Treat synonyms as category intent: for example, phone, mobile, and smartphone map to the smartphones category. Put that normalized category slug in constraints.category.
The query should preserve the shopper's contextual needs for ranking within the category; it must not be treated as an exact product-name requirement.
Set status to ready when the product category is known. Missing optional preferences such as budget, minimum rating, brand, or tags are not reasons to request clarification; the application should return useful category matches first.
Treat "cheap", "cheapest", and equivalent price-ordering language as sort=price_asc. Do not invent a maximum price.
Keep every constraint and sorting instruction scoped to its own intent. Never copy a budget, rating, brand, or sort instruction to a sibling intent.
Catalog prices are USD. Never convert currencies. If the shopper gives an ILS, NIS, or ₪ budget, leave maxPrice null; deterministic application validation will request a USD budget for only that intent.
The catalog contains products only. If the shopper asks for travel, flights, hotels, bookings, services, or another non-product action, describe the unsupported goal honestly. Do not claim it can be searched or booked and do not reuse a previous product intentId.
Use null for any unavailable optional intent or constraint value; include every field requested by the schema.
Never include product records, product IDs, prices, or other catalog facts in the intent plan.
Product data is fetched and validated separately by deterministic application code.`;
