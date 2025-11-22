import { createBookmark, createBoard, createCategory, db, LinkOSaurusDB } from '../db';
import { normalizeUrl } from '../url';
import { ensureMirrorRoot, getTree } from './native';
import { putMapping } from './store';
import type { Mapping, NativeId } from './types';

const BATCH_SIZE = 500;
const DEFAULT_BOARD_TITLE = 'Imported';
const DEFAULT_CATEGORY_TITLE = 'Unfiled';
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

export let mirrorRootId: NativeId | null = null;

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const normalizeTitle = (title: string | undefined | null): string => title?.trim() ?? '';
const normalizeKey = (title: string | undefined | null): string => normalizeTitle(title).toLowerCase();

const canonicalizeBookmarkUrl = (url: string | undefined | null): string | null => {
  if (!url) {
    return null;
  }
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return null;
  }
  const parsed = new URL(normalized);
  for (const key of Array.from(parsed.searchParams.keys())) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
      parsed.searchParams.delete(key);
    }
  }
  return normalizeUrl(parsed.toString());
};

const yieldToEventLoop = async (processed: number): Promise<void> => {
  if (processed > 0 && processed % BATCH_SIZE === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};

type InitialImportOptions = {
  readonly importFolderHierarchy?: boolean;
  readonly database?: LinkOSaurusDB;
};

type TraversalState = {
  readonly node: chrome.bookmarks.BookmarkTreeNode;
  readonly depth: number;
  readonly path: string[];
  readonly boardId?: string;
  readonly categoryId?: string;
};

type SortCounters = {
  board: number;
  categories: Map<string, number>;
};

const collectExistingBookmarks = async (database: LinkOSaurusDB): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  await database.bookmarks.each((bookmark) => {
    const canonical = canonicalizeBookmarkUrl(bookmark.url);
    if (canonical) {
      map.set(canonical, bookmark.id);
    }
  });
  return map;
};

const initializeCaches = async (
  database: LinkOSaurusDB,
  now: number,
): Promise<{
  boardsByKey: Map<string, import('../types').Board>;
  categoriesByKey: Map<string, import('../types').Category>;
  counters: SortCounters;
  defaultBoard: import('../types').Board;
  defaultCategory: import('../types').Category;
}> => {
  const boards = await database.boards.toArray();
  const categories = await database.categories.toArray();

  const boardSortStart = boards.reduce((max, board) => Math.max(max, board.sortOrder), -1) + 1;
  const categoryCounters = new Map<string, number>();
  for (const category of categories) {
    const current = categoryCounters.get(category.boardId) ?? -1;
    categoryCounters.set(category.boardId, Math.max(current, category.sortOrder));
  }

  const boardsByKey = new Map<string, import('../types').Board>();
  boards.forEach((board) => boardsByKey.set(normalizeKey(board.title), board));

  const categoriesByKey = new Map<string, import('../types').Category>();
  categories.forEach((category) => {
    const key = `${category.boardId}::${normalizeKey(category.title)}`;
    categoriesByKey.set(key, category);
  });

  const counters: SortCounters = { board: boardSortStart, categories: categoryCounters };

  const defaultBoard =
    boardsByKey.get(normalizeKey(DEFAULT_BOARD_TITLE)) ??
    (await createBoard(
      {
        id: createId(),
        title: DEFAULT_BOARD_TITLE,
        icon: undefined,
        sortOrder: counters.board++,
        createdAt: now,
        updatedAt: now,
      },
      database,
    ));
  boardsByKey.set(normalizeKey(defaultBoard.title), defaultBoard);

  const defaultCategoryKey = `${defaultBoard.id}::${normalizeKey(DEFAULT_CATEGORY_TITLE)}`;
  let defaultCategory = categoriesByKey.get(defaultCategoryKey);
  if (!defaultCategory) {
    const categorySort = (counters.categories.get(defaultBoard.id) ?? -1) + 1;
    defaultCategory = await createCategory(
      {
        id: createId(),
        boardId: defaultBoard.id,
        title: DEFAULT_CATEGORY_TITLE,
        sortOrder: categorySort,
      },
      database,
    );
    counters.categories.set(defaultBoard.id, categorySort);
    categoriesByKey.set(defaultCategoryKey, defaultCategory);
  }

  return { boardsByKey, categoriesByKey, counters, defaultBoard, defaultCategory };
};

const ensureBoard = async (
  title: string,
  now: number,
  boardsByKey: Map<string, import('../types').Board>,
  counters: SortCounters,
  database: LinkOSaurusDB,
): Promise<import('../types').Board> => {
  const normalizedKey = normalizeKey(title || DEFAULT_BOARD_TITLE);
  const cached = boardsByKey.get(normalizedKey);
  if (cached) {
    return cached;
  }
  const board = await createBoard(
    {
      id: createId(),
      title: normalizeTitle(title) || DEFAULT_BOARD_TITLE,
      icon: undefined,
      sortOrder: counters.board++,
      createdAt: now,
      updatedAt: now,
    },
    database,
  );
  boardsByKey.set(normalizedKey, board);
  return board;
};

