import { describe, expect, it } from 'vitest';

import { renderMarkdownToSafeHtml } from './markdown';

describe('renderMarkdownToSafeHtml', () => {
  it('sanitizes disallowed content and preserves formatting', () => {
    const output = renderMarkdownToSafeHtml(
      '# Hello <script>alert(1)</script>\n\n[Click me](javascript:alert(1))',
    );

    expect(output).toContain('<h1>');
    expect(output).not.toContain('<script>');
    expect(output).not.toContain('javascript:alert');
  });

  it('highlights local mentions', () => {
    const output = renderMarkdownToSafeHtml('Thanks @Alice for the update.');
    expect(output).toContain('<span class="mention"');
    expect(output).toContain('data-mention="Alice"');
  });
});
