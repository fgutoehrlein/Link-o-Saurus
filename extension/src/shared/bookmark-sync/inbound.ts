import {
  createBoard,
  createBookmark,
  createCategory,
  deleteBoard,
  deleteBookmark,
  deleteCategory,
  updateBookmark,
  listBoards,
  listCategories,
  db,
} from '../db';
import type { Board, Category } from '../types';
import { normalizeUrl } from '../url';
import { guardRun, pendingNativeOps } from './guards';
import { deleteMappingByNativeId, getMappingByNativeId, putMapping } from './store';
import type { Mapping, SyncSettings } from './types';
import { resolveBookmarkConflict } from './conflicts';

type BookmarkTreeNode = chrome.bookmarks.BookmarkTreeNode;

type Placement = {
  boardId: string;
  categoryId?: string;
};

type EventTask = () => Promise<void>;

type ParentLookup = {
  depth: number;
  path: string[];
};

const DEFAULT_BOARD_TITLE = 'Imported';
const DEFAULT_CATEGORY_TITLE = 'Unfiled';
const MAX_QUEUE_LIFETIME_MS = 5 * 60 * 1000;
const RETRY_BASE_DELAY_MS = 200;
const RETRY_MAX_DELAY_MS = 5000;

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const normalizeTitle = (title: string | undefined | null): string => title?.trim() ?? '';
const normalizeKey = (title: string | undefined | null): string => normalizeTitle(title).toLowerCase();

const getBookmarksApi = (): typeof chrome.bookmarks => {
  if (typeof chrome !== 'undefined' && chrome?.bookmarks) {
    return chrome.bookmarks;
  }
  if ((globalThis as typeof globalThis & { browser?: typeof chrome }).browser?.bookmarks) {
    return (globalThis as typeof globalThis & { browser?: typeof chrome }).browser!.bookmarks;
  }
  throw new Error('Bookmarks API not available');
};

const normalizeUrlSafe = (url: string | undefined | null): string | null => {
  if (!url) {
    return null;
  }
  return normalizeUrl(url);
};

const ensureCaches = async (): Promise<{
  boardsByKey: Map<string, Board>;
  categoriesByKey: Map<string, Category>;
}> => {
  const [boards, categories] = await Promise.all([listBoards(), listCategories()]);
  const boardsByKey = new Map<string, Board>();
  boards.forEach((board) => boardsByKey.set(normalizeKey(board.title), board));
  const categoriesByKey = new Map<string, Category>();
  categories.forEach((category) => {
    const key = `${category.boardId}::${normalizeKey(category.title)}`;
    categoriesByKey.set(key, category);
  });
  return { boardsByKey, categoriesByKey };
};

const ensureDefaultBoard = async (
  caches: Awaited<ReturnType<typeof ensureCaches>>,
  now: number,
): Promise<Board> => {
  const key = normalizeKey(DEFAULT_BOARD_TITLE);
  const existing = caches.boardsByKey.get(key);
  if (existing) {
    return existing;
  }
  const board = await createBoard({
    id: createId(),
    title: DEFAULT_BOARD_TITLE,
    icon: undefined,
    sortOrder: caches.boardsByKey.size,
    createdAt: now,
    updatedAt: now,
  });
  caches.boardsByKey.set(key, board);
  return board;
};

const ensureDefaultCategory = async (
  boardId: string,
  caches: Awaited<ReturnType<typeof ensureCaches>>,
): Promise<Category> => {
  const key = `${boardId}::${normalizeKey(DEFAULT_CATEGORY_TITLE)}`;
  const existing = caches.categoriesByKey.get(key);
  if (existing) {
    return existing;
  }
  const category = await createCategory({
    id: createId(),
    boardId,
    title: DEFAULT_CATEGORY_TITLE,
    sortOrder: caches.categoriesByKey.size,
  });
  caches.categoriesByKey.set(key, category);
  return category;
};

const ensureBoard = async (
  title: string | undefined | null,
  caches: Awaited<ReturnType<typeof ensureCaches>>,
  now: number,
): Promise<Board> => {
  const normalizedTitle = normalizeTitle(title) || DEFAULT_BOARD_TITLE;
  const key = normalizeKey(normalizedTitle);
  const existing = caches.boardsByKey.get(key);
  if (existing) {
    return existing;
  }
  const board = await createBoard({
    id: createId(),
    title: normalizedTitle,
    icon: undefined,
    sortOrder: caches.boardsByKey.size,
    createdAt: now,
    updatedAt: now,
  });
  caches.boardsByKey.set(key, board);
  return board;
};

