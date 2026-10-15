import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db';
import type { SyncSnapshotV1 } from './types';
import { collectSyncSnapshot, mergeSyncSnapshots, validateSyncSnapshot } from './snapshot';

const bookmark = (title: string) => ({
  id: 'bookmark-1',
  categoryId: 'category-1',
  url: 'https://example.com/',
  title,
  tags: ['reading'],
  createdAt: 1,
  updatedAt: 1,
  visitCount: 0,
});

const snapshot = (bookmarks = [bookmark('Example')]): SyncSnapshotV1 => ({
  format: 'link-o-saurus-sync',
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  boards: [{ id: 'board-1', title: 'Reading', sortOrder: 0, createdAt: 1, updatedAt: 1 }],
  categories: [{ id: 'category-1', boardId: 'board-1', title: 'Articles', sortOrder: 0 }],
  bookmarks,
  tags: [{ id: 'reading', name: 'reading', path: 'reading', slugParts: ['reading'], usageCount: 1 }],
  comments: [{ id: 'comment-1', bookmarkId: 'bookmark-1', author: 'Me', body: 'Useful', createdAt: 1 }],
  readLater: [{ bookmarkId: 'bookmark-1', dueAt: 2 }],
  sessions: [{ id: 'session-1', title: 'Research', savedAt: 1, tabs: [{ url: 'https://example.com/', title: 'Example' }] }],
});

describe('GitHub sync snapshots', () => {
  it('collects the supported data collections without local settings or mappings', async () => {
    const database = createDatabase(`snapshot-${crypto.randomUUID()}`);
    try {
      await database.boards.put(snapshot().boards[0]!);
      await database.categories.put(snapshot().categories[0]!);
      await database.bookmarks.put(bookmark('Example'));
      await database.tags.put(snapshot().tags[0]!);
      await database.comments.put(snapshot().comments[0]!);
      await database.readLater.put(snapshot().readLater[0]!);
      await database.sessions.put(snapshot().sessions[0]!);
      await database.bookmarkMappings.put({ nativeId: 'native-1', nodeType: 'bookmark', localId: 'bookmark-1', lastSyncAt: 1 });
      await database.userSettings.put({
        id: 'user-settings',
        theme: 'system',
        language: 'auto',
        dashboardViewMode: 'list',
        bookmarkSortMode: 'relevance',
        newTabEnabled: false,
        bookmarkSync: {
          enableBidirectional: false,
          mirrorRootName: 'Link-O-Saurus',
          importFolderHierarchy: true,
          conflictPolicy: 'last-writer-wins',
          deleteBehavior: 'delete',
        },
      });

      const collected = await collectSyncSnapshot(database);
      expect(collected).toMatchObject({
        boards: snapshot().boards,
        categories: snapshot().categories,
        bookmarks: [bookmark('Example')],
        tags: snapshot().tags,
        comments: snapshot().comments,
        readLater: snapshot().readLater,
        sessions: snapshot().sessions,
      });
      expect('bookmarkMappings' in collected).toBe(false);
      expect('userSettings' in collected).toBe(false);
    } finally {
      await database.delete();
    }
  });

  it('accepts a valid snapshot and preserves its data', () => {
    expect(validateSyncSnapshot(snapshot())).toEqual(snapshot());
  });

  it('rejects duplicate IDs and broken bookmark references', () => {
    const invalid = snapshot([
      bookmark('First'),
      { ...bookmark('Second') },
    ]);
    expect(() => validateSyncSnapshot(invalid)).toThrow(/duplicate/i);

    const broken = snapshot();
    broken.bookmarks[0]!.categoryId = 'missing-category';
    expect(() => validateSyncSnapshot(broken)).toThrow(/category/i);
  });

  it('combines independent changes and resolves a one-sided deletion', () => {
    const base = snapshot();
    const local = snapshot();
    const remote = snapshot([
      bookmark('Example'),
      { ...bookmark('Remote addition'), id: 'bookmark-remote' },
    ]);
    local.boards[0]!.title = 'Local board edit';

    const result = mergeSyncSnapshots(base, local, remote);

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.boards[0]?.title).toBe('Local board edit');
    expect(result.snapshot.bookmarks.map((item) => item.id).sort()).toEqual(['bookmark-1', 'bookmark-remote']);
  });

  it('keeps a local deletion when the remote record is unchanged', () => {
    const base = snapshot();
    const deleted = snapshot([]);
    deleted.comments = [];
    deleted.readLater = [];

    const result = mergeSyncSnapshots(base, deleted, snapshot());

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.bookmarks).toEqual([]);
    expect(result.snapshot.comments).toEqual([]);
    expect(result.snapshot.readLater).toEqual([]);
  });

  it('reports edits to the same record and delete-versus-edit conflicts', () => {
    const base = snapshot();
    const local = snapshot([bookmark('Local edit')]);
    const remote = snapshot([bookmark('Remote edit')]);
    const editConflict = mergeSyncSnapshots(base, local, remote);
    expect(editConflict.conflicts).toHaveLength(1);
    expect(editConflict.conflicts[0]).toMatchObject({
      collection: 'bookmarks',
      id: 'bookmark-1',
      local: expect.objectContaining({ title: 'Local edit' }),
      remote: expect.objectContaining({ title: 'Remote edit' }),
    });
    const remoteWins = mergeSyncSnapshots(base, local, remote, { 'bookmarks/bookmark-1': 'remote' });
    expect(remoteWins.snapshot.bookmarks[0]?.title).toBe('Remote edit');

    const deleteConflict = mergeSyncSnapshots(base, snapshot([]), remote);
    expect(deleteConflict.conflicts).toHaveLength(1);
    expect(deleteConflict.conflicts[0]?.local).toBeNull();
  });

  it('treats deleting a bookmark with locally changed notes as one parent conflict', () => {
    const base = snapshot();
    const local = snapshot();
    local.comments[0]!.body = 'Updated note';
    const remote = snapshot([]);
    remote.comments = [];
    remote.readLater = [];

    const unresolved = mergeSyncSnapshots(base, local, remote);
    expect(unresolved.conflicts.map((conflict) => conflict.key)).toEqual(['bookmarks/bookmark-1']);
    expect(unresolved.snapshot.bookmarks).toHaveLength(1);
    expect(unresolved.snapshot.comments[0]?.body).toBe('Updated note');

    const remoteWins = mergeSyncSnapshots(base, local, remote, { 'bookmarks/bookmark-1': 'remote' });
    expect(remoteWins.snapshot.bookmarks).toEqual([]);
    expect(remoteWins.snapshot.comments).toEqual([]);
    expect(remoteWins.snapshot.readLater).toEqual([]);
  });
});
