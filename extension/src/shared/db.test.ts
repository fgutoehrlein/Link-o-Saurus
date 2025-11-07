import Dexie from 'dexie';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BookmarkListOptions,
  CreateBoardInput,
  CreateBookmarkInput,
  CreateCategoryInput,
  CreateSessionInput,
  LinkOSaurusDB,
  UpdateBookmarkInput,
  createBoard,
  createBookmarks,
  createBookmark,
  createCategory,
  createDatabase,
  createSession,
  createTag,
  deleteBoard,
  deleteBookmark,
  deleteCategory,
  deleteSession,
  deleteTag,
  getBookmark,
  getSession,
  getUserSettings,
  getTag,
  listBoards,
  listBookmarks,
  listPinnedBookmarks,
  listCategories,
  listSessions,
  listTags,
  saveUserSettings,
  decrementTagUsage,
  incrementTagUsage,
  updateBoard,
  updateBookmark,
  updateCategory,
  updateSession,
  updateTag,
} from './db';

const uniqueDbName = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('IndexedDB data layer', () => {
  let database: LinkOSaurusDB;

  beforeEach(() => {
    database = createDatabase(uniqueDbName('test'));
  });

  afterEach(async () => {
    await database.delete();
  });

  it('performs CRUD for boards', async () => {
    const board: CreateBoardInput = {
      id: 'board-1',
      title: 'Work',
      icon: '💼',
      sortOrder: 1,
    };

    const created = await createBoard(board, database);
    expect(created.createdAt).toBeTypeOf('number');
    expect(created.updatedAt).toBeTypeOf('number');

    const boards = await listBoards(database);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.title).toBe('Work');

    const updated = await updateBoard('board-1', { title: 'Work Projects' }, database);
    expect(updated.title).toBe('Work Projects');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    await deleteBoard('board-1', database);
    expect(await listBoards(database)).toHaveLength(0);
  });

  it('performs CRUD for categories and keeps bookmark references consistent', async () => {
    await createBoard({ id: 'board-1', title: 'Personal', sortOrder: 0 }, database);
    const category: CreateCategoryInput = {
      id: 'cat-1',
      boardId: 'board-1',
      title: 'Reading',
      sortOrder: 0,
    };
    await createCategory(category, database);

    const bookmark: CreateBookmarkInput = {
      id: 'bookmark-1',
      categoryId: 'cat-1',
      url: 'https://example.com',
      title: 'Example',
      tags: ['web'],
    };
    await createBookmark(bookmark, database);

    const categories = await listCategories('board-1', database);
    expect(categories).toHaveLength(1);

    const updated = await updateCategory('cat-1', { title: 'Reading List' }, database);
    expect(updated.title).toBe('Reading List');

    await deleteCategory('cat-1', database);
    const storedBookmark = await getBookmark('bookmark-1', database);
    expect(storedBookmark?.categoryId).toBeUndefined();
  });

  it('manages tag lifecycle and usage counters', async () => {
    const created = await createTag({ path: 'Design' }, database);
    expect(created.id).toBe('design');
    expect(created.path).toBe('Design');
    expect(created.slugParts).toEqual(['design']);
    expect(created.usageCount).toBe(0);

    await incrementTagUsage('Design', database);
    let tag = await getTag('design', database);
    expect(tag?.usageCount).toBe(1);

    const updated = await updateTag('design', { usageCount: 5 }, database);
    expect(updated.usageCount).toBe(5);

    await decrementTagUsage('Design', database);
    tag = await getTag('design', database);
    expect(tag?.usageCount).toBe(4);

    await deleteTag('design', database);
    expect(await listTags(database)).toHaveLength(0);
  });

  it('filters bookmarks and updates archive flag', async () => {
    await createBookmark(
      {
        id: 'bookmark-a',
        url: 'https://a.example',
        title: 'A',
        tags: [],
        archived: true,
      },
      database,
    );
    await createBookmark(
      {
        id: 'bookmark-b',
        url: 'https://b.example',
        title: 'B',
        tags: [],
      },
      database,
    );

    const defaultList = await listBookmarks({}, database);
    expect(defaultList).toHaveLength(1);
    expect(defaultList[0]?.id).toBe('bookmark-b');

    const includeArchived: BookmarkListOptions = { includeArchived: true };
    const fullList = await listBookmarks(includeArchived, database);
    expect(fullList).toHaveLength(2);

    const updated = await updateBookmark(
      'bookmark-b',
      { archived: true } satisfies UpdateBookmarkInput,
      database,
    );
    expect(updated.archived).toBe(true);
  });

  it('adjusts tag usage counts when bookmark tags change', async () => {
    await createBookmark(
      {
        id: 'bookmark-tags-1',
        url: 'https://design.example',
        title: 'Design reference',
        tags: ['Design', 'UI'],
      },
      database,
    );

    let tags = await listTags(database);
    const findTag = (name: string) => tags.find((tag) => tag.name === name);
    expect(findTag('Design')?.usageCount).toBe(1);
    expect(findTag('UI')?.usageCount).toBe(1);

    await updateBookmark('bookmark-tags-1', { tags: ['Design', 'UX'] }, database);

    tags = await listTags(database);
    expect(findTag('Design')?.usageCount).toBe(1);
    expect(findTag('UI')?.usageCount ?? 0).toBe(0);
    expect(findTag('UX')?.usageCount).toBe(1);

    await deleteBookmark('bookmark-tags-1', database);
    tags = await listTags(database);
    expect(findTag('Design')?.usageCount ?? 0).toBe(0);
    expect(findTag('UX')?.usageCount ?? 0).toBe(0);
  });

  it('returns pinned bookmarks sorted by recency without archived entries', async () => {
    const now = Date.now();
    await createBookmark(
      {
        id: 'bookmark-pin-1',
        url: 'https://first.example',
        title: 'First',
        tags: [],
        pinned: true,
        updatedAt: now - 1_000,
      },
      database,
    );
    await createBookmark(
      {
        id: 'bookmark-pin-2',
        url: 'https://second.example',
        title: 'Second',
        tags: [],
        pinned: true,
        updatedAt: now - 200,
      },
      database,
    );
    await createBookmark(
      {
        id: 'bookmark-pin-3',
        url: 'https://archived.example',
        title: 'Archived',
        tags: [],
        pinned: true,
        archived: true,
      },
      database,
    );

    const pinned = await listPinnedBookmarks({ limit: 2 }, database);
    expect(pinned).toHaveLength(2);
    expect(pinned[0]?.id).toBe('bookmark-pin-2');
    expect(pinned[1]?.id).toBe('bookmark-pin-1');
  });

  it('performs CRUD for sessions', async () => {
    const session: CreateSessionInput = {
      id: 'session-1',
      title: 'Morning tabs',
      tabs: [
        { url: 'https://example.com', title: 'Example' },
        { url: 'https://news.example', title: 'News' },
      ],
      savedAt: Date.now(),
    };

    await createSession(session, database);
    const sessions = await listSessions(database);
    expect(sessions).toHaveLength(1);

    await updateSession('session-1', { title: 'Daily reading' }, database);
    const stored = await getSession('session-1', database);
    expect(stored?.title).toBe('Daily reading');

    await deleteSession('session-1', database);
    expect(await listSessions(database)).toHaveLength(0);
  });

  it('saves and merges user settings', async () => {
    const defaults = await getUserSettings(database);
    expect(defaults.theme).toBe('system');

    await saveUserSettings({ theme: 'dark', newTabEnabled: true }, database);
    const stored = await getUserSettings(database);
    expect(stored.theme).toBe('dark');
    expect(stored.newTabEnabled).toBe(true);
  });

  it('runs bookmark bulk write within performance budget', async () => {
    const usesFakeIndexedDb =
      typeof indexedDB !== 'undefined' && indexedDB.constructor?.name === 'FDBFactory';
    const targetCount = usesFakeIndexedDb ? 5_000 : 10_000;

    const bookmarks: CreateBookmarkInput[] = Array.from({ length: targetCount }, (_, index) => ({
      id: `bookmark-${index}`,
      url: `https://example.com/${index}`,
      title: `Bookmark ${index}`,
      tags: index % 2 === 0 ? ['even'] : ['odd'],
    }));

    const start = performance.now();
    await createBookmarks(bookmarks, database);
    const elapsed = performance.now() - start;

    const budget = usesFakeIndexedDb ? 5000 : 2000;
    expect(elapsed).toBeLessThan(budget);

    const stored = await listBookmarks({ includeArchived: true }, database);
    expect(stored).toHaveLength(targetCount);
  });

  it('migrates legacy bookmark schema by defaulting archived flag', async () => {
    const name = uniqueDbName('legacy');
    const legacyDb = new Dexie(name);
    legacyDb.version(1).stores({
      boards: 'id, sortOrder, updatedAt',
      categories: 'id, boardId, sortOrder',
      bookmarks: 'id, categoryId, pinned, createdAt, updatedAt, visitCount, lastVisitedAt, *tags',
      sessions: 'id, savedAt',
      userSettings: 'id',
    });

    await legacyDb.table('bookmarks').add({
      id: 'legacy-1',
      url: 'https://legacy.example',
      title: 'Legacy',
      tags: ['legacy'],
      visitCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await legacyDb.close();

    const upgradedDb = createDatabase(name);
    const bookmark = await getBookmark('legacy-1', upgradedDb);
    expect(bookmark?.archived).toBe(false);

    await upgradedDb.delete();
  });
});
