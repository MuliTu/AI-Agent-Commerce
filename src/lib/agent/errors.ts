import { APICallError, NoObjectGeneratedError } from 'ai';
import { CatalogError } from '../catalog';

const retryableTransportCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

function isRetryableTransportFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof TypeError && current.message.trim().toLowerCase() === 'fetch failed') return true;
    const code = 'code' in current ? (current as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && retryableTransportCodes.has(code.toUpperCase())) return true;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

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
  if (NoObjectGeneratedError.isInstance(error)) {
    return new AgentBoundaryError(
      'invalid_tool_output',
      'The model provider returned output that did not match the required schema.',
      false,
    );
  }
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
      status !== undefined && status >= 400 && status < 500
        ? 'The model provider could not accept the request.'
        : 'The model provider request failed.',
      status === undefined || status >= 500,
      error,
    );
  }
  const retryable = isRetryableTransportFailure(error);
  return new AgentBoundaryError(
    'provider_unavailable',
    retryable ? 'The model provider is temporarily unreachable. Try again.' : 'The model provider request failed.',
    retryable,
    error,
  );
}
