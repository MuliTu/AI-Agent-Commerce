import { extractedTurnPlanSchema } from '../orchestration/contracts';

export type IntentPlanLanguage = 'en' | 'he' | 'unknown';

export type IntentPlanSummary = {
  intentCount: number;
  response: {
    language: IntentPlanLanguage;
    length: number;
  };
  intents: Array<{
    index: number;
    hasIntentId: boolean;
    status: 'ready' | 'needs_clarification';
    categoryPresent: boolean;
    category?: string;
    constraintKeys: string[];
    goalLength: number;
    queryLength: number;
  }>;
};

const sensitiveCategoryFragments = [
  'apikey', 'authorization', 'bearer', 'credential', 'password', 'privatekey',
  'secret', 'token',
];

function responseLanguage(value: string): IntentPlanLanguage {
  if (/[\u0590-\u05ff]/u.test(value)) return 'he';
  if (/[a-z]/iu.test(value)) return 'en';
  return 'unknown';
}

function safeCategory(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!normalized || normalized.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(normalized)) {
    return undefined;
  }
  if (normalized.startsWith('sk-')
    || sensitiveCategoryFragments.some((fragment) => normalized.includes(fragment))) {
    return undefined;
  }
  return normalized;
}

/**
 * Reduces a validated provider intent plan to bounded structural metadata.
 * The strict plan schema rejects raw products, provider envelopes, secret-like
 * extra fields, and every other value outside the intent contract.
 */
export function summarizeIntentPlan(value: unknown): IntentPlanSummary {
  const plan = extractedTurnPlanSchema.parse(value);
  return {
    intentCount: plan.intents.length,
    response: {
      language: responseLanguage(plan.response),
      length: plan.response.length,
    },
    intents: plan.intents.map((intent, index) => {
      const category = safeCategory(intent.constraints.category);
      return {
        index,
        hasIntentId: intent.intentId !== undefined,
        status: intent.status,
        categoryPresent: intent.constraints.category !== undefined,
        ...(category === undefined ? {} : { category }),
        constraintKeys: Object.entries(intent.constraints)
          .filter(([, nested]) => nested !== undefined)
          .map(([key]) => key)
          .sort(),
        goalLength: intent.goal?.length ?? 0,
        queryLength: intent.query?.length ?? 0,
      };
    }),
  };
}