const ensureCategory = async (
  boardId: string,
  title: string | undefined | null,
  caches: Awaited<ReturnType<typeof ensureCaches>>,
): Promise<Category> => {
  const normalizedTitle = normalizeTitle(title) || DEFAULT_CATEGORY_TITLE;
  const key = `${boardId}::${normalizeKey(normalizedTitle)}`;
  const existing = caches.categoriesByKey.get(key);
  if (existing) {
    return existing;
  }
  const category = await createCategory({
    id: createId(),
    boardId,
    title: normalizedTitle,
    sortOrder: caches.categoriesByKey.size,
  });
  caches.categoriesByKey.set(key, category);
  return category;
};

const lookupParentPath = async (parentId: string | undefined): Promise<ParentLookup> => {
  if (!parentId) {
    return { depth: 0, path: [] };
  }
  const api = getBookmarksApi();
  let currentId: string | undefined = parentId;
  const path: string[] = [];
  let depth = 0;
  while (currentId) {
    const [node] = await api.get(currentId);
    if (!node) {
      break;
    }
    if (node.title) {
      path.unshift(node.title);
    }
    depth += 1;
    currentId = node.parentId;
  }
  return { depth, path };
};

const resolvePlacement = async (
  node: BookmarkTreeNode,
  settings: SyncSettings,
  caches: Awaited<ReturnType<typeof ensureCaches>>,
): Promise<Placement> => {
  const now = Date.now();
  const defaultBoard = await ensureDefaultBoard(caches, now);
  const defaultCategory = await ensureDefaultCategory(defaultBoard.id, caches);

  if (!settings.importFolderHierarchy) {
    return { boardId: defaultBoard.id, categoryId: defaultCategory.id };
  }

  const { depth: parentDepth, path: parentPath } = await lookupParentPath(node.parentId);
  const nodeDepth = parentDepth + 1;

  if (!node.url) {
    if (nodeDepth === 2) {
      const board = await ensureBoard(node.title, caches, now);
      return { boardId: board.id, categoryId: undefined };
    }
    if (nodeDepth === 3) {
      const board = await ensureBoard(parentPath[1], caches, now);
      const category = await ensureCategory(board.id, node.title, caches);
      return { boardId: board.id, categoryId: category.id };
    }
  }

  const boardTitle = parentPath[1];
  const categoryTitle = parentPath[2];
  const board = await ensureBoard(boardTitle, caches, now);
  const category = categoryTitle ? await ensureCategory(board.id, categoryTitle, caches) : undefined;
  return { boardId: board.id, categoryId: category?.id ?? defaultCategory.id };
};

const upsertMapping = async (mapping: Mapping): Promise<void> => {
  await putMapping({ ...mapping, lastSyncAt: Date.now() });
};

const findByNormalizedUrl = async (target: string): Promise<import('../types').Bookmark | undefined> => {
  const direct = await db.bookmarks.where('url').equals(target).first();
  if (direct) {
    return direct;
  }
  const all = await db.bookmarks.toArray();
  return all.find((bookmark) => normalizeUrlSafe(bookmark.url) === target);
};

const handleCreated = async (node: BookmarkTreeNode, settings: SyncSettings): Promise<void> => {
  if (pendingNativeOps.has(node.id)) {
    return;
  }
  const caches = await ensureCaches();
  if (!node.url) {
    const { boardId, categoryId } = await resolvePlacement(node, settings, caches);
    const mapping: Mapping = {
      nativeId: node.id,
      nodeType: 'folder',
      boardId,
      categoryId,
      lastSyncAt: Date.now(),
    };
    await upsertMapping(mapping);
    return;
  }

  const placement = await resolvePlacement(node, settings, caches);
  const normalizedUrl = normalizeUrlSafe(node.url);
  const targetUrl = normalizedUrl ?? node.url;
  if (!targetUrl) {
    return;
  }
  const existing = normalizedUrl ? await findByNormalizedUrl(normalizedUrl) : undefined;
  const bookmark =
    existing ??
    (await createBookmark({
      id: createId(),
      url: targetUrl,
      title: normalizeTitle(node.title) || targetUrl,
      notes: undefined,
      categoryId: placement.categoryId,
      tags: [],
      createdAt: node.dateAdded ?? Date.now(),
      updatedAt: Date.now(),
      visitCount: 1,
    }));
  await upsertMapping({
    nativeId: node.id,
    localId: bookmark.id,
    nodeType: 'bookmark',
    boardId: placement.boardId,
    categoryId: placement.categoryId,
    lastSyncAt: Date.now(),
  });
};

