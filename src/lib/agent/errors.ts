import { APICallError } from 'ai';
import { CatalogError } from '../catalog';

export type AgentErrorCode =
  | 'provider_authentication'
  | 'provider_rate_limit'
  | 'provider_unavailable'
  | 'catalog_unavailable'
  | 'unknown_product'
  | 'invalid_tool_output';

export class AgentBoundaryError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;

  constructor(code: AgentErrorCode, message: string, retryable: boolean, cause?: unknown) {
    super(message, { cause });
    this.name = 'AgentBoundaryError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function toCatalogAgentError(error: unknown): AgentBoundaryError {
  if (error instanceof AgentBoundaryError) return error;
  if (error instanceof CatalogError) {
    if (error.kind === 'http' && error.status === 404) {
      return new AgentBoundaryError('unknown_product', 'The requested product is not in the catalog.', false, error);
    }
    const retryable = error.kind === 'timeout' || error.kind === 'network' ||
      (error.kind === 'http' && error.status !== undefined && (error.status === 429 || error.status >= 500));
    return new AgentBoundaryError('catalog_unavailable', 'The catalog request could not be completed.', retryable, error);
  }
  return new AgentBoundaryError('catalog_unavailable', 'The catalog request could not be completed.', false, error);
}

export function toProviderAgentError(error: unknown): AgentBoundaryError {
  if (error instanceof AgentBoundaryError) return error;
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) {
      return new AgentBoundaryError('provider_authentication', 'The model provider rejected the request.', false, error);
    }
    if (status === 429) {
      return new AgentBoundaryError('provider_rate_limit', 'The model provider rate limit was reached.', true, error);
    }
    return new AgentBoundaryError(
      'provider_unavailable',
      'The model provider request failed.',
      status === undefined || status >= 500,
      error,
    );
  }
  return new AgentBoundaryError('provider_unavailable', 'The model provider request failed.', false, error);
}
