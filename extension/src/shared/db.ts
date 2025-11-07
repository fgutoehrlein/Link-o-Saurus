import Dexie, { Table } from 'dexie';
import type { Board, Bookmark, Category, SessionPack, UserSettings } from './types';

export const DB_NAME = 'link-o-saurus';
export const USER_SETTINGS_KEY = 'user-settings';
export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  newTabEnabled: false,
  hotkeys: {},
};

export interface FaviconCache {
  readonly limit: number;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  touch(key: string): Promise<void>;
  prune(): Promise<void>;
}

type UserSettingsRecord = UserSettings & { id: typeof USER_SETTINGS_KEY };

export type CreateBoardInput = Omit<Board, 'createdAt' | 'updatedAt'> & {
  createdAt?: number;
  updatedAt?: number;
};

export type UpdateBoardInput = Partial<Omit<Board, 'id' | 'createdAt'>> & {
  updatedAt?: number;
};

export type CreateCategoryInput = Category;

export type UpdateCategoryInput = Partial<Omit<Category, 'id' | 'boardId'>>;

export type CreateBookmarkInput = Omit<Bookmark, 'createdAt' | 'updatedAt' | 'visitCount' | 'tags'> & {
  createdAt?: number;
  updatedAt?: number;
  visitCount?: number;
  tags?: string[];
  archived?: boolean;
  pinned?: boolean;
};

export type UpdateBookmarkInput = Partial<Omit<Bookmark, 'id' | 'createdAt'>> & {
  updatedAt?: number;
};

export type CreateSessionInput = SessionPack;

export type UpdateSessionInput = Partial<Omit<SessionPack, 'id' | 'tabs'>> & {
  tabs?: SessionPack['tabs'];
};

type BookmarkInput = CreateBookmarkInput;

const BOOKMARK_DEFAULTS = {
  archived: false,
  pinned: false,
  tags: [] as string[],
};

const ensureTimestamp = (value: number | undefined): number => value ?? Date.now();

export class LinkOSaurusDB extends Dexie {
  boards!: Table<Board, string>;
  categories!: Table<Category, string>;
  bookmarks!: Table<Bookmark, string>;
  sessions!: Table<SessionPack, string>;
  userSettings!: Table<UserSettingsRecord, string>;

  constructor(name: string = DB_NAME) {
    super(name);

    this.version(1).stores({
      boards: 'id, sortOrder, updatedAt',
      categories: 'id, boardId, sortOrder',
      bookmarks:
        'id, categoryId, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
      sessions: 'id, savedAt',
      userSettings: 'id',
    });

    this.version(2)
      .stores({
        boards: 'id, sortOrder, updatedAt',
        categories: 'id, boardId, sortOrder',
        bookmarks:
          'id, categoryId, archived, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
        sessions: 'id, savedAt',
        userSettings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('bookmarks')
          .toCollection()
          .modify((bookmark) => {
            if (typeof (bookmark as Bookmark).archived === 'undefined') {
              (bookmark as Bookmark).archived = false;
            }
          });
      });
  }
}

export const db = new LinkOSaurusDB();

type AnyTable = Table<unknown, string>;

const runWriteTransaction = async <T>(
  database: LinkOSaurusDB,
  tables: AnyTable | AnyTable[],
  task: () => Promise<T>,
): Promise<T> => {
  const targetTables = Array.isArray(tables) ? tables : [tables];
  return database.transaction('rw', targetTables, task);
};

const normalizeBookmark = (bookmark: BookmarkInput): Bookmark => {
  const createdAt = ensureTimestamp(bookmark.createdAt);
  const updatedAt = ensureTimestamp(bookmark.updatedAt);
  return {
    ...BOOKMARK_DEFAULTS,
    ...bookmark,
    tags: [...(bookmark.tags ?? BOOKMARK_DEFAULTS.tags)],
    createdAt,
    updatedAt,
    archived: bookmark.archived ?? BOOKMARK_DEFAULTS.archived,
    pinned: bookmark.pinned ?? BOOKMARK_DEFAULTS.pinned,
    visitCount: bookmark.visitCount ?? 0,
  };
};

