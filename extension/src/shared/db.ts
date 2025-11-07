import Dexie, { Table } from 'dexie';
import type { Board, Bookmark, Category, SessionPack, Tag, UserSettings } from './types';

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

export type CreateTagInput = {
  id?: string;
  name: string;
  usageCount?: number;
};

export type UpdateTagInput = Partial<Omit<Tag, 'id'>>;

const BOOKMARK_DEFAULTS = {
  archived: false,
  pinned: false,
  tags: [] as string[],
};

const ensureTimestamp = (value: number | undefined): number => value ?? Date.now();

const normalizeTagName = (name: string): string => name.trim();

const canonicalizeTagId = (name: string): string => normalizeTagName(name).toLowerCase();

const normalizeTagList = (tags?: string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags ?? []) {
    const cleaned = normalizeTagName(tag);
    if (!cleaned) {
      continue;
    }
    const id = canonicalizeTagId(cleaned);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(cleaned);
  }
  return normalized;
};

type TagDelta = {
  name: string;
  delta: number;
};

const addTagDelta = (map: Map<string, TagDelta>, name: string, delta: number) => {
  if (!delta) {
    return;
  }
  const cleaned = normalizeTagName(name);
  if (!cleaned) {
    return;
  }
  const id = canonicalizeTagId(cleaned);
  const existing = map.get(id);
  if (existing) {
    existing.delta += delta;
    existing.name = cleaned;
    if (existing.delta === 0) {
      map.delete(id);
    }
    return;
  }
  map.set(id, { name: cleaned, delta });
};

const changeTagUsage = async (
  dbInstance: LinkOSaurusDB,
  name: string,
  delta: number,
): Promise<Tag | undefined> => {
  const cleaned = normalizeTagName(name);
  if (!cleaned || delta === 0) {
    const id = canonicalizeTagId(cleaned);
    return cleaned ? dbInstance.tags.get(id) : undefined;
  }

  const id = canonicalizeTagId(cleaned);
  let existing = await dbInstance.tags.get(id);
  if (!existing) {
    existing = await dbInstance.tags.where('name').equals(cleaned).first();
  }
  if (!existing) {
    if (delta < 0) {
      return undefined;
    }
    const record: Tag = {
      id,
      name: cleaned,
      usageCount: delta,
    };
    await dbInstance.tags.put(record);
    return record;
  }

  const nextCount = Math.max(0, existing.usageCount + delta);
  const nextName = delta > 0 ? cleaned : existing.name;
  const updated: Tag = { ...existing, name: nextName, usageCount: nextCount };
  await dbInstance.tags.put(updated);
  return updated;
};

const applyTagDeltas = async (
  dbInstance: LinkOSaurusDB,
  deltas: Map<string, TagDelta>,
): Promise<void> => {
  for (const delta of deltas.values()) {
    await changeTagUsage(dbInstance, delta.name, delta.delta);
  }
};

const updateTagUsageForDiff = async (
  dbInstance: LinkOSaurusDB,
  previousTags: string[],
  nextTags: string[],
): Promise<void> => {
  const deltas = new Map<string, TagDelta>();
  previousTags.forEach((tag) => addTagDelta(deltas, tag, -1));
  nextTags.forEach((tag) => addTagDelta(deltas, tag, 1));
  await applyTagDeltas(dbInstance, deltas);
};

export class LinkOSaurusDB extends Dexie {
  boards!: Table<Board, string>;
  categories!: Table<Category, string>;
  bookmarks!: Table<Bookmark, string>;
  sessions!: Table<SessionPack, string>;
  userSettings!: Table<UserSettingsRecord, string>;
  tags!: Table<Tag, string>;

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

