import { createNativeBookmark, ensureMirrorRoot, moveNativeNode, removeNativeNode, updateNativeBookmark } from './native';
import { pendingNativeOps } from './guards';
import type { NativeId, SyncSettings } from './types';
import type { Bookmark, Board, Category } from '../types';
import type { LinkOSaurusDB } from '../db';

type BookmarkContext = {
  readonly bookmark: Bookmark;
  readonly category?: Category | null;
  readonly board?: Board | null;
  readonly previousCategory?: Category | null;
  readonly previousBoard?: Board | null;
  readonly database: LinkOSaurusDB;
  readonly settings: SyncSettings;
};

type OutboundTask =
  | { type: 'create'; payload: BookmarkContext }
  | { type: 'update'; payload: BookmarkContext }
  | { type: 'delete'; payload: BookmarkContext };

let mirrorRootId: NativeId | null = null;

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 75;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ensureMirrorRootId = async (settings: SyncSettings): Promise<NativeId> => {
  if (mirrorRootId) {
    return mirrorRootId;
  }
  mirrorRootId = await ensureMirrorRoot(settings.mirrorRootName);
  return mirrorRootId;
};

const saveMapping = async (context: BookmarkContext, nativeId: string): Promise<void> => {
  const { database, bookmark, category, board } = context;
  await database.bookmarkMappings.put({
    nativeId,
    localId: bookmark.id,
    nodeType: 'bookmark',
    boardId: board?.id,
    categoryId: category?.id,
    lastSyncAt: Date.now(),
  });
};

const saveFolderMapping = async (
  database: LinkOSaurusDB,
  nativeId: string,
  board?: Board | null,
  category?: Category | null,
): Promise<void> => {
  await database.bookmarkMappings.put({
    nativeId,
    nodeType: 'folder',
    boardId: board?.id,
    categoryId: category?.id,
    lastSyncAt: Date.now(),
  });
};

const findFolderMapping = async (
  database: LinkOSaurusDB,
  predicate: (mapping: import('./types').Mapping) => boolean,
): Promise<import('./types').Mapping | undefined> => {
  const folders = await database.bookmarkMappings.where('nodeType').equals('folder').toArray();
  return folders.find(predicate);
};

const ensureBoardFolder = async (
  database: LinkOSaurusDB,
  board: Board | null | undefined,
  rootId: NativeId,
): Promise<NativeId> => {
  if (!board) {
    return rootId;
  }

  const existing = await findFolderMapping(database, (mapping) => mapping.boardId === board.id);
  if (existing) {
    return existing.nativeId;
  }

  pendingNativeOps.add(`create-folder-${board.id}`);
  try {
    const created = await createNativeBookmark({ parentId: rootId, title: board.title });
    pendingNativeOps.add(created.id);
    await saveFolderMapping(database, created.id, board, null);
    return created.id;
  } finally {
    pendingNativeOps.delete(`create-folder-${board.id}`);
  }
};

const ensureCategoryFolder = async (
  database: LinkOSaurusDB,
  board: Board | null | undefined,
  category: Category | null | undefined,
  rootId: NativeId,
): Promise<NativeId> => {
  if (!category) {
    return ensureBoardFolder(database, board, rootId);
  }

  const existing = await findFolderMapping(database, (mapping) => mapping.categoryId === category.id);
  if (existing) {
    return existing.nativeId;
  }

  const boardFolderId = await ensureBoardFolder(database, board, rootId);
  pendingNativeOps.add(`create-folder-${category.id}`);
  try {
    const created = await createNativeBookmark({ parentId: boardFolderId, title: category.title });
    pendingNativeOps.add(created.id);
    await saveFolderMapping(database, created.id, board, category);
    return created.id;
  } finally {
    pendingNativeOps.delete(`create-folder-${category.id}`);
  }
};

const ensureBookmarkParent = async (context: BookmarkContext, rootId: NativeId): Promise<NativeId> => {
  const { database, board, category } = context;
  if (category) {
    return ensureCategoryFolder(database, board ?? null, category, rootId);
  }
  if (board) {
    return ensureBoardFolder(database, board, rootId);
  }
  return rootId;
};

const withPendingNative = async <T>(nativeId: string, fn: () => Promise<T>): Promise<T> => {
  pendingNativeOps.add(nativeId);
  try {
    return await fn();
  } finally {
    pendingNativeOps.delete(nativeId);
  }
};

const fetchBookmarkMapping = async (
  database: LinkOSaurusDB,
  bookmarkId: string,
): Promise<import('./types').Mapping | undefined> => {
  return database.bookmarkMappings.where('localId').equals(bookmarkId).first();
};

const handleCreate = async (context: BookmarkContext): Promise<void> => {
  const rootId = await ensureMirrorRootId(context.settings);
  const parentId = await ensureBookmarkParent(context, rootId);

  const created = await createNativeBookmark({
    parentId,
    title: context.bookmark.title,
    url: context.bookmark.url,
  });
  pendingNativeOps.add(created.id);
  await saveMapping(context, created.id);
  pendingNativeOps.delete(created.id);
};

const handleUpdate = async (context: BookmarkContext): Promise<void> => {
  const mapping = await fetchBookmarkMapping(context.database, context.bookmark.id);
  if (!mapping) {
    await handleCreate(context);
    return;
  }

  const rootId = await ensureMirrorRootId(context.settings);
  const nextParentId = await ensureBookmarkParent(context, rootId);

  if (mapping.categoryId !== context.bookmark.categoryId || mapping.boardId !== context.board?.id) {
    await withPendingNative(mapping.nativeId, () => moveNativeNode(mapping.nativeId, { parentId: nextParentId }));
  }

  await withPendingNative(mapping.nativeId, () =>
    updateNativeBookmark(mapping.nativeId, {
      title: context.bookmark.title,
      url: context.bookmark.url,
    }),
  );

  await saveMapping(context, mapping.nativeId);
};

const handleDelete = async (context: BookmarkContext): Promise<void> => {
  const mapping = await fetchBookmarkMapping(context.database, context.bookmark.id);
  if (!mapping) {
    return;
  }

  if (context.settings.deleteBehavior === 'delete') {
    await withPendingNative(mapping.nativeId, () => removeNativeNode(mapping.nativeId));
  }
  await context.database.bookmarkMappings.delete(mapping.nativeId);
};

const processTask = async (task: OutboundTask): Promise<void> => {
  const { payload } = task;
  if (!payload.settings.enableBidirectional) {
    return;
  }

  try {
    if (task.type === 'create') {
      await handleCreate(payload);
    } else if (task.type === 'update') {
      await handleUpdate(payload);
    } else if (task.type === 'delete') {
      await handleDelete(payload);
    }
  } catch (error) {
    console.error('Outbound bookmark sync failed', error);
  }
};

const queue: OutboundTask[] = [];
let processing = false;

const runQueue = async (): Promise<void> => {
  if (processing) {
    return;
  }
  processing = true;
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH_SIZE);
      for (const task of batch) {
        await processTask(task);
      }
      if (queue.length > 0) {
        await delay(BATCH_DELAY_MS);
      }
    }
  } finally {
    processing = false;
  }
};

const enqueue = (task: OutboundTask): void => {
  queue.push(task);
  void runQueue();
};

export const enqueueBookmarkCreate = (payload: BookmarkContext): void => enqueue({ type: 'create', payload });

export const enqueueBookmarkUpdate = (payload: BookmarkContext): void => enqueue({ type: 'update', payload });

export const enqueueBookmarkDelete = (payload: BookmarkContext): void => enqueue({ type: 'delete', payload });
