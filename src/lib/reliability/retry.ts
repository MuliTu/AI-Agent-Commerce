import { ZodError } from 'zod';
import { AgentBoundaryError } from '../agent/errors';
import { CatalogError } from '../catalog/errors';

export const MAX_ATTEMPTS = 5;

export type FailureCategory = 'transient' | 'authentication' | 'validation' | 'permanent';

export type FailureClassification = {
  category: FailureCategory;
  retryable: boolean;
};

export type FailedRetryAttempt = {
  attempt: number;
  outcome: 'failed';
  classification: FailureClassification;
  delayMs?: number;
};

export type SucceededRetryAttempt = {
  attempt: number;
  outcome: 'succeeded';
};

export type RetryAttempt = FailedRetryAttempt | SucceededRetryAttempt;

export type RetryOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttempt?: (attempt: RetryAttempt) => void;
};

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function notifyAttempt(observer: RetryOptions['onAttempt'], attempt: RetryAttempt): void {
  try {
    observer?.(attempt);
  } catch {
    // Observability is deliberately isolated from operation control flow.
  }
}

export function classifyFailure(error: unknown): FailureClassification {
  if (error instanceof ZodError) return { category: 'validation', retryable: false };

  if (AgentBoundaryError.isInstance(error)) {
    if (error.code === 'provider_authentication') {
      return { category: 'authentication', retryable: false };
    }
    if (error.code === 'invalid_tool_output' || error.code === 'unknown_product') {
      return { category: 'validation', retryable: false };
    }
    return {
      category: error.retryable ? 'transient' : 'permanent',
      retryable: error.retryable,
    };
  }

  if (error instanceof CatalogError) {
    if (error.kind === 'invalid_request' || error.kind === 'invalid_response') {
      return { category: 'validation', retryable: false };
    }
    if (error.kind === 'timeout' || error.kind === 'network') {
      return { category: 'transient', retryable: true };
    }
    if (error.kind === 'http') {
      if (error.status === 401 || error.status === 403) {
        return { category: 'authentication', retryable: false };
      }
      if (error.status === 408 || error.status === 429 ||
          (error.status !== undefined && error.status >= 500)) {
        return { category: 'transient', retryable: true };
      }
    }
  }

  return { category: 'permanent', retryable: false };
}

export function retryDelayMs(
  failedAttempt: number,
  options: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'random'> = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const random = options.random ?? Math.random;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new Error('baseDelayMs must be nonnegative');
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new Error('maxDelayMs must be at least baseDelayMs');
  }
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1 || failedAttempt >= MAX_ATTEMPTS) {
    throw new Error(`failedAttempt must be between 1 and ${MAX_ATTEMPTS - 1}`);
  }
  const jitter = random();
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new Error('random must return a number between 0 and 1');
  }
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (failedAttempt - 1));
  return Math.floor(cap * jitter);
}

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await operation(attempt);
      notifyAttempt(options.onAttempt, { attempt, outcome: 'succeeded' });
      return result;
    } catch (error) {
      const classification = classifyFailure(error);
      if (!classification.retryable || attempt === MAX_ATTEMPTS) {
        notifyAttempt(options.onAttempt, { attempt, outcome: 'failed', classification });
        throw error;
      }
      const delayMs = retryDelayMs(attempt, options);
      notifyAttempt(options.onAttempt, { attempt, outcome: 'failed', classification, delayMs });
      await sleep(delayMs);
    }
  }
  throw new Error('unreachable retry state');
}
