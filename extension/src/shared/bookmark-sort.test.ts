import { describe, expect, it } from 'vitest';

import { sortBookmarks } from './bookmark-sort';
import type { Bookmark } from './types';

const createBookmark = (overrides: Partial<Bookmark>): Bookmark => ({
  id: overrides.id ?? crypto.randomUUID(),
  url: overrides.url ?? 'https://example.com',
  title: overrides.title ?? 'Example',
  tags: overrides.tags ?? [],
  createdAt: overrides.createdAt ?? 1_000,
  updatedAt: overrides.updatedAt ?? 1_000,
  visitCount: overrides.visitCount ?? 0,
  lastVisitedAt: overrides.lastVisitedAt,
  ...overrides,
});

describe('sortBookmarks', () => {
  it('sorts by relevance using frequency and recency', () => {
    const now = 10 * 24 * 60 * 60 * 1000;
    const bookmarks = [
      createBookmark({ id: 'fresh-frequent', visitCount: 8, lastVisitedAt: now - 1 * 60 * 60 * 1000 }),
      createBookmark({ id: 'old-frequent', visitCount: 20, lastVisitedAt: now - 180 * 24 * 60 * 60 * 1000 }),
      createBookmark({ id: 'fresh-rare', visitCount: 1, lastVisitedAt: now - 30 * 60 * 1000 }),
    ];

    const sorted = sortBookmarks(bookmarks, 'relevance', now);
    expect(sorted.map((bookmark) => bookmark.id)).toEqual([
      'fresh-frequent',
      'old-frequent',
      'fresh-rare',
    ]);
  });

  it('sorts alphabetically with natural order', () => {
    const bookmarks = [
      createBookmark({ id: 'c', title: 'Bookmark 10' }),
      createBookmark({ id: 'a', title: 'Bookmark 2' }),
      createBookmark({ id: 'b', title: 'Bookmark 1' }),
    ];

    const sorted = sortBookmarks(bookmarks, 'alphabetical', 0);
    expect(sorted.map((bookmark) => bookmark.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by newest creation time first', () => {
    const bookmarks = [
      createBookmark({ id: 'older', createdAt: 1_000 }),
      createBookmark({ id: 'newer', createdAt: 3_000 }),
      createBookmark({ id: 'middle', createdAt: 2_000 }),
    ];

    const sorted = sortBookmarks(bookmarks, 'newest', 0);
    expect(sorted.map((bookmark) => bookmark.id)).toEqual(['newer', 'middle', 'older']);
  });
});
