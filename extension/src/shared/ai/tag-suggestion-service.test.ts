import { describe, expect, it } from 'vitest';
import type { Bookmark, Tag } from '../types';
import { suggestTags } from './tag-suggestion-service';

describe('suggestTags policy', () => {
  it('keeps at most 3 history tags and adds exploratory content-based tags', async () => {
    const existingTags: Tag[] = [
      { id: 't1', name: 'javascript', path: 'javascript', slugParts: ['javascript'], usageCount: 10 },
      { id: 't2', name: 'frontend', path: 'frontend', slugParts: ['frontend'], usageCount: 8 },
      { id: 't3', name: 'tutorial', path: 'tutorial', slugParts: ['tutorial'], usageCount: 8 },
      { id: 't4', name: 'react', path: 'react', slugParts: ['react'], usageCount: 6 },
    ];

    const bookmarks: Bookmark[] = [
      {
        id: 'b1',
        categoryId: 'c1',
        url: 'https://example.dev/react-hooks',
        title: 'React hooks guide',
        tags: ['react', 'frontend', 'tutorial', 'javascript'],
        createdAt: 1,
        updatedAt: 1,
        visitCount: 1,
      },
    ];

    const tags = await suggestTags({
      input: {
        title: 'Practical accessibility checklist for dashboards',
        url: 'https://example.dev/a11y-dashboard-checklist',
        metaDescription: 'A11y and usability checklist for modern design systems',
        selectedText: 'accessibility design systems usability heuristics',
      },
      existingTags,
      bookmarks,
    });

    const historyCount = tags.filter((tag) => tag.source === 'history').length;
    expect(historyCount).toBeLessThanOrEqual(3);
    expect(tags.some((tag) => tag.reasons.includes('content token'))).toBe(true);
  });
});
