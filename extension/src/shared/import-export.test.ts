import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createBoard, createCategory, createBookmark, LinkOSaurusDB } from './db';
import { exportToJson, importFromJson, importFromNetscapeHtml } from './import-export';
import type { Bookmark } from './types';

const uniqueDbName = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createFile = (content: string, name: string, type: string): File => {
  return new File([content], name, { type });
};

describe('import/export workflow', () => {
  let database: LinkOSaurusDB;

  beforeEach(() => {
    database = createDatabase(uniqueDbName('import-export'));
  });

  afterEach(async () => {
    await database.delete();
  });

  it('imports Netscape HTML files with deduplication', async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><H3>Work</H3>
      <DL><p>
        <DT><A HREF="https://example.com" ADD_DATE="1700000000">Example</A>
        <DT><A HREF="https://example.com" ADD_DATE="1700000100">Example Duplicate</A>
        <DT><A HREF="https://example.com/docs" ADD_DATE="1700000200">Docs</A>
      </DL><p>
    </DL><p>`;

    const file = createFile(html, 'bookmarks.html', 'text/html');
    const result = await importFromNetscapeHtml(file, { dedupe: true }, undefined, database);

    expect(result.stats.processedBookmarks).toBe(3);
    expect(result.stats.createdBookmarks).toBe(2);
    expect(result.stats.duplicateBookmarks).toBe(1);

    const stored = await database.bookmarks.toArray();
    expect(stored).toHaveLength(2);
    const urls = stored.map((bookmark) => bookmark.url).sort();
    expect(urls).toEqual(['https://example.com/', 'https://example.com/docs']);
  });

  it('re-imports exported JSON data without losing content', async () => {
    const board = await createBoard({ id: 'board-1', title: 'Reading', sortOrder: 0 }, database);
    const category = await createCategory(
      { id: 'category-1', boardId: board.id, title: 'Articles', sortOrder: 0 },
      database,
    );
    await createBookmark(
      {
        id: 'bookmark-1',
        categoryId: category.id,
        url: 'https://example.com/article',
        title: 'Interesting Article',
        tags: ['reading', 'research'],
        notes: 'Must read again',
      },
      database,
    );

    const exportPayload = await exportToJson(database);
    const exportFile = createFile(JSON.stringify(exportPayload), 'backup.json', 'application/json');

    const importedDb = createDatabase(uniqueDbName('imported'));
    try {
      const importResult = await importFromJson(exportFile, { dedupe: false }, undefined, importedDb);
      expect(importResult.stats.createdBookmarks).toBe(1);

      const [originalBookmarks, importedBookmarks] = await Promise.all([
        database.bookmarks.toArray(),
        importedDb.bookmarks.toArray(),
      ]);

      const normalize = (bookmark: Bookmark) => ({
        title: bookmark.title,
        url: bookmark.url,
        notes: bookmark.notes,
        tags: bookmark.tags,
        archived: bookmark.archived,
        pinned: bookmark.pinned,
      });

      expect(importedBookmarks.map(normalize)).toEqual(originalBookmarks.map(normalize));
    } finally {
      await importedDb.delete();
    }
  });
});
