import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_SETTINGS,
  LinkOSaurusDB,
  clearDatabase,
  createDatabase,
} from '../db';
import {
  clearMappings,
  deleteMappingByNativeId,
  getMappingByNativeId,
  getMappingsByLocalId,
  getSyncSettings,
  listMappings,
  listMappingsByNodeType,
  putMapping,
  saveSyncSettings,
} from './store';
import type { Mapping } from './types';

describe('bookmark sync store', () => {
  let database: LinkOSaurusDB;

  beforeEach(() => {
    database = createDatabase(`bookmark-sync-${Date.now()}`);
  });

  afterEach(async () => {
    await clearDatabase(database);
    await database.delete();
  });

  const sampleMapping = (overrides: Partial<Mapping> = {}): Mapping => ({
    nativeId: 'native-1',
    localId: 'local-1',
    nodeType: 'bookmark',
    lastSyncAt: Date.now(),
    ...overrides,
  });

  it('persists mappings and queries by native/local id', async () => {
    const mapping = sampleMapping();
    await putMapping(mapping, database);

    const byNative = await getMappingByNativeId(mapping.nativeId, database);
    expect(byNative).toEqual(mapping);

    const byLocal = await getMappingsByLocalId(mapping.localId!, database);
    expect(byLocal).toHaveLength(1);
    expect(byLocal[0]).toEqual(mapping);
  });

  it('normalizes id fields and rejects invalid node types', async () => {
    const mapping = sampleMapping({
      nativeId: ' native-trim ',
      localId: ' local-trim ',
      boardId: ' board-trim ',
      categoryId: ' category-trim ',
    });

    await putMapping(mapping, database);
    const saved = await getMappingByNativeId('native-trim', database);

    expect(saved).toEqual({
      ...mapping,
      nativeId: 'native-trim',
      localId: 'local-trim',
      boardId: 'board-trim',
      categoryId: 'category-trim',
    });

    await expect(
      putMapping({ ...mapping, nodeType: 'invalid' as unknown as Mapping['nodeType'] }, database),
    ).rejects.toThrow('nodeType must be "bookmark" or "folder"');
  });

  it('lists mappings and filters by node type', async () => {
    await clearMappings(database);
    const folderMapping = sampleMapping({ nativeId: 'folder-1', nodeType: 'folder', localId: undefined });
    await putMapping(folderMapping, database);
    await putMapping(sampleMapping({ nativeId: 'bookmark-2', localId: 'local-2' }), database);

    const all = await listMappings(database);
    expect(all).toHaveLength(2);

    const folders = await listMappingsByNodeType('folder', database);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toEqual(folderMapping);
  });

  it('deletes mappings by native id', async () => {
    const mapping = sampleMapping({ nativeId: 'to-delete' });
    await putMapping(mapping, database);

    await deleteMappingByNativeId('to-delete', database);
    const remaining = await listMappings(database);
    expect(remaining).toHaveLength(0);
  });

  it('exposes sync settings with defaults and persistence', async () => {
    const defaults = await getSyncSettings(database);
    expect(defaults).toEqual(DEFAULT_SYNC_SETTINGS);

    const updated = await saveSyncSettings(
      { enableBidirectional: true, importFolderHierarchy: false, deleteBehavior: 'archive' },
      database,
    );
    expect(updated.enableBidirectional).toBe(true);
    expect(updated.importFolderHierarchy).toBe(false);
    expect(updated.deleteBehavior).toBe('archive');

    const reloaded = await getSyncSettings(database);
    expect(reloaded).toEqual(updated);
  });
});