const handleChanged = async (
  nativeId: string,
  changeInfo: chrome.bookmarks.BookmarkChangeInfo,
  settings: SyncSettings,
): Promise<void> => {
  if (pendingNativeOps.has(nativeId)) {
    return;
  }
  const mapping = await getMappingByNativeId(nativeId);
  if (!mapping?.localId) {
    return;
  }
  const bookmark = await getBookmark(mapping.localId);
  if (!bookmark) {
    return;
  }
  const api = getBookmarksApi();
  const [node] = await api.get(nativeId);
  const normalizedUrl = normalizeUrlSafe(changeInfo.url ?? bookmark.url) ?? bookmark.url;
  const resolved = resolveBookmarkConflict(
    bookmark,
    { title: changeInfo.title ?? node?.title, url: normalizedUrl, updatedAt: node?.dateGroupModified },
    settings,
  );

  await guardRun(pendingNativeOps, nativeId, () =>
    updateBookmark(mapping.localId!, {
      url: resolved.url,
      title: resolved.title,
      updatedAt: resolved.updatedAt,
    }),
  );
};

const handleRemoved = async (nativeId: string): Promise<void> => {
  if (pendingNativeOps.has(nativeId)) {
    return;
  }
  const mapping = await getMappingByNativeId(nativeId);
  if (!mapping) {
    return;
  }
  if (mapping.nodeType === 'folder') {
    if (mapping.categoryId) {
      await deleteCategory(mapping.categoryId);
    } else if (mapping.boardId) {
      await deleteBoard(mapping.boardId);
    }
  } else if (mapping.localId) {
    await deleteBookmark(mapping.localId);
  }
  await deleteMappingByNativeId(nativeId);
};

const handleMoved = async (nativeId: string, settings: SyncSettings): Promise<void> => {
  if (pendingNativeOps.has(nativeId)) {
    return;
  }
  const api = getBookmarksApi();
  const [node] = await api.get(nativeId);
  if (!node) {
    return;
  }
  const caches = await ensureCaches();
  if (!node.url) {
    const placement = await resolvePlacement(node, settings, caches);
    await upsertMapping({
      nativeId,
      nodeType: 'folder',
      boardId: placement.boardId,
      categoryId: placement.categoryId,
      lastSyncAt: Date.now(),
    });
    return;
  }
  const mapping = await getMappingByNativeId(nativeId);
  if (!mapping?.localId) {
    return;
  }
  const placement = await resolvePlacement(node, settings, caches);
  await guardRun(pendingNativeOps, nativeId, async () => {
    await updateBookmark(mapping.localId!, {
      categoryId: placement.categoryId,
      updatedAt: Date.now(),
    });
  });
  await upsertMapping({
    nativeId,
    localId: mapping.localId,
    nodeType: 'bookmark',
    boardId: placement.boardId,
    categoryId: placement.categoryId,
    lastSyncAt: Date.now(),
  });
};

class EventQueue {
  private queue: { createdAt: number; task: EventTask; attempt: number }[] = [];

  private processing = false;

  enqueue(task: EventTask): void {
    const now = Date.now();
    this.queue.push({ createdAt: now, task, attempt: 0 });
    this.queue = this.queue.filter((entry) => now - entry.createdAt <= MAX_QUEUE_LIFETIME_MS);
    if (!this.processing) {
      void this.process();
    }
  }

  private async process(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) {
        continue;
      }
      const age = Date.now() - entry.createdAt;
      if (age > MAX_QUEUE_LIFETIME_MS) {
        continue;
      }
      try {
        await entry.task();
      } catch (error) {
        console.warn('[Link-o-Saurus] Inbound sync task failed', error);
        entry.attempt += 1;
        const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** entry.attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.queue.push(entry);
      }
    }
    this.processing = false;
  }
}

const queue = new EventQueue();
let listenersRegistered = false;

export const initializeInboundSync = async (settings: SyncSettings): Promise<void> => {
  if (listenersRegistered) {
    return;
  }
  listenersRegistered = true;
  const api = getBookmarksApi();
  api.onCreated.addListener((id, node) => {
    queue.enqueue(() => handleCreated(node, settings));
  });
  api.onChanged.addListener((id, changeInfo) => {
    queue.enqueue(() => handleChanged(id, changeInfo, settings));
  });
  api.onRemoved.addListener((id) => {
    queue.enqueue(() => handleRemoved(id));
  });
  api.onMoved.addListener((id) => {
    queue.enqueue(() => handleMoved(id, settings));
  });
  if (api.onImportBegan && api.onImportEnded) {
    api.onImportBegan.addListener(() => {
      console.log('[Link-o-Saurus] Bookmark import began');
    });
    api.onImportEnded.addListener(() => {
      console.log('[Link-o-Saurus] Bookmark import ended');
    });
  }
};

export const resetInboundListenersForTests = (): void => {
  listenersRegistered = false;
};
