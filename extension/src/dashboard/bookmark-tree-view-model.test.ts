import { describe, expect, it } from 'vitest';
import type { Bookmark, Board, Category } from '../shared/types';
import { buildBookmarkTreeRows, getExpandedFolderIdsForBookmarks } from './bookmark-tree-view-model';

const board = (id: string, title: string): Board => ({ id, title, sortOrder: 0, createdAt: 0, updatedAt: 0 });
const category = (id: string, boardId: string, title: string): Category => ({ id, boardId, title, sortOrder: 0 });
const bookmark = (id: string, categoryId: string | undefined, title: string, createdAt: number): Bookmark => ({
  id,
  title,
  url: `https://example.com/${id}`,
  tags: [],
  notes: '',
  ...(categoryId ? { categoryId } : {}),
  createdAt,
  updatedAt: createdAt,
  archived: false,
  visitCount: 0,
  lastVisitedAt: createdAt,
});

describe('buildBookmarkTreeRows', () => {
  it('builds and sorts a stable tree representation', () => {
    const boards = [board('b2', 'Zoo'), board('b1', 'Alpha')];
    const categories = [category('c2', 'b1', 'Zeta'), category('c1', 'b1', 'Beta')];
    const bookmarks = [bookmark('m2', 'c1', 'Read', 2), bookmark('m1', 'c1', 'Read', 1), bookmark('m3', 'c2', 'Alpha', 3)];

    const rows = buildBookmarkTreeRows({
      bookmarksById: new Map(bookmarks.map((item) => [item.id, item] as const)),
      filteredBookmarkIds: bookmarks.map((item) => item.id),
      boards,
      categories,
      expandedFolderIds: new Set(['category:c1', 'category:c2']),
    });

    expect(rows.map((row) => row.id)).toEqual([
      'board:b1',
      'category:c1',
      'bookmark:m1',
      'bookmark:m2',
      'category:c2',
      'bookmark:m3',
      'board:b2',
    ]);

    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ['board:b1', 0],
      ['category:c1', 1],
      ['bookmark:m1', 2],
      ['bookmark:m2', 2],
      ['category:c2', 1],
      ['bookmark:m3', 2],
      ['board:b2', 0],
    ]);

    expect(rows.filter((row) => row.kind === 'folder').map((row) => [row.id, row.childCount])).toEqual([
      ['board:b1', 3],
      ['category:c1', 2],
      ['category:c2', 1],
      ['board:b2', 0],
    ]);
  });

  it('flattens according to expand/collapse state', () => {
    const rows = buildBookmarkTreeRows({
      bookmarksById: new Map([
        ['m1', bookmark('m1', 'c1', 'One', 1)],
        ['m2', bookmark('m2', 'c1', 'Two', 2)],
      ]),
      filteredBookmarkIds: ['m1', 'm2'],
      boards: [board('b1', 'Main')],
      categories: [category('c1', 'b1', 'Saved')],
      expandedFolderIds: new Set(),
    });

    expect(rows.map((row) => row.id)).toEqual(['board:b1', 'category:c1']);
  });

  it('returns only parent folders for filtered bookmark matches', () => {
    const bookmarks = [
      bookmark('match-1', 'c1', 'One', 1),
      bookmark('match-2', 'c2', 'Two', 2),
      bookmark('hidden', 'c3', 'Three', 3),
      bookmark('orphan', 'missing', 'Four', 4),
    ];

    const expanded = getExpandedFolderIdsForBookmarks({
      bookmarksById: new Map(bookmarks.map((item) => [item.id, item] as const)),
      bookmarkIds: ['match-1', 'match-2', 'orphan'],
      categories: [
        category('c1', 'b1', 'Inbox'),
        category('c2', 'b1', 'Work'),
        category('c3', 'b1', 'Later'),
      ],
    });

    expect(Array.from(expanded).sort()).toEqual(['category:c1', 'category:c2']);
  });

  it('ignores malformed parent references and missing categories', () => {
    const valid = bookmark('ok', 'c1', 'Ok', 1);
    const missingCategory = bookmark('missing-cat', 'does-not-exist', 'Bad', 2);
    const nullCategory = bookmark('null-cat', undefined, 'Bad2', 3);

    const rows = buildBookmarkTreeRows({
      bookmarksById: new Map([
        ['ok', valid],
        ['missing-cat', missingCategory],
        ['null-cat', nullCategory],
      ]),
      filteredBookmarkIds: ['ok', 'missing-cat', 'null-cat'],
      boards: [board('b1', 'Main')],
      categories: [category('c1', 'b1', 'Inbox'), category('orphan', 'missing-board', 'Ghost')],
      expandedFolderIds: new Set(['category:c1']),
    });

    expect(rows.map((row) => row.id)).toEqual(['board:b1', 'category:c1', 'bookmark:ok']);
  });
});