const normalizeBoard = (board: CreateBoardInput): Board => ({
  ...board,
  createdAt: ensureTimestamp(board.createdAt),
  updatedAt: ensureTimestamp(board.updatedAt),
});

const normalizeCategory = (category: CreateCategoryInput): Category => ({
  ...category,
  sortOrder: category.sortOrder,
});

const normalizeSession = (session: CreateSessionInput): SessionPack => ({
  ...session,
  tabs: session.tabs.map((tab) => ({ ...tab })),
});

const normalizeSettings = (settings: UserSettings): UserSettingsRecord => ({
  ...DEFAULT_USER_SETTINGS,
  ...settings,
  id: USER_SETTINGS_KEY,
});

const withDatabase = (database?: LinkOSaurusDB): LinkOSaurusDB => database ?? db;

export const createBoard = async (
  board: CreateBoardInput,
  database?: LinkOSaurusDB,
): Promise<Board> => {
  const dbInstance = withDatabase(database);
  const record = normalizeBoard(board);
  await runWriteTransaction(dbInstance, dbInstance.boards, () => dbInstance.boards.put(record));
  return record;
};

export const updateBoard = async (
  id: string,
  changes: UpdateBoardInput,
  database?: LinkOSaurusDB,
): Promise<Board> => {
  const dbInstance = withDatabase(database);
  const patch: Partial<Board> = {
    ...changes,
    updatedAt: ensureTimestamp(changes.updatedAt),
  };

  await runWriteTransaction(dbInstance, dbInstance.boards, async () => {
    const updated = await dbInstance.boards.update(id, patch);
    if (!updated) {
      throw new Error(`Board ${id} not found`);
    }
  });

  const next = await dbInstance.boards.get(id);
  if (!next) {
    throw new Error(`Board ${id} not found after update`);
  }
  return next;
};

export const getBoard = async (id: string, database?: LinkOSaurusDB): Promise<Board | undefined> => {
  const dbInstance = withDatabase(database);
  return dbInstance.boards.get(id);
};

export const listBoards = async (database?: LinkOSaurusDB): Promise<Board[]> => {
  const dbInstance = withDatabase(database);
  return dbInstance.boards.orderBy('sortOrder').toArray();
};

export const deleteBoard = async (id: string, database?: LinkOSaurusDB): Promise<void> => {
  const dbInstance = withDatabase(database);
  await runWriteTransaction(
    dbInstance,
    [dbInstance.boards, dbInstance.categories, dbInstance.bookmarks],
    async () => {
      const categoryIds = await dbInstance.categories.where('boardId').equals(id).primaryKeys();
      if (categoryIds.length > 0) {
        await dbInstance.bookmarks.where('categoryId').anyOf(categoryIds).modify((bookmark) => {
          (bookmark as Bookmark).categoryId = undefined;
        });
        await dbInstance.categories.where('boardId').equals(id).delete();
      }
      await dbInstance.boards.delete(id);
    },
  );
};

export const createCategory = async (
  category: CreateCategoryInput,
  database?: LinkOSaurusDB,
): Promise<Category> => {
  const dbInstance = withDatabase(database);
  const record = normalizeCategory(category);
  await runWriteTransaction(dbInstance, dbInstance.categories, () =>
    dbInstance.categories.put(record),
  );
  return record;
};

export const updateCategory = async (
  id: string,
  changes: UpdateCategoryInput,
  database?: LinkOSaurusDB,
): Promise<Category> => {
  const dbInstance = withDatabase(database);
  await runWriteTransaction(dbInstance, dbInstance.categories, async () => {
    const updated = await dbInstance.categories.update(id, changes);
    if (!updated) {
      throw new Error(`Category ${id} not found`);
    }
  });

  const next = await dbInstance.categories.get(id);
  if (!next) {
    throw new Error(`Category ${id} not found after update`);
  }
  return next;
};

