import Dexie, { Table } from 'dexie';
import type {
  Board,
  Bookmark,
  Category,
  Comment,
  Rule,
  SessionPack,
  Tag,
  UserSettings,
} from './types';
import {
  canonicalizeTagId,
  createTagFromMetadata,
  deriveTagMetadata,
  normalizeTagList,
  normalizeTagPath,
} from './tag-utils';

export const DB_NAME = 'link-o-saurus';
export const USER_SETTINGS_KEY = 'user-settings';
export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  newTabEnabled: false,
  hotkeys: {},
};

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
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

export type CreateCommentInput = Omit<Comment, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

export type UpdateCommentInput = Partial<Pick<Comment, 'author' | 'body'>>;

type BookmarkInput = CreateBookmarkInput;

export type CreateTagInput = {
  id?: string;
  path: string;
  name?: string;
  usageCount?: number;
};

export type UpdateTagInput = Partial<Omit<Tag, 'id'>>;

export type CreateRuleInput = Omit<Rule, 'id'> & { id?: string };

export type UpdateRuleInput = Partial<Omit<Rule, 'id'>> & {
  conditions?: Partial<Rule['conditions']>;
  actions?: Partial<Rule['actions']>;
};

const BOOKMARK_DEFAULTS = {
  archived: false,
  pinned: false,
  tags: [] as string[],
};

const ensureTimestamp = (value: number | undefined): number => value ?? Date.now();

type TagDelta = {
  path: string;
  delta: number;
};

const addTagDelta = (map: Map<string, TagDelta>, name: string, delta: number) => {
  if (!delta) {
    return;
  }
  const cleaned = normalizeTagPath(name);
  if (!cleaned) {
    return;
  }
  const metadata = deriveTagMetadata(cleaned);
  const existing = map.get(metadata.canonicalId);
  if (existing) {
    existing.delta += delta;
    existing.path = cleaned;
    if (existing.delta === 0) {
      map.delete(metadata.canonicalId);
    }
    return;
  }
  map.set(metadata.canonicalId, { path: cleaned, delta });
};

const changeTagUsage = async (
  dbInstance: LinkOSaurusDB,
  name: string,
  delta: number,
): Promise<Tag | undefined> => {
  const normalized = normalizeTagPath(name);
  if (!normalized) {
    const id = canonicalizeTagId(name);
    return id ? dbInstance.tags.get(id) : undefined;
  }

  if (delta === 0) {
    const id = canonicalizeTagId(normalized);
    return id ? dbInstance.tags.get(id) : undefined;
  }

  const metadata = deriveTagMetadata(normalized);
  const id = metadata.canonicalId;
  let existing = await dbInstance.tags.get(id);
  if (!existing) {
    existing = await dbInstance.tags.where('path').equals(metadata.path).first();
  }
  if (!existing) {
    if (delta < 0) {
      return undefined;
    }
    const record = createTagFromMetadata(metadata, { usageCount: delta });
    await dbInstance.tags.put(record);
    return record;
  }

  const nextCount = Math.max(0, existing.usageCount + delta);
  const updated: Tag = {
    ...existing,
    name: delta > 0 ? metadata.leafName : existing.name,
    path: delta > 0 ? metadata.path : existing.path,
    slugParts: delta > 0 ? metadata.slugParts : existing.slugParts,
    usageCount: nextCount,
  };
  await dbInstance.tags.put(updated);
  return updated;
};

