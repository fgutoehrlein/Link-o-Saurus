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
  deleteBoard,
  deleteBookmark,
  deleteCategory,
  deleteSession,
  getBookmark,
  getSession,
  getUserSettings,
  listBoards,
  listBookmarks,
  listCategories,
  listSessions,
  saveUserSettings,
  updateBoard,
  updateBookmark,
  updateCategory,
  updateSession,
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