export const listCategories = async (
  boardId?: string,
  database?: LinkOSaurusDB,
): Promise<Category[]> => {
  const dbInstance = withDatabase(database);
  if (boardId) {
    const categories = await dbInstance.categories.where('boardId').equals(boardId).toArray();
    return categories.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return dbInstance.categories.orderBy('sortOrder').toArray();
};

export const getCategory = async (
  id: string,
  database?: LinkOSaurusDB,
): Promise<Category | undefined> => {
  const dbInstance = withDatabase(database);
  return dbInstance.categories.get(id);
};

export const deleteCategory = async (id: string, database?: LinkOSaurusDB): Promise<void> => {
  const dbInstance = withDatabase(database);
  await runWriteTransaction(
    dbInstance,
    [dbInstance.categories, dbInstance.bookmarks],
    async () => {
      await dbInstance.bookmarks.where('categoryId').equals(id).modify((bookmark) => {
        (bookmark as Bookmark).categoryId = undefined;
      });
      await dbInstance.categories.delete(id);
    },
  );
};

export type BookmarkListOptions = {
  categoryId?: string;
  includeArchived?: boolean;
  limit?: number;
};

export const createBookmark = async (
  bookmark: CreateBookmarkInput,
  database?: LinkOSaurusDB,
): Promise<Bookmark> => {
  const dbInstance = withDatabase(database);
  const record = normalizeBookmark(bookmark);
  await runWriteTransaction(dbInstance, dbInstance.bookmarks, () =>
    dbInstance.bookmarks.put(record),
  );
  return record;
};

export const createBookmarks = async (
  bookmarks: CreateBookmarkInput[],
  database?: LinkOSaurusDB,
): Promise<Bookmark[]> => {
  const dbInstance = withDatabase(database);
  const records = bookmarks.map((bookmark) => normalizeBookmark(bookmark));
  await runWriteTransaction(dbInstance, dbInstance.bookmarks, async () => {
    if (records.length > 0) {
      try {
        await dbInstance.bookmarks.bulkAdd(records);
      } catch (error) {
        if (error instanceof Dexie.BulkError) {
          await dbInstance.bookmarks.bulkPut(records);
        } else {
          throw error;
        }
      }
    }
  });
  return records;
};

export const updateBookmark = async (
  id: string,
  changes: UpdateBookmarkInput,
  database?: LinkOSaurusDB,
): Promise<Bookmark> => {
  const dbInstance = withDatabase(database);
  const patch: Partial<Bookmark> = {
    ...changes,
    updatedAt: ensureTimestamp(changes.updatedAt),
  };

  await runWriteTransaction(dbInstance, dbInstance.bookmarks, async () => {
    const updated = await dbInstance.bookmarks.update(id, patch);
    if (!updated) {
      throw new Error(`Bookmark ${id} not found`);
    }
  });

  const next = await dbInstance.bookmarks.get(id);
  if (!next) {
    throw new Error(`Bookmark ${id} not found after update`);
  }
  return next;
};

export const getBookmark = async (
  id: string,
  database?: LinkOSaurusDB,
): Promise<Bookmark | undefined> => {
  const dbInstance = withDatabase(database);
  return dbInstance.bookmarks.get(id);
};

export const listBookmarks = async (
  options: BookmarkListOptions = {},
  database?: LinkOSaurusDB,
): Promise<Bookmark[]> => {
  const dbInstance = withDatabase(database);
  const { categoryId, includeArchived = false, limit } = options;

  let collection = categoryId
    ? dbInstance.bookmarks.where('categoryId').equals(categoryId)
    : dbInstance.bookmarks.toCollection();

  if (!includeArchived) {
    collection = collection.filter((bookmark) => !(bookmark.archived ?? false));
  }

  if (typeof limit === 'number') {
    return collection.limit(limit).toArray();
  }

  return collection.toArray();
};

export const listPinnedBookmarks = async (
  options: { limit?: number } = {},
  database?: LinkOSaurusDB,
): Promise<Bookmark[]> => {
  const dbInstance = withDatabase(database);
  const { limit } = options;

  const pinned = await dbInstance.bookmarks
    .toCollection()
    .filter((bookmark) => (bookmark.pinned ?? false) && !(bookmark.archived ?? false))
    .toArray();

  pinned.sort((a, b) => b.updatedAt - a.updatedAt);

  if (typeof limit === 'number') {
    return pinned.slice(0, Math.max(0, limit));
  }

  return pinned;
};

export const deleteBookmark = async (
  id: string,
  database?: LinkOSaurusDB,
): Promise<void> => {
  const dbInstance = withDatabase(database);
  await runWriteTransaction(dbInstance, dbInstance.bookmarks, () =>
    dbInstance.bookmarks.delete(id),
  );
};

export const createSession = async (
  session: CreateSessionInput,
  database?: LinkOSaurusDB,
): Promise<SessionPack> => {
  const dbInstance = withDatabase(database);
  const record = normalizeSession(session);
  await runWriteTransaction(dbInstance, dbInstance.sessions, () =>
    dbInstance.sessions.put(record),
  );
  return record;
};

export const updateSession = async (
  id: string,
  changes: UpdateSessionInput,
  database?: LinkOSaurusDB,
): Promise<SessionPack> => {
  const dbInstance = withDatabase(database);
  const patch: Partial<SessionPack> = {
    ...changes,
  };
  if (patch.tabs) {
    patch.tabs = patch.tabs.map((tab) => ({ ...tab }));
  }

  await runWriteTransaction(dbInstance, dbInstance.sessions, async () => {
    const updated = await dbInstance.sessions.update(id, patch);
    if (!updated) {
      throw new Error(`Session ${id} not found`);
    }
  });

  const next = await dbInstance.sessions.get(id);
  if (!next) {
    throw new Error(`Session ${id} not found after update`);
  }
  return next;
};

export const listSessions = async (database?: LinkOSaurusDB): Promise<SessionPack[]> => {
  const dbInstance = withDatabase(database);
  const sessions = await dbInstance.sessions.orderBy('savedAt').reverse().toArray();
  return sessions.map((session) => ({ ...session, tabs: session.tabs.map((tab) => ({ ...tab })) }));
};

export const getSession = async (
  id: string,
  database?: LinkOSaurusDB,
): Promise<SessionPack | undefined> => {
  const dbInstance = withDatabase(database);
  const session = await dbInstance.sessions.get(id);
  return session ? { ...session, tabs: session.tabs.map((tab) => ({ ...tab })) } : undefined;
};

export const deleteSession = async (id: string, database?: LinkOSaurusDB): Promise<void> => {
  const dbInstance = withDatabase(database);
  await runWriteTransaction(dbInstance, dbInstance.sessions, () => dbInstance.sessions.delete(id));
};

export const getUserSettings = async (
  database?: LinkOSaurusDB,
): Promise<UserSettings> => {
  const dbInstance = withDatabase(database);
  const stored = await dbInstance.userSettings.get(USER_SETTINGS_KEY);
  return stored ? { ...DEFAULT_USER_SETTINGS, ...stored } : { ...DEFAULT_USER_SETTINGS };
};

export const saveUserSettings = async (
  settings: Partial<UserSettings>,
  database?: LinkOSaurusDB,
): Promise<UserSettings> => {
  const dbInstance = withDatabase(database);
  const merged = { ...DEFAULT_USER_SETTINGS, ...(await getUserSettings(dbInstance)), ...settings };
  const record = normalizeSettings(merged);
  await runWriteTransaction(dbInstance, dbInstance.userSettings, () =>
    dbInstance.userSettings.put(record),
  );
  return { ...merged };
};

export const clearDatabase = async (database?: LinkOSaurusDB): Promise<void> => {
  const dbInstance = withDatabase(database);
  await runWriteTransaction(
    dbInstance,
    [dbInstance.boards, dbInstance.categories, dbInstance.bookmarks, dbInstance.sessions, dbInstance.userSettings],
    async () => {
      await Promise.all([
        dbInstance.boards.clear(),
        dbInstance.categories.clear(),
        dbInstance.bookmarks.clear(),
        dbInstance.sessions.clear(),
        dbInstance.userSettings.clear(),
      ]);
    },
  );
};

export const createDatabase = (name: string = DB_NAME): LinkOSaurusDB => new LinkOSaurusDB(name);