const applyTagDeltas = async (
  dbInstance: LinkOSaurusDB,
  deltas: Map<string, TagDelta>,
): Promise<void> => {
  for (const delta of deltas.values()) {
    await changeTagUsage(dbInstance, delta.path, delta.delta);
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
  comments!: Table<Comment, string>;
  sessions!: Table<SessionPack, string>;
  userSettings!: Table<UserSettingsRecord, string>;
  tags!: Table<Tag, string>;
  rules!: Table<Rule, string>;

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
        const tagUsage = new Map<string, { path: string; usageCount: number }>();
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
                tagUsage.set(id, { path: tag, usageCount: 1 });
              }
            });
          });

        const tagTable = tx.table('tags') as Table<Tag, string>;
        await Promise.all(
          Array.from(tagUsage.entries()).map(([id, info]) =>
            tagTable.put(
              createTagFromMetadata(deriveTagMetadata(info.path), {
                id,
                usageCount: info.usageCount,
              }),
            ),
          ),
        );
      });

    this.version(4)
      .stores({
        boards: 'id, sortOrder, updatedAt',
        categories: 'id, boardId, sortOrder',
        bookmarks:
          'id, categoryId, archived, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
        sessions: 'id, savedAt',
        userSettings: 'id',
        tags: 'id, &path, &name, usageCount, *slugParts',
      })
      .upgrade(async (tx) => {
        const tagTable = tx.table('tags') as Table<Tag, string>;
        await tagTable.toCollection().modify((raw) => {
          const tag = raw as Tag;
          const source = tag.path ?? tag.name ?? tag.id;
          const metadata = deriveTagMetadata(source);
          tag.path = metadata.path;
          tag.slugParts = metadata.slugParts;
          if (!tag.name) {
            tag.name = metadata.leafName;
          }
        });
      });

    this.version(5).stores({
      boards: 'id, sortOrder, updatedAt',
      categories: 'id, boardId, sortOrder',
      bookmarks:
        'id, categoryId, archived, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
      comments: 'id, bookmarkId, createdAt',
      sessions: 'id, savedAt',
      userSettings: 'id',
      tags: 'id, &path, &name, usageCount, *slugParts',
    });

    this.version(6).stores({
      boards: 'id, sortOrder, updatedAt',
      categories: 'id, boardId, sortOrder',
      bookmarks:
        'id, categoryId, archived, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
      comments: 'id, bookmarkId, createdAt',
      sessions: 'id, savedAt',
      userSettings: 'id',
      tags: 'id, &path, &name, usageCount, *slugParts',
      rules: 'id, enabled, name',
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

const normalizeComment = (comment: CreateCommentInput): Comment => {
  const bookmarkId = comment.bookmarkId.trim();
  if (!bookmarkId) {
    throw new Error('Comment bookmark id must not be empty');
  }

  const author = comment.author.trim();
  if (!author) {
    throw new Error('Comment author must not be empty');
  }

  const body = comment.body.trim();
  if (!body) {
    throw new Error('Comment body must not be empty');
  }

  const id = comment.id && comment.id.trim().length > 0 ? comment.id.trim() : createId();

  return {
    id,
    bookmarkId,
    author,
    body,
    createdAt: ensureTimestamp(comment.createdAt),
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
  const path = normalizeTagPath(input.path);
  if (!path) {
    throw new Error('Tag path must not be empty');
  }
  const metadata = deriveTagMetadata(path);
  const id = input.id ? canonicalizeTagId(input.id) : metadata.canonicalId;
  if (!id) {
    throw new Error('Tag id must not be empty');
  }
  const name =
    typeof input.name === 'string' && input.name.trim().length > 0
      ? input.name.trim()
      : metadata.leafName;
  return {
    id,
    name,
    path: metadata.path,
    slugParts: metadata.slugParts,
    usageCount: Math.max(0, input.usageCount ?? 0),
  };
};

const uniqueStrings = (values: string[], keySelector: (value: string) => string = (value) => value): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = keySelector(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
};

const normalizeRule = (input: CreateRuleInput): Rule => {
  const idCandidate = typeof input.id === 'string' ? input.id.trim() : '';
  const name = input.name?.trim();
  if (!name) {
    throw new Error('Rule name must not be empty');
  }

  const normalizedConditions: Rule['conditions'] = {};
  const host = input.conditions?.host?.trim();
  if (host) {
    normalizedConditions.host = host.toLowerCase();
  }

  const urlIncludes = uniqueStrings(
    (input.conditions?.urlIncludes ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    (value) => value.toLowerCase(),
  );
  if (urlIncludes.length > 0) {
    normalizedConditions.urlIncludes = urlIncludes;
  }

  const mime = input.conditions?.mime?.trim();
  if (mime) {
    normalizedConditions.mime = mime.toLowerCase();
  }

  const normalizedActions: Rule['actions'] = {};
  const addTags = uniqueStrings(
    (input.actions?.addTags ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    (value) => {
      const canonical = canonicalizeTagId(value);
      return canonical || value.toLowerCase();
    },
  );
  if (addTags.length > 0) {
    normalizedActions.addTags = addTags;
  }

  const setCategoryId = input.actions?.setCategoryId?.trim();
  if (setCategoryId) {
    normalizedActions.setCategoryId = setCategoryId;
  }

  if (Object.keys(normalizedConditions).length === 0) {
    throw new Error('Rule must define at least one condition');
  }

  if (Object.keys(normalizedActions).length === 0) {
    throw new Error('Rule must define at least one action');
  }

  return {
    id: idCandidate || createId(),
    name,
    conditions: normalizedConditions,
    actions: normalizedActions,
    enabled: input.enabled ?? true,
  };
};

const getEnabledRules = async (dbInstance: LinkOSaurusDB): Promise<Rule[]> => {
  const rules = await dbInstance.rules.toArray();
  return rules.filter((rule) => rule.enabled);
};

type BookmarkCandidate = BookmarkInput & { mime?: string };

type RuleEvaluationContext = {
  host: string | null;
  lowerUrl: string;
  mime?: string;
};

const normalizeHost = (value: string): string => value.replace(/^www\./, '').toLowerCase();

const createRuleContext = (bookmark: BookmarkCandidate): RuleEvaluationContext => {
  let host: string | null = null;
  try {
    const parsed = new URL(bookmark.url);
    host = parsed.hostname;
  } catch {
    host = null;
  }

  return {
    host,
    lowerUrl: bookmark.url.toLowerCase(),
    mime: bookmark.mime?.toLowerCase(),
  };
};

const hostMatches = (expected: string | undefined, actual: string | null): boolean => {
  if (!expected) {
    return true;
  }
  if (!actual) {
    return false;
  }
  const normalizedExpected = normalizeHost(expected);
  const normalizedActual = normalizeHost(actual);
  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.endsWith(`.${normalizedExpected}`)
  );
};

const urlIncludesMatch = (segments: string[] | undefined, url: string): boolean => {
  if (!segments || segments.length === 0) {
    return true;
  }
  for (const segment of segments) {
    if (!url.includes(segment.toLowerCase())) {
      return false;
    }
  }
  return true;
};

const mimeMatches = (expected: string | undefined, actual: string | undefined): boolean => {
  if (!expected) {
    return true;
  }
  return actual === expected;
};

const ruleMatchesBookmark = (rule: Rule, context: RuleEvaluationContext): boolean => {
  return (
    hostMatches(rule.conditions.host, context.host) &&
    urlIncludesMatch(rule.conditions.urlIncludes, context.lowerUrl) &&
    mimeMatches(rule.conditions.mime, context.mime)
  );
};

const addTagIfMissing = (tags: string[], tag: string): void => {
  const trimmed = tag.trim();
  if (!trimmed) {
    return;
  }
  const canonical = canonicalizeTagId(trimmed) || trimmed.toLowerCase();
  const exists = tags.some((existing) => {
    const existingCanonical = canonicalizeTagId(existing) || existing.toLowerCase();
    return existingCanonical === canonical;
  });
  if (!exists) {
    tags.push(trimmed);
  }
};

const applyRuleActions = (bookmark: BookmarkCandidate, rule: Rule): BookmarkCandidate => {
  const tags = [...(bookmark.tags ?? [])];
  if (rule.actions.addTags) {
    for (const tag of rule.actions.addTags) {
      addTagIfMissing(tags, tag);
    }
  }

  const next: BookmarkCandidate = {
    ...bookmark,
    tags,
  };

  if (rule.actions.setCategoryId && !next.categoryId) {
    next.categoryId = rule.actions.setCategoryId;
  }

  return next;
};

const applyRulesToBookmarkSync = (bookmark: BookmarkCandidate, rules: Rule[]): BookmarkCandidate => {
  if (rules.length === 0) {
    return { ...bookmark };
  }

  let result: BookmarkCandidate = { ...bookmark };
  const context = createRuleContext(result);

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    if (!ruleMatchesBookmark(rule, context)) {
      continue;
    }
    result = applyRuleActions(result, rule);
  }

  if (result.tags && result.tags.length === 0) {
    delete result.tags;
  }

  return result;
};

const applyRulesInternal = async (
  bookmark: BookmarkCandidate,
  dbInstance: LinkOSaurusDB,
  cachedRules?: Rule[],
): Promise<BookmarkCandidate> => {
  const rules = cachedRules ?? (await getEnabledRules(dbInstance));
  if (rules.length === 0) {
    return { ...bookmark };
  }
  return applyRulesToBookmarkSync(bookmark, rules);
};

const sortRulesByName = (rules: Rule[]): Rule[] =>
  [...rules].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export const listRules = async (database?: LinkOSaurusDB): Promise<Rule[]> => {
  const dbInstance = withDatabase(database);
  const rules = await dbInstance.rules.toArray();
  return sortRulesByName(rules);
};

export const getRule = async (id: string, database?: LinkOSaurusDB): Promise<Rule | undefined> => {
  const dbInstance = withDatabase(database);
  const trimmed = id.trim();
  if (!trimmed) {
    return undefined;
  }
  return dbInstance.rules.get(trimmed);
};

export const createRule = async (
  rule: CreateRuleInput,
  database?: LinkOSaurusDB,
): Promise<Rule> => {
  const dbInstance = withDatabase(database);
  const record = normalizeRule(rule);
  await runWriteTransaction(dbInstance, dbInstance.rules, async () => {
    const existing = await dbInstance.rules.get(record.id);
    if (existing) {
      throw new Error(`Rule ${record.id} already exists`);
    }
    await dbInstance.rules.put(record);
  });
  return record;
};

export const updateRule = async (
  id: string,
  changes: UpdateRuleInput,
  database?: LinkOSaurusDB,
): Promise<Rule> => {
  const dbInstance = withDatabase(database);
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error('Rule id must not be empty');
  }

  let next: Rule | undefined;
  await runWriteTransaction(dbInstance, dbInstance.rules, async () => {
    const current = await dbInstance.rules.get(trimmedId);
    if (!current) {
      throw new Error(`Rule ${trimmedId} not found`);
    }

    const merged: CreateRuleInput = {
      ...current,
      ...changes,
      id: current.id,
      conditions: {
        ...current.conditions,
        ...changes.conditions,
      },
      actions: {
        ...current.actions,
        ...changes.actions,
      },
    };

    const normalized = normalizeRule(merged);
    await dbInstance.rules.put(normalized);
    next = normalized;
  });

  if (!next) {
    throw new Error(`Rule ${trimmedId} not found after update`);
  }
  return next;
};

export const deleteRule = async (id: string, database?: LinkOSaurusDB): Promise<void> => {
  const dbInstance = withDatabase(database);
  const trimmedId = id.trim();
  if (!trimmedId) {
    return;
  }
  await runWriteTransaction(dbInstance, dbInstance.rules, async () => {
    await dbInstance.rules.delete(trimmedId);
  });
};

export const applyRules = async (
  bookmark: CreateBookmarkInput,
  database?: LinkOSaurusDB,
): Promise<CreateBookmarkInput> => {
  const dbInstance = withDatabase(database);
  const result = await applyRulesInternal(bookmark, dbInstance);
  return { ...result };
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
  const enriched = await applyRulesInternal(bookmark, dbInstance);
  const record = normalizeBookmark(enriched);
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
  const rules = await getEnabledRules(dbInstance);
  const records = bookmarks.map((bookmark) => normalizeBookmark(applyRulesToBookmarkSync(bookmark, rules)));
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

      const aggregateDeltas = new Map<string, TagDelta>();
      for (const record of records) {
        const previous = existingById.get(record.id);
        const previousTags = previous ? previous.tags : [];
        previousTags.forEach((tag) => addTagDelta(aggregateDeltas, tag, -1));
        record.tags.forEach((tag) => addTagDelta(aggregateDeltas, tag, 1));
      }
      await applyTagDeltas(dbInstance, aggregateDeltas);
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
  const trimmedId = id.trim();
  if (!trimmedId) {
    return;
  }
  await runWriteTransaction(
    dbInstance,
    [dbInstance.bookmarks, dbInstance.tags, dbInstance.comments],
    async () => {
      const existing = await dbInstance.bookmarks.get(trimmedId);
      await dbInstance.bookmarks.delete(trimmedId);
      await dbInstance.comments.where('bookmarkId').equals(trimmedId).delete();
      if (existing) {
        const previousTags = normalizeTagList(existing.tags);
        if (previousTags.length) {
          await updateTagUsageForDiff(dbInstance, previousTags, []);
        }
      }
    },
  );
};

export const createComment = async (
  comment: CreateCommentInput,
  database?: LinkOSaurusDB,
): Promise<Comment> => {
  const dbInstance = withDatabase(database);
  const record = normalizeComment(comment);
  await runWriteTransaction(dbInstance, dbInstance.comments, async () => {
    const existing = await dbInstance.comments.get(record.id);
    if (existing) {
      throw new Error(`Comment ${record.id} already exists`);
    }
    await dbInstance.comments.put(record);
  });
  return record;
};

export const listComments = async (
  bookmarkId: string,
  database?: LinkOSaurusDB,
): Promise<Comment[]> => {
  const trimmed = bookmarkId.trim();
  if (!trimmed) {
    return [];
  }
  const dbInstance = withDatabase(database);
  const comments = await dbInstance.comments.where('bookmarkId').equals(trimmed).toArray();
  return comments.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
};

export const updateComment = async (
  id: string,
  changes: UpdateCommentInput,
  database?: LinkOSaurusDB,
): Promise<Comment> => {
  const dbInstance = withDatabase(database);
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error('Comment id must not be empty');
  }

  const patch: Partial<Comment> = {};
  if (typeof changes.author === 'string') {
    const author = changes.author.trim();
    if (!author) {
      throw new Error('Comment author must not be empty');
    }
    patch.author = author;
  }
  if (typeof changes.body === 'string') {
    const body = changes.body.trim();
    if (!body) {
      throw new Error('Comment body must not be empty');
    }
    patch.body = body;
  }

  await runWriteTransaction(dbInstance, dbInstance.comments, async () => {
    const updated = await dbInstance.comments.update(trimmedId, patch);
    if (!updated) {
      throw new Error(`Comment ${id} not found`);
    }
  });

  const next = await dbInstance.comments.get(trimmedId);
  if (!next) {
    throw new Error(`Comment ${id} not found after update`);
  }
  return next;
};

export const deleteComment = async (
  id: string,
  database?: LinkOSaurusDB,
): Promise<void> => {
  const dbInstance = withDatabase(database);
  const trimmedId = id.trim();
  if (!trimmedId) {
    return;
  }
  await runWriteTransaction(dbInstance, dbInstance.comments, async () => {
    await dbInstance.comments.delete(trimmedId);
  });
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
  if (!normalizedId) {
    throw new Error('Tag id must not be empty');
  }
  const patch: Partial<Tag> = {};
  if (typeof changes.path === 'string') {
    const normalizedPath = normalizeTagPath(changes.path);
    if (!normalizedPath) {
      throw new Error('Tag path must not be empty');
    }
    const metadata = deriveTagMetadata(normalizedPath);
    if (metadata.canonicalId !== normalizedId) {
      throw new Error('Updated tag path must match tag id');
    }
    patch.path = metadata.path;
    patch.slugParts = metadata.slugParts;
    if (typeof changes.name !== 'string') {
      patch.name = metadata.leafName;
    }
  }
  if (typeof changes.name === 'string') {
    const name = changes.name.trim();
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
      dbInstance.rules,
    ],
    async () => {
      await Promise.all([
        dbInstance.boards.clear(),
        dbInstance.categories.clear(),
        dbInstance.bookmarks.clear(),
        dbInstance.sessions.clear(),
        dbInstance.userSettings.clear(),
        dbInstance.tags.clear(),
        dbInstance.rules.clear(),
      ]);
    },
  );
};

export const createDatabase = (name: string = DB_NAME): LinkOSaurusDB => new LinkOSaurusDB(name);
