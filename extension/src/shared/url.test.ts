import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('normalizes protocol, host, and default ports', () => {
    const normalized = normalizeUrl('HTTP://Example.com:80/path/');
    expect(normalized).toBe('http://example.com/path');
  });

  it('sorts query parameters and removes hash by default', () => {
    const normalized = normalizeUrl('https://example.com/search?q=link&lang=de#section');
    expect(normalized).toBe('https://example.com/search?lang=de&q=link');
  });

  it('returns null for invalid URLs', () => {
    expect(normalizeUrl('not-a-url')).toBeNull();
  });
});
