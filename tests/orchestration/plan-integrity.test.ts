import { describe, expect, it } from 'vitest';
import type { ExtractedIntent } from '../../src/lib/orchestration/contracts';
import {
  decideFollowUpTargets,
  explicitPromptCategories,
  inspectPlanCategoryCoverage,
  isExclusiveNamedFollowUp,
  type CategoryResolver,
} from '../../src/lib/orchestration/plan-integrity';

const categories = ['smartphones', 'fragrances', 'laptops'];
const resolveCategory: CategoryResolver = (requested, context, available) => {
  if (requested && available.includes(requested)) return requested;
  const text = context.toLocaleLowerCase('en-US');
  if (/(?:phone|smartphone|טלפון)/u.test(text)) return 'smartphones';
  if (/(?:fragrance|perfume|בושם)/u.test(text)) return 'fragrances';
  if (/(?:laptop|מחשב נייד)/u.test(text)) return 'laptops';
  return undefined;
};

const draft = (goal: string, category?: string): ExtractedIntent => ({
  goal,
  query: goal,
  constraints: category ? { category } : {},
  status: 'ready',
});

describe('plan category integrity', () => {
  it.each([
    ['Find a phone and a fragrance', ['smartphones', 'fragrances']],
    ['תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר', ['smartphones', 'fragrances']],
    ['מצא לי שני דברים: (1) טלפון; (2) בושם', ['smartphones', 'fragrances']],
  ])('finds every explicit category in %s', (prompt, expected) => {
    expect(explicitPromptCategories(prompt, categories, resolveCategory)).toEqual(expected);
  });

  it('flags a missing Hebrew fragrance and duplicated smartphone plan', () => {
    const result = inspectPlanCategoryCoverage(
      'תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר',
      [draft('טלפון', 'smartphones'), draft('עוד טלפון', 'smartphones')],
      categories,
      resolveCategory,
    );

    expect(result).toEqual({
      explicitCategories: ['smartphones', 'fragrances'],
      extractedCategories: ['smartphones', 'smartphones'],
      missingCategories: ['fragrances'],
      duplicatedCategories: ['smartphones'],
      requiresRepair: true,
    });
  });

  it('accepts one extracted intent for every explicitly named category', () => {
    expect(inspectPlanCategoryCoverage(
      'Find a phone and perfume',
      [draft('phone', 'smartphones'), draft('perfume', 'fragrances')],
      categories,
      resolveCategory,
    )).toMatchObject({ missingCategories: [], duplicatedCategories: [], requiresRepair: false });
  });

  it('does not reject a single-category prompt merely because several same-category intents exist', () => {
    expect(inspectPlanCategoryCoverage(
      'Find two phones',
      [draft('work phone', 'smartphones'), draft('camera phone', 'smartphones')],
      categories,
      resolveCategory,
    )).toMatchObject({ explicitCategories: ['smartphones'], requiresRepair: false });
  });

  it('does not destructively rewrite a plan when explicit-category detection and draft counts differ', () => {
    expect(inspectPlanCategoryCoverage(
      'Find a laptop, basketball shoes, and a fragrance',
      [draft('laptop', 'laptops'), draft('basketball shoes'), draft('unavailable search')],
      categories,
      resolveCategory,
    )).toMatchObject({ requiresRepair: false });
  });
});

describe('follow-up target integrity', () => {
  const previousIntents = [
    { id: 'phone', constraints: { category: 'smartphones' } },
    { id: 'scent', constraints: { category: 'fragrances' } },
  ];

  it('clarifies a category-free constraint update even if a provider could have selected one ID', () => {
    expect(decideFollowUpTargets({
      prompt: 'Make it under $300', previousIntents, availableCategories: categories, resolveCategory,
    })).toEqual({
      kind: 'clarify', intentIds: ['phone', 'scent'], categories: ['smartphones', 'fragrances'],
    });
  });

  it('selects the explicitly named current product', () => {
    expect(decideFollowUpTargets({
      prompt: 'Make the smartphone under $300', previousIntents, availableCategories: categories, resolveCategory,
    })).toEqual({ kind: 'single', intentId: 'phone', category: 'smartphones' });
  });

  it.each([
    'Make both of them under $300 each',
    'שניהם עד 300 דולר כל אחד',
  ])('targets all previous intents for %s', (prompt) => {
    expect(decideFollowUpTargets({ prompt, previousIntents, availableCategories: categories, resolveCategory }))
      .toEqual({ kind: 'all', intentIds: ['phone', 'scent'] });
  });

  it('attaches a category-free update when exactly one previous intent exists', () => {
    expect(decideFollowUpTargets({
      prompt: 'Only show ones rated at least 4',
      previousIntents: previousIntents.slice(1),
      availableCategories: categories,
      resolveCategory,
    })).toEqual({ kind: 'single', intentId: 'scent', category: 'fragrances' });
  });

  it('does not treat an unrelated sentence as a refinement', () => {
    expect(decideFollowUpTargets({
      prompt: 'Tell me something interesting', previousIntents, availableCategories: categories, resolveCategory,
    })).toEqual({ kind: 'not_refinement' });
  });

  it.each([
    'Only the fragrance should be under $70',
    'רק הבושם עד 70 דולר',
  ])('recognizes exclusive named scope: %s', (prompt) => {
    expect(isExclusiveNamedFollowUp(prompt, categories, resolveCategory)).toBe(true);
  });

  it('does not make an ordinary named refinement exclusive', () => {
    expect(isExclusiveNamedFollowUp('Make the fragrance under $70', categories, resolveCategory)).toBe(false);
  });
});
