import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_TAG_FILTER_STATE,
  applyNegativeTagContextAction,
  getTagFilterMode,
  matchesTagFilter,
  normalizeTagFilterState,
  parseTagFilterFromParams,
  toggleTagFilter,
  writeTagFilterToParams,
} from './tag-filter';

describe('tag filter state toggling', () => {
  it('toggles between inactive, include and exclude states', () => {
    const tag = 'Video';

    const include = toggleTagFilter(EMPTY_TAG_FILTER_STATE, tag, 'include');
    expect(getTagFilterMode(include, tag)).toBe('include');

    const inactiveFromInclude = toggleTagFilter(include, tag, 'include');
    expect(getTagFilterMode(inactiveFromInclude, tag)).toBeNull();

    const exclude = toggleTagFilter(EMPTY_TAG_FILTER_STATE, tag, 'exclude');
    expect(getTagFilterMode(exclude, tag)).toBe('exclude');

    const inactiveFromExclude = toggleTagFilter(exclude, tag, 'exclude');
    expect(getTagFilterMode(inactiveFromExclude, tag)).toBeNull();
  });

  it('switches directly between include and exclude', () => {
    const tag = 'Auto';
    const include = toggleTagFilter(EMPTY_TAG_FILTER_STATE, tag, 'include');
    const exclude = toggleTagFilter(include, tag, 'exclude');
    expect(getTagFilterMode(exclude, tag)).toBe('exclude');
    expect(exclude.include).toHaveLength(0);
    expect(exclude.exclude).toEqual(['auto']);

    const backToInclude = toggleTagFilter(exclude, tag, 'include');
    expect(getTagFilterMode(backToInclude, tag)).toBe('include');
    expect(backToInclude.exclude).toHaveLength(0);
    expect(backToInclude.include).toEqual(['auto']);
  });
});

describe('tag filter matching', () => {
  it('requires all include tags and rejects excluded tags', () => {
    const filter = normalizeTagFilterState({
      include: ['Video', 'dev/js'],
      exclude: ['Auto'],
    });

    expect(matchesTagFilter(['Video', 'dev/js/react'], filter)).toBe(true);
    expect(matchesTagFilter(['Video', 'Auto'], filter)).toBe(false);
    expect(matchesTagFilter(['Video'], filter)).toBe(false);
    expect(matchesTagFilter(['dev/js/react'], filter)).toBe(false);
  });

  it('supports mixed filters with hierarchical exclusions', () => {
    const filter = normalizeTagFilterState({
      include: ['dev'],
      exclude: ['dev/js/vue'],
    });

    expect(matchesTagFilter(['dev/js/react'], filter)).toBe(true);
    expect(matchesTagFilter(['dev/js/vue/components'], filter)).toBe(false);
    expect(matchesTagFilter(['design'], filter)).toBe(false);
  });
});

describe('tag filter URL state', () => {
  it('restores include and exclude filters from query params', () => {
    const params = new URLSearchParams('includeTags=Video,Dev&excludeTags=Auto&tag=Legacy');
    const state = parseTagFilterFromParams(params);
    expect(state.include.sort()).toEqual(['dev', 'legacy', 'video']);
    expect(state.exclude).toEqual(['auto']);
  });

  it('serializes filters back into query params', () => {
    const params = new URLSearchParams();
    writeTagFilterToParams(
      params,
      normalizeTagFilterState({
        include: ['Video', 'Dev'],
        exclude: ['Auto'],
      }),
    );
    expect(params.get('includeTags')).toBe('video,dev');
    expect(params.get('excludeTags')).toBe('auto');
  });
});

describe('tag filter context menu handling', () => {
  it('prevents the browser context menu and applies negative tag action', () => {
    const preventDefault = vi.fn();
    const apply = vi.fn();
    applyNegativeTagContextAction({ preventDefault }, apply);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });
});
