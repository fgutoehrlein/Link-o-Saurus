import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDatabase, createDatabase, LinkOSaurusDB } from '../db';
import type { Board, Category } from '../types';
import { getMappingByNativeId, listMappings } from './store';
import { initialImport, mirrorRootId, resetMirrorRootIdForTests } from './initial-import';
import { ensureMirrorRoot, getTree } from './native';

vi.mock('./native', () => ({
  getTree: vi.fn(),
  ensureMirrorRoot: vi.fn(),
}));

const mockedGetTree = vi.mocked(getTree);
const mockedEnsureMirrorRoot = vi.mocked(ensureMirrorRoot);

const folder = (
  id: string,
  title: string,
  children: chrome.bookmarks.BookmarkTreeNode[] = [],
): chrome.bookmarks.BookmarkTreeNode => ({ id, title, children });

const bookmark = (id: string, title: string, url: string): chrome.bookmarks.BookmarkTreeNode => ({
  id,
  title,
  url,
  dateAdded: Date.now(),
});

describe('initialImport', () => {
  let database: LinkOSaurusDB;

  beforeEach(() => {
    database = createDatabase(`initial-import-${Date.now()}`);
    mockedEnsureMirrorRoot.mockResolvedValue('mirror-root-id');
    resetMirrorRootIdForTests();
  });

  afterEach(async () => {
    await clearDatabase(database);
    await database.delete();
    vi.clearAllMocks();
  });

  const findBoard = async (title: string): Promise<Board> => {
    const boards = await database.boards.toArray();
    const match = boards.find((board) => board.title === title);
    if (!match) {
      throw new Error(`Board ${title} not found`);
    }
    return match;
  };

  const findCategory = async (board: Board, title: string): Promise<Category> => {
    const categories = await database.categories.where('boardId').equals(board.id).toArray();
    const match = categories.find((category) => category.title === title);
    if (!match) {
      throw new Error(`Category ${title} not found on board ${board.title}`);
    }
    return match;
  };

  it('imports bookmark tree hierarchy and dedupes canonical URLs', async () => {
    const tree = [
      folder('root', 'root', [
        folder('work-folder', 'Work', [
          folder('js-folder', 'JS', [
            bookmark('b-work-dup1', 'Example Duplicate', 'https://example.com/a?utm_source=test'),
            bookmark('b-work-1', 'JS Handbook', 'https://example.com/js-handbook'),
            bookmark('b-work-2', 'TS Deep Dive', 'https://example.com/ts'),
            folder('deep-folder', 'Deep', [
              bookmark('b-work-deep', 'Deep Link', 'https://example.com/deep'),
            ]),
          ]),
          folder('docs-folder', 'Docs', [
            bookmark('b-work-3', 'MDN', 'https://developer.mozilla.org'),
            bookmark('b-work-4', 'Spec', 'https://whatwg.org/spec'),
            bookmark('b-work-5', 'RFC', 'https://www.rfc-editor.org'),
          ]),
          bookmark('b-work-direct', 'Root Work Link', 'https://work.example.com'),
        ]),
        folder('personal-folder', 'Personal', [
          folder('reads-folder', 'Reads', [
            bookmark('b-personal-dup1', 'Another Duplicate', 'https://another.test/path?utm_campaign=fall'),
            bookmark('b-personal-dup2', 'Duplicate Raw', 'https://another.test/path'),
            bookmark('b-personal-1', 'Articles', 'https://news.ycombinator.com'),
            bookmark('b-personal-2', 'Blogs', 'https://example.net/blogs'),
          ]),
          bookmark('b-personal-direct', 'Personal Root Link', 'https://personal.example.com'),
        ]),
        folder('play-folder', 'Play', [
          folder('games-folder', 'Games', [
            bookmark('b-play-dup2', 'Duplicate Copy', 'https://example.com/a?utm_medium=email'),
            bookmark('b-play-1', 'Indie', 'https://indie.games'),
            bookmark('b-play-2', 'AAA', 'https://aaa.games'),
          ]),
          folder('music-folder', 'Music', [
            bookmark('b-play-3', 'Indie Music', 'https://music.example.com/indie'),
            bookmark('b-play-4', 'Classical', 'https://music.example.com/classical'),
          ]),
        ]),
        bookmark('b-root-dup3', 'Root Duplicate', 'https://example.com/a?utm_content=footer'),
        bookmark('b-root-unique', 'Root Unique', 'https://root.unique.example'),
      ]),
    ];

    mockedGetTree.mockResolvedValue(tree);

    await initialImport({ importFolderHierarchy: true, database });

    expect(mirrorRootId).toBe('mirror-root-id');

    const boards = await database.boards.toArray();
    expect(boards.map((board) => board.title).sort()).toEqual([
      'Imported',
      'Personal',
      'Play',
      'Work',
    ]);

    const categories = await database.categories.toArray();
    expect(categories.map((category) => category.title).sort()).toEqual([
      'Docs',
      'Games',
      'JS',
      'Music',
      'Reads',
      'Unfiled',
    ]);

    const bookmarks = await database.bookmarks.toArray();
    expect(bookmarks).toHaveLength(17);
    expect(new Set(bookmarks.map((bookmark) => bookmark.url)).size).toBe(17);

    const workBoard = await findBoard('Work');
    const workJsCategory = await findCategory(workBoard, 'JS');
    const deepBookmark = bookmarks.find((entry) => entry.url === 'https://example.com/deep');
    expect(deepBookmark?.categoryId).toBe(workJsCategory.id);
    expect(deepBookmark?.notes).toContain('Imported from path: root / Work / JS / Deep');

    const mappingForFolder = await getMappingByNativeId('js-folder', database);
    expect(mappingForFolder?.nodeType).toBe('folder');
    expect(mappingForFolder?.categoryId).toBe(workJsCategory.id);

    const rootDuplicateMapping = await getMappingByNativeId('b-root-dup3', database);
    const firstDuplicateMapping = await getMappingByNativeId('b-work-dup1', database);
    expect(rootDuplicateMapping?.localId).toBe(firstDuplicateMapping?.localId);

    const mappings = await listMappings(database);
    expect(mappings).toHaveLength(30);
  });
});
