import { describe, expect, it } from 'vitest';
import {
  COMMERCE_AGENT_SYSTEM_PROMPT,
  INTENT_EXTRACTION_SYSTEM_PROMPT,
} from '../../src/lib/ai/prompts';

describe('central system prompts', () => {
  it('keeps each actual LLM system prompt named and independently importable', () => {
    expect(INTENT_EXTRACTION_SYSTEM_PROMPT).toContain('Extract one or more shopping intents');
    expect(INTENT_EXTRACTION_SYSTEM_PROMPT).toContain('The catalog contains products only');
    expect(COMMERCE_AGENT_SYSTEM_PROMPT).toContain('Never invent products');
    expect(COMMERCE_AGENT_SYSTEM_PROMPT).not.toBe(INTENT_EXTRACTION_SYSTEM_PROMPT);
  });
});
