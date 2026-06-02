import type { Bookmark, Board, Category } from '../shared/types';
import type { VisibleRow } from './types';

export type BuildBookmarkTreeRowsInput = {
  readonly bookmarksById: ReadonlyMap<string, Bookmark>;
  readonly filteredBookmarkIds: readonly string[];
  readonly boards: readonly Board[];
  readonly categories: readonly Category[];
  readonly expandedFolderIds: ReadonlySet<string>;
};

export type GetExpandedFolderIdsForBookmarksInput = {
  readonly bookmarksById: ReadonlyMap<string, Bookmark>;
  readonly bookmarkIds: readonly string[];
  readonly categories: readonly Category[];
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const normalizeName = (value: string | undefined): string => value?.trim().toLocaleLowerCase() ?? '';

const compareStrings = (left: string, right: string): number => collator.compare(left, right);

const compareFolders = (left: { title?: string; id: string }, right: { title?: string; id: string }): number =>
  compareStrings(normalizeName(left.title), normalizeName(right.title)) || left.id.localeCompare(right.id);

const compareBookmarks = (left: Bookmark, right: Bookmark): number =>
  compareStrings(normalizeName(left.title) || normalizeName(left.url), normalizeName(right.title) || normalizeName(right.url)) ||
  left.createdAt - right.createdAt ||
  left.id.localeCompare(right.id);

const getBoardBookmarkCount = (boardNode: { readonly categories: ReadonlyArray<{ readonly bookmarks: readonly Bookmark[] }> }): number =>
  boardNode.categories.reduce((total, categoryNode) => total + categoryNode.bookmarks.length, 0);

export const getExpandedFolderIdsForBookmarks = ({
  bookmarksById,
  bookmarkIds,
  categories,
}: GetExpandedFolderIdsForBookmarksInput): ReadonlySet<string> => {
  const knownCategoryIds = new Set(categories.map((category) => category.id));
  const folderIds = new Set<string>();

  for (const bookmarkId of bookmarkIds) {
    const categoryId = bookmarksById.get(bookmarkId)?.categoryId;
    if (categoryId && knownCategoryIds.has(categoryId)) {
      folderIds.add(`category:${categoryId}`);
    }
  }

  return folderIds;
};

/**
 * Invariants for robust import and mixed data quality:
 * - Root consists of all known boards. Missing references never create synthetic root cycles.
 * - Category nodes are attached to a board only if that board exists.
 * - Bookmarks with missing/malformed parent references (missing category or missing board) are skipped.
 * - The shape is acyclic because parent links are materialized once into fixed depth levels (board -> category -> bookmark).
 */
export const buildBookmarkTreeRows = ({
  bookmarksById,
  filteredBookmarkIds,
  boards,
  categories,
  expandedFolderIds,
}: BuildBookmarkTreeRowsInput): readonly VisibleRow[] => {
  const rootBoards = [...boards].sort(compareFolders).map((board) => ({
    id: `board:${board.id}`,
    board,
    categories: [] as Array<{ id: string; category: Category; bookmarks: Bookmark[] }>,
  }));

  const boardById = new Map(rootBoards.map((item) => [item.board.id, item] as const));
  const categoryById = new Map<string, { id: string; category: Category; bookmarks: Bookmark[] }>();

  for (const category of categories) {
    const boardNode = boardById.get(category.boardId);
    if (!boardNode) continue;
    const categoryNode = { id: `category:${category.id}`, category, bookmarks: [] as Bookmark[] };
    boardNode.categories.push(categoryNode);
    categoryById.set(category.id, categoryNode);
  }

  for (const bookmarkId of filteredBookmarkIds) {
    const bookmark = bookmarksById.get(bookmarkId);
    if (!bookmark?.categoryId) continue;
    const categoryNode = categoryById.get(bookmark.categoryId);
    if (!categoryNode) continue;
    categoryNode.bookmarks.push(bookmark);
  }

  for (const boardNode of rootBoards) {
    boardNode.categories.sort((left, right) => compareFolders(left.category, right.category));
    for (const categoryNode of boardNode.categories) {
      categoryNode.bookmarks.sort(compareBookmarks);
    }
  }

  const rows: VisibleRow[] = [];

  for (const boardNode of rootBoards) {
    const boardExpanded = true;
    rows.push({
      kind: 'folder',
      id: boardNode.id,
      title: boardNode.board.title,
      depth: 0,
      hasChildren: boardNode.categories.length > 0,
      expanded: boardExpanded,
      childCount: getBoardBookmarkCount(boardNode),
    });

    if (!boardExpanded) continue;

    for (const categoryNode of boardNode.categories) {
      const categoryExpanded = expandedFolderIds.has(categoryNode.id);
      rows.push({
        kind: 'folder',
        id: categoryNode.id,
        title: categoryNode.category.title,
        depth: 1,
        hasChildren: categoryNode.bookmarks.length > 0,
        expanded: categoryExpanded,
        childCount: categoryNode.bookmarks.length,
      });

      if (!categoryExpanded) continue;

      for (const bookmark of categoryNode.bookmarks) {
        rows.push({ kind: 'bookmark', id: `bookmark:${bookmark.id}`, bookmarkId: bookmark.id, depth: 2 });
      }
    }
  }

  return rows;
};
