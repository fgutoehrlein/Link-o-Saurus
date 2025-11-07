import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('flexsearch', () => {
  class MockDocument<T> {
    add(_doc: T): void {}
    remove(_id: string): void {}
    search(): unknown[] {
      return [];
    }
  }

  return {
    Document: MockDocument,
  };
});

import type { Bookmark } from './types';
import { query, rebuildIndex, updateDoc } from './search-worker';

const createBookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
  id: 'bookmark-1',
  url: 'https://example.com',
  title: 'Example bookmark',
  notes: '',
  tags: [],
  pinned: false,
  archived: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  visitCount: 0,
  ...overrides,
});

describe('search worker tag filtering', () => {
  beforeEach(async () => {
    await rebuildIndex([]);
  });

  it('returns only bookmarks that match all requested tags', async () => {
    await rebuildIndex([
      createBookmark({ id: 'a', title: 'Design systems', tags: ['Design', 'UI'] }),
      createBookmark({ id: 'b', title: 'Design tokens', tags: ['Design'] }),
      createBookmark({ id: 'c', title: 'Reading list', tags: ['Reading'] }),
    ]);

    const designHits = await query('', { tags: ['Design'] });
    expect(designHits).toHaveLength(2);
    expect(designHits.every((hit) => hit.bookmark.tags.includes('Design'))).toBe(true);

    const combinedHits = await query('', { tags: ['Design', 'UI'] });
    expect(combinedHits).toHaveLength(1);
    expect(combinedHits[0]?.id).toBe('a');

    const unmatchedHits = await query('', { tags: ['Nonexistent'] });
    expect(unmatchedHits).toHaveLength(0);
  });

  it('matches hierarchical tag prefixes', async () => {
    await rebuildIndex([
      createBookmark({ id: 'd1', title: 'React patterns', tags: ['dev/js/react'] }),
      createBookmark({ id: 'd2', title: 'Vue recipes', tags: ['dev/js/vue'] }),
      createBookmark({ id: 'd3', title: 'Python tips', tags: ['dev/python'] }),
    ]);

    const jsHits = await query('', { tags: ['dev/js'] });
    expect(jsHits.map((hit) => hit.id).sort()).toEqual(['d1', 'd2']);

    const reactHits = await query('', { tags: ['dev/js/react'] });
    expect(reactHits.map((hit) => hit.id)).toEqual(['d1']);
  });

  it('updates tag indexes when a bookmark document changes', async () => {
    await rebuildIndex([
      createBookmark({ id: 'd', title: 'UX research', tags: ['Design'] }),
    ]);

    await updateDoc(createBookmark({ id: 'd', title: 'UX research', tags: ['UX'] }));

    const uxHits = await query('', { tags: ['UX'] });
    expect(uxHits).toHaveLength(1);
    expect(uxHits[0]?.id).toBe('d');

    const designHits = await query('', { tags: ['Design'] });
    expect(designHits).toHaveLength(0);
  });
});
