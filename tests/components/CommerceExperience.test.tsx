import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommerceExperience } from '../../src/app/components/CommerceExperience';

describe('CommerceExperience runtime surfaces', () => {
  it('does not render demo controls or development diagnostics in production mode', () => {
    const markup = renderToStaticMarkup(
      <CommerceExperience
        providerEnabled={false}
        providerLabel="Model configuration required"
      />,
    );

    expect(markup).not.toContain('>Demo<');
    expect(markup).not.toContain('Request activity');
    expect(markup).not.toContain('aria-label="Execution mode"');
    expect(markup).toContain('Model configuration required');
  });

});
