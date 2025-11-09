import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

vi.mock('flexsearch', () => {
  class MockDocument<T extends { id: string; title?: string; url?: string; notes?: string; tags?: string[] }> {
    private store = new Map<string, T>();

    add(doc: T): void {
      this.store.set(doc.id, doc);
    }

    remove(id: string): void {
      this.store.delete(id);
    }

    search(query: string) {
      const lower = query.toLowerCase();
      const matches = Array.from(this.store.values())
        .filter((doc) => {
          const text = `${doc.title ?? ''} ${doc.url ?? ''} ${doc.notes ?? ''} ${(doc.tags ?? []).join(' ')}`.toLowerCase();
          return text.includes(lower);
        })
        .map((doc) => ({ id: [doc.id], doc }));
      return [
        {
          field: 'title',
          result: matches,
        },
      ];
    }
  }

  return {
    Document: MockDocument,
    default: { Document: MockDocument },
  };
});

import type { Bookmark } from './types';
import { query, rebuildIndex } from './search-worker';

describe('search worker performance', () => {
  it('answers warm queries for 10k items within 30ms', async () => {
    const now = Date.now();
    const bookmarks: Bookmark[] = Array.from({ length: 10_000 }, (_, index) => ({
      id: `bookmark-${index}`,
      url: `https://bulk.example/${index}`,
      title: `Bulk Bookmark ${index}`,
      notes: index % 2 === 0 ? 'even note' : 'odd note',
      tags: index % 5 === 0 ? ['bulk', 'even'] : ['bulk'],
      pinned: index % 7 === 0,
      archived: false,
      createdAt: now - index * 1000,
      updatedAt: now - index * 500,
      visitCount: index,
    }));

    await rebuildIndex(bookmarks);

    await query('bulk');

    const start = performance.now();
    const results = await query('bookmark 9999');
    const elapsed = performance.now() - start;

    expect(results.some((hit) => hit.id === 'bookmark-9999')).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(30);
  });
});
