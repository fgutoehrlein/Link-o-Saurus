import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, Category, Tag } from '../types';

const mockDb = vi.hoisted(() => ({
  listBookmarks: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('../db', () => ({
  listBookmarks: mockDb.listBookmarks,
  listCategories: mockDb.listCategories,
  listTags: mockDb.listTags,
}));

import { suggestForBookmark } from './bookmark-ai-service';

describe('suggestForBookmark', () => {
  beforeEach(() => {
    mockDb.listBookmarks.mockReset();
    mockDb.listCategories.mockReset();
    mockDb.listTags.mockReset();
  });

  it('prioritizes existing tags and suggests a semantically matching folder', async () => {
    const bookmarks: Bookmark[] = [
      {
        id: 'b1',
        categoryId: 'c-dev',
        url: 'https://github.com/acme/nextjs-starter',
        title: 'Next.js starter repository',
        tags: ['nextjs', 'github', 'frontend'],
        createdAt: 1,
        updatedAt: 1,
        visitCount: 0,
      },
      {
        id: 'b2',
        categoryId: 'c-read',
        url: 'https://medium.com/some-post',
        title: 'Workflow article',
        tags: ['produktivität', 'artikel'],
        createdAt: 1,
        updatedAt: 1,
        visitCount: 0,
      },
    ];

    const categories: Category[] = [
      { id: 'c-dev', boardId: 'b', title: 'Development', sortOrder: 0 },
      { id: 'c-read', boardId: 'b', title: 'Reading', sortOrder: 1 },
    ];

    const tags: Tag[] = [
      { id: 't1', name: 'nextjs', path: 'nextjs', slugParts: ['nextjs'], usageCount: 12 },
      { id: 't2', name: 'github', path: 'github', slugParts: ['github'], usageCount: 10 },
    ];

    mockDb.listBookmarks.mockResolvedValue(bookmarks);
    mockDb.listCategories.mockResolvedValue(categories);
    mockDb.listTags.mockResolvedValue(tags);

    const result = await suggestForBookmark({
      title: 'GitHub repo for Next.js dashboard',
      url: 'https://github.com/company/dashboard',
      metaDescription: 'React and Next.js template repository',
    });

    expect(result.tags.map((tag) => tag.tag)).toEqual(expect.arrayContaining(['nextjs', 'github']));
    expect(result.bestFolder?.category.id).toBe('c-dev');
    expect(result.diagnostics.processingMs).toBeGreaterThanOrEqual(0);
  });
});