    this.version(3)
      .stores({
        boards: 'id, sortOrder, updatedAt',
        categories: 'id, boardId, sortOrder',
        bookmarks:
          'id, categoryId, archived, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
        sessions: 'id, savedAt',
        userSettings: 'id',
        tags: 'id, &name, usageCount',
      })
      .upgrade(async (tx) => {
        const tagUsage = new Map<string, { name: string; usageCount: number }>();
        await tx
          .table('bookmarks')
          .toCollection()
          .modify((raw) => {
            const bookmark = raw as Bookmark;
            const normalized = normalizeTagList(bookmark.tags);
            bookmark.tags = normalized;
            normalized.forEach((tag) => {
              const id = canonicalizeTagId(tag);
              const entry = tagUsage.get(id);
              if (entry) {
                entry.usageCount += 1;
              } else {
                tagUsage.set(id, { name: tag, usageCount: 1 });
              }
            });
          });

        const tagTable = tx.table('tags') as Table<Tag, string>;
        await Promise.all(
          Array.from(tagUsage.entries()).map(([id, info]) =>
            tagTable.put({ id, name: info.name, usageCount: info.usageCount }),
          ),
        );
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
  const tags = normalizeTagList(bookmark.tags ?? BOOKMARK_DEFAULTS.tags);
  return {
    ...BOOKMARK_DEFAULTS,
    ...bookmark,
    tags,
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

const toTagRecord = (input: CreateTagInput): Tag => {
  const name = normalizeTagName(input.name);
  if (!name) {
    throw new Error('Tag name must not be empty');
  }
  const id = input.id ? canonicalizeTagId(input.id) : canonicalizeTagId(name);
  if (!id) {
    throw new Error('Tag id must not be empty');
  }
  return {
    id,
    name,
    usageCount: Math.max(0, input.usageCount ?? 0),
  };
};

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
  await runWriteTransaction(
    dbInstance,
    [dbInstance.bookmarks, dbInstance.tags],
    async () => {
      await dbInstance.bookmarks.put(record);
      await updateTagUsageForDiff(dbInstance, [], record.tags);
    },
  );
  return record;
};

export const createBookmarks = async (
  bookmarks: CreateBookmarkInput[],
  database?: LinkOSaurusDB,
): Promise<Bookmark[]> => {
  const dbInstance = withDatabase(database);
  const records = bookmarks.map((bookmark) => normalizeBookmark(bookmark));
  await runWriteTransaction(
    dbInstance,
    [dbInstance.bookmarks, dbInstance.tags],
    async () => {
      const existing = records.length
        ? await dbInstance.bookmarks
            .where('id')
            .anyOf(records.map((record) => record.id))
            .toArray()
        : [];

      const existingById = new Map<string, Bookmark>(
        existing.map((bookmark) => [bookmark.id, { ...bookmark, tags: normalizeTagList(bookmark.tags) }]),
      );

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

      for (const record of records) {
        const previous = existingById.get(record.id);
        await updateTagUsageForDiff(dbInstance, previous ? previous.tags : [], record.tags);
      }
    },
  );
  return records;
};

export const updateBookmark = async (
  id: string,
  changes: UpdateBookmarkInput,
  database?: LinkOSaurusDB,
): Promise<Bookmark> => {
  const dbInstance = withDatabase(database);
  const sanitizedTags = changes.tags ? normalizeTagList(changes.tags) : undefined;
  const patch: Partial<Bookmark> = {
    ...changes,
    updatedAt: ensureTimestamp(changes.updatedAt),
  };
  if (sanitizedTags) {
    patch.tags = sanitizedTags;
  } else {
    delete patch.tags;
  }

  let next: Bookmark | undefined;
  await runWriteTransaction(
    dbInstance,
    [dbInstance.bookmarks, dbInstance.tags],
    async () => {
      const current = await dbInstance.bookmarks.get(id);
      if (!current) {
        throw new Error(`Bookmark ${id} not found`);
      }
      const previousTags = normalizeTagList(current.tags);
      const nextTags = sanitizedTags ?? previousTags;
      const updatedRecord: Bookmark = {
        ...current,
        ...patch,
        tags: nextTags,
      };
      await dbInstance.bookmarks.put(updatedRecord);
      await updateTagUsageForDiff(dbInstance, previousTags, nextTags);
      next = updatedRecord;
    },
  );

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
  await runWriteTransaction(
    dbInstance,
    [dbInstance.bookmarks, dbInstance.tags],
    async () => {
      const existing = await dbInstance.bookmarks.get(id);
      await dbInstance.bookmarks.delete(id);
      if (existing) {
        const previousTags = normalizeTagList(existing.tags);
        if (previousTags.length) {
          await updateTagUsageForDiff(dbInstance, previousTags, []);
        }
      }
    },
  );
};

export const createTag = async (
  input: CreateTagInput,
  database?: LinkOSaurusDB,
): Promise<Tag> => {
  const dbInstance = withDatabase(database);
  const record = toTagRecord(input);
  await runWriteTransaction(dbInstance, dbInstance.tags, async () => {
    const existing = await dbInstance.tags.get(record.id);
    if (existing) {
      throw new Error(`Tag ${record.id} already exists`);
    }
    await dbInstance.tags.put(record);
  });
  return record;
};

export const updateTag = async (
  id: string,
  changes: UpdateTagInput,
  database?: LinkOSaurusDB,
): Promise<Tag> => {
  const dbInstance = withDatabase(database);
  const normalizedId = canonicalizeTagId(id);
  const patch: Partial<Tag> = {};
  if (typeof changes.name === 'string') {
    const name = normalizeTagName(changes.name);
    if (!name) {
      throw new Error('Tag name must not be empty');
    }
    patch.name = name;
  }
  if (typeof changes.usageCount === 'number') {
    patch.usageCount = Math.max(0, changes.usageCount);
  }

  await runWriteTransaction(dbInstance, dbInstance.tags, async () => {
    const updated = await dbInstance.tags.update(normalizedId, patch);
    if (!updated) {
      throw new Error(`Tag ${id} not found`);
    }
  });

  const next = await dbInstance.tags.get(normalizedId);
  if (!next) {
    throw new Error(`Tag ${id} not found after update`);
  }
  return next;
};

export const deleteTag = async (
  id: string,
  database?: LinkOSaurusDB,
): Promise<void> => {
  const dbInstance = withDatabase(database);
  const normalizedId = canonicalizeTagId(id);
  await runWriteTransaction(dbInstance, dbInstance.tags, () => dbInstance.tags.delete(normalizedId));
};

export const getTag = async (id: string, database?: LinkOSaurusDB): Promise<Tag | undefined> => {
  const dbInstance = withDatabase(database);
  const normalizedId = canonicalizeTagId(id);
  return dbInstance.tags.get(normalizedId);
};

export const listTags = async (database?: LinkOSaurusDB): Promise<Tag[]> => {
  const dbInstance = withDatabase(database);
  const tags = await dbInstance.tags.toArray();
  return tags.sort(
    (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name),
  );
};

export const incrementTagUsage = async (
  name: string,
  database?: LinkOSaurusDB,
): Promise<Tag | undefined> => {
  const dbInstance = withDatabase(database);
  return runWriteTransaction(dbInstance, dbInstance.tags, () =>
    changeTagUsage(dbInstance, name, 1),
  );
};

export const decrementTagUsage = async (
  name: string,
  database?: LinkOSaurusDB,
): Promise<Tag | undefined> => {
  const dbInstance = withDatabase(database);
  return runWriteTransaction(dbInstance, dbInstance.tags, () =>
    changeTagUsage(dbInstance, name, -1),
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
    [
      dbInstance.boards,
      dbInstance.categories,
      dbInstance.bookmarks,
      dbInstance.sessions,
      dbInstance.userSettings,
      dbInstance.tags,
    ],
    async () => {
      await Promise.all([
        dbInstance.boards.clear(),
        dbInstance.categories.clear(),
        dbInstance.bookmarks.clear(),
        dbInstance.sessions.clear(),
        dbInstance.userSettings.clear(),
        dbInstance.tags.clear(),
      ]);
    },
  );
};

export const createDatabase = (name: string = DB_NAME): LinkOSaurusDB => new LinkOSaurusDB(name);
