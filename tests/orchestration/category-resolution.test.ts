import { describe, expect, it } from 'vitest';
import {
  explicitUsdMaxPrice,
  intentHasExplicitUsdBudget,
  isConstraintOnlyFollowUp,
  resolveCatalogCategory,
} from '../../src/lib/orchestration/category-resolution';

describe('multilingual catalog category resolution', () => {
  const categories = ['smartphones', 'fragrances', 'laptops', 'luggage', 'kitchen-accessories', 'beauty'];

  it.each([
    ['אני מחפש סמארטפון', 'smartphones'],
    ['רק הבושם עד 70 דולר', 'fragrances'],
    ['רק והטלפון עד 300 דולר', 'smartphones'],
    ['אני צריך מזוודה לנסיעה', 'luggage'],
    ['אני מחפש משהו טוב למטבח, אבל לא יקר מדי', 'kitchen-accessories'],
    ['יש לכם צלחות?', 'kitchen-accessories'],
  ])('maps %s to the relevant trusted category', (prompt, expected) => {
    expect(resolveCatalogCategory(undefined, prompt, categories)).toBe(expected);
  });

  it('does not guess an unrelated category for an unknown Hebrew product', () => {
    expect(resolveCatalogCategory(undefined, 'אני מחפש מוצר שלא קיים', categories)).toBeUndefined();
  });
});

describe('follow-up classification', () => {
  const categories = ['smartphones', 'fragrances', 'kitchen-accessories'];

  it.each(['show only options under $300', 'cheaper please', 'רק עד 300 דולר'])('recognizes a constraint-only follow-up: %s', (prompt) => {
    expect(isConstraintOnlyFollowUp(prompt, categories)).toBe(true);
  });

  it.each(['show smartphones under $300', 'אני רוצה צלחות עד 300 דולר'])('does not treat an explicit product topic as constraint-only: %s', (prompt) => {
    expect(isConstraintOnlyFollowUp(prompt, categories)).toBe(false);
  });

  expect(explicitUsdMaxPrice('show only options under $300')).toBe(300);
});

describe('explicit USD budget recognition', () => {
  const categories = ['smartphones', 'laptops', 'fragrances'];

  it.each([
    ['Find a laptop under $800', 'Find a laptop', 'laptops'],
    ['Find a laptop under 800 USD', 'Find a laptop', 'laptops'],
    ['Find a laptop under 800 dollars', 'Find a laptop', 'laptops'],
    ['אני צריך מחשב נייד עד 800 דולר', 'מחשב נייד', 'laptops'],
    ['אני צריך מחשב נייד עד 800 דולרים', 'מחשב נייד', 'laptops'],
    ['אני צריך מחשב נייד עד 800 דולר.', 'מחשב נייד', 'laptops'],
    ['אני צריך מחשב נייד עד 800 דולרים: משלוח מהיר', 'מחשב נייד', 'laptops'],
  ])('recognizes an explicit per-intent USD budget in %s', (prompt, context, category) => {
    expect(intentHasExplicitUsdBudget(prompt, context, 1, category, categories)).toBe(true);
  });

  it.each([
    'Find a cheap laptop',
    'מצא לי מחשב נייד זול',
    'Find a laptop under 800',
    'Find a laptop under dollars800',
    'אני צריך מחשב נייד עד דולר800',
    'אני צריך מחשב נייד עד 800 דולר9',
  ])('does not invent a USD budget for %s', (prompt) => {
    expect(intentHasExplicitUsdBudget(prompt, 'laptop', 1, 'laptops', categories)).toBe(false);
  });

  it.each([
    ['אני צריך מחשב נייד וגם בושם עד 80 דולר', 'מחשב נייד', 'laptops', false],
    ['אני צריך מחשב נייד וגם בושם עד 80 דולר', 'בושם', 'fragrances', true],
    ['אני צריך מחשב נייד ובושם עד 80 דולר', 'מחשב נייד', 'laptops', false],
    ['אני צריך מחשב נייד ובושם עד 80 דולר', 'בושם', 'fragrances', true],
    ['I need a laptop and a fragrance under 80 dollars', 'laptop', 'laptops', false],
    ['I need a laptop and a fragrance under 80 dollars', 'fragrance', 'fragrances', true],
    ['אני צריך מחשב נייד וקל עד 800 דולר וגם בושם', 'מחשב נייד וקל', 'laptops', true],
    ['אני צריך מחשב נייד וקל עד 800 דולר וגם בושם', 'בושם', 'fragrances', false],
  ])('scopes a multi-intent budget in %s', (prompt, context, category, expected) => {
    expect(intentHasExplicitUsdBudget(prompt, context, 2, category, categories)).toBe(expected);
  });

  it('recognizes separate explicit budgets for both Hebrew intents', () => {
    const prompt = 'אני צריך מחשב נייד עד 800 דולר וגם בושם עד 80 דולר';

    expect(intentHasExplicitUsdBudget(prompt, 'מחשב נייד', 2, 'laptops', categories)).toBe(true);
    expect(intentHasExplicitUsdBudget(prompt, 'בושם', 2, 'fragrances', categories)).toBe(true);
  });
});
