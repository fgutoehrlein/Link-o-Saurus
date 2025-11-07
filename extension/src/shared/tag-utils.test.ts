import { describe, expect, it } from 'vitest';

import {
  canonicalizeTagId,
  deriveTagMetadata,
  isAncestorSlug,
  normalizeTagList,
  normalizeTagPath,
} from './tag-utils';

describe('tag utils', () => {
  it('normalizes tag paths and preserves segment casing', () => {
    expect(normalizeTagPath('  Dev  / JS / React  ')).toBe('Dev/JS/React');
    expect(normalizeTagPath('single')).toBe('single');
  });

  it('derives metadata for hierarchical tags', () => {
    const metadata = deriveTagMetadata('Dev/JS/React');
    expect(metadata.canonicalId).toBe('dev/js/react');
    expect(metadata.path).toBe('Dev/JS/React');
    expect(metadata.slugParts).toEqual(['dev', 'js', 'react']);
    expect(metadata.leafName).toBe('React');
  });

  it('normalizes tag lists without duplicates', () => {
    const normalized = normalizeTagList([' Dev/JS ', 'dev/js/react', ' Dev / JS ']);
    expect(normalized).toEqual(['Dev/JS', 'dev/js/react']);
  });

  it('canonicalizes tag ids consistently', () => {
    expect(canonicalizeTagId('Dev/JS/React')).toBe('dev/js/react');
    expect(canonicalizeTagId('')).toBe('');
  });

  it('detects ancestor relationships in canonical slugs', () => {
    expect(isAncestorSlug('dev/js', 'dev/js/react')).toBe(true);
    expect(isAncestorSlug('dev/js', 'dev/python')).toBe(false);
    expect(isAncestorSlug('dev/js/react', 'dev/js/react')).toBe(true);
    expect(isAncestorSlug('', 'dev/js/react')).toBe(true);
  });
});