const ensureCategory = async (
  boardId: string,
  title: string,
  categoriesByKey: Map<string, import('../types').Category>,
  counters: SortCounters,
  database: LinkOSaurusDB,
): Promise<import('../types').Category> => {
  const normalizedTitle = normalizeTitle(title) || DEFAULT_CATEGORY_TITLE;
  const key = `${boardId}::${normalizeKey(normalizedTitle)}`;
  const cached = categoriesByKey.get(key);
  if (cached) {
    return cached;
  }
  const nextSort = (counters.categories.get(boardId) ?? -1) + 1;
  const category = await createCategory(
    {
      id: createId(),
      boardId,
      title: normalizedTitle,
      sortOrder: nextSort,
    },
    database,
  );
  counters.categories.set(boardId, nextSort);
  categoriesByKey.set(key, category);
  return category;
};

export const initialImport = async (
  { importFolderHierarchy = true, database }: InitialImportOptions = {},
): Promise<void> => {
  const dbInstance = database ?? db;
  const now = Date.now();

  mirrorRootId = await ensureMirrorRoot('Link-O-Saurus');
  const tree = await getTree();

  const { boardsByKey, categoriesByKey, counters, defaultBoard, defaultCategory } = await initializeCaches(
    dbInstance,
    now,
  );

  const existingByCanonical = await collectExistingBookmarks(dbInstance);

  const stack: TraversalState[] = tree.map((node) => ({
    node,
    depth: 0,
    path: node.title ? [node.title] : [],
    boardId: undefined,
    categoryId: undefined,
  }));

  let processed = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    const { node } = current;
    processed += 1;
    await yieldToEventLoop(processed);

    if (!node.url) {
      let folderBoardId = current.boardId;
      let folderCategoryId = current.categoryId;

      if (importFolderHierarchy) {
        if (current.depth === 1) {
          const board = await ensureBoard(node.title, now, boardsByKey, counters, dbInstance);
          folderBoardId = board.id;
          folderCategoryId = undefined;
        } else if (current.depth === 2) {
          const targetBoardId = folderBoardId ?? defaultBoard.id;
          const category = await ensureCategory(
            targetBoardId,
            node.title,
            categoriesByKey,
            counters,
            dbInstance,
          );
          folderBoardId = targetBoardId;
          folderCategoryId = category.id;
        }
      }

      const mapping: Mapping = {
        nativeId: node.id,
        localId: undefined,
        nodeType: 'folder',
        boardId: folderBoardId,
        categoryId: folderCategoryId,
        lastSyncAt: now,
      };
      await putMapping(mapping, dbInstance);

      if (node.children?.length) {
        for (let i = node.children.length - 1; i >= 0; i -= 1) {
          const child = node.children[i]!;
          stack.push({
            node: child,
            depth: current.depth + 1,
            path: child.title ? [...current.path, child.title] : [...current.path],
            boardId: folderBoardId,
            categoryId: folderCategoryId,
          });
        }
      }
      continue;
    }

    const canonicalUrl = canonicalizeBookmarkUrl(node.url);
    const effectiveBoardId = importFolderHierarchy
      ? current.boardId ?? defaultBoard.id
      : defaultBoard.id;
    const effectiveCategoryId = importFolderHierarchy
      ? current.categoryId ?? (effectiveBoardId === defaultBoard.id ? defaultCategory.id : undefined)
      : defaultCategory.id;

    const needsFlattenNote = importFolderHierarchy && current.depth > 2;
    const notePath = current.path.join(' / ');
    const note = needsFlattenNote && notePath ? `Imported from path: ${notePath}` : undefined;

    const targetUrl = canonicalUrl ?? node.url;
    if (!targetUrl) {
      continue;
    }

    const existingId = canonicalUrl ? existingByCanonical.get(canonicalUrl) : undefined;
    const localId = existingId ?? createId();

    if (!existingId) {
      await createBookmark(
        {
          id: localId,
          url: targetUrl,
          title: normalizeTitle(node.title) || targetUrl,
          notes: note,
          categoryId: effectiveCategoryId,
          tags: [],
          createdAt: node.dateAdded ?? now,
          updatedAt: now,
          visitCount: 1,
        },
        dbInstance,
      );
      if (canonicalUrl) {
        existingByCanonical.set(canonicalUrl, localId);
      }
    }

    const mapping: Mapping = {
      nativeId: node.id,
      localId,
      nodeType: 'bookmark',
      boardId: effectiveBoardId,
      categoryId: effectiveCategoryId,
      lastSyncAt: now,
    };
    await putMapping(mapping, dbInstance);
  }
};

export const resetMirrorRootIdForTests = (): void => {
  mirrorRootId = null;
};
