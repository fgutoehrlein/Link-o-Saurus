import { db, DEFAULT_SYNC_SETTINGS, LinkOSaurusDB, getUserSettings, saveUserSettings } from '../db';
import type { Mapping, NativeId, LocalId, NodeType, SyncSettings } from './types';

const withDatabase = (database?: LinkOSaurusDB): LinkOSaurusDB => database ?? db;

const ensureTrimmed = (value: string, label: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must not be empty`);
  }
  return trimmed;
};

const ensureTimestamp = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error('lastSyncAt must be a finite number');
  }
  return Math.floor(value);
};

const normalizeMapping = (mapping: Mapping): Mapping => ({
  nativeId: ensureTrimmed(mapping.nativeId, 'nativeId'),
  localId: typeof mapping.localId === 'string' ? mapping.localId.trim() || undefined : undefined,
  nodeType: mapping.nodeType,
  boardId: typeof mapping.boardId === 'string' ? mapping.boardId : undefined,
  categoryId: typeof mapping.categoryId === 'string' ? mapping.categoryId : undefined,
  lastSyncAt: ensureTimestamp(mapping.lastSyncAt),
});

const cloneMapping = (mapping: Mapping): Mapping => ({ ...mapping });

export const putMapping = async (
  mapping: Mapping,
  database?: LinkOSaurusDB,
): Promise<Mapping> => {
  const dbInstance = withDatabase(database);
  const record = normalizeMapping(mapping);
  await dbInstance.bookmarkMappings.put(record);
  return cloneMapping(record);
};

export const deleteMappingByNativeId = async (
  nativeId: NativeId,
  database?: LinkOSaurusDB,
): Promise<void> => {
  const dbInstance = withDatabase(database);
  const key = ensureTrimmed(nativeId, 'nativeId');
  await dbInstance.bookmarkMappings.delete(key);
};

export const getMappingByNativeId = async (
  nativeId: NativeId,
  database?: LinkOSaurusDB,
): Promise<Mapping | undefined> => {
  const dbInstance = withDatabase(database);
  const key = ensureTrimmed(nativeId, 'nativeId');
  const record = await dbInstance.bookmarkMappings.get(key);
  return record ? cloneMapping(record) : undefined;
};

export const getMappingsByLocalId = async (
  localId: LocalId,
  database?: LinkOSaurusDB,
): Promise<Mapping[]> => {
  const dbInstance = withDatabase(database);
  const key = ensureTrimmed(localId, 'localId');
  const records = await dbInstance.bookmarkMappings.where('localId').equals(key).toArray();
  return records.map(cloneMapping);
};

export const listMappings = async (database?: LinkOSaurusDB): Promise<Mapping[]> => {
  const dbInstance = withDatabase(database);
  const records = await dbInstance.bookmarkMappings.toArray();
  return records.map(cloneMapping);
};

export const listMappingsByNodeType = async (
  nodeType: NodeType,
  database?: LinkOSaurusDB,
): Promise<Mapping[]> => {
  const dbInstance = withDatabase(database);
  const records = await dbInstance.bookmarkMappings.where('nodeType').equals(nodeType).toArray();
  return records.map(cloneMapping);
};

export const clearMappings = async (database?: LinkOSaurusDB): Promise<void> => {
  const dbInstance = withDatabase(database);
  await dbInstance.bookmarkMappings.clear();
};

export const getSyncSettings = async (
  database?: LinkOSaurusDB,
): Promise<SyncSettings> => {
  const dbInstance = withDatabase(database);
  const settings = await getUserSettings(dbInstance);
  return { ...DEFAULT_SYNC_SETTINGS, ...settings.bookmarkSync };
};

export const saveSyncSettings = async (
  changes: Partial<SyncSettings>,
  database?: LinkOSaurusDB,
): Promise<SyncSettings> => {
  const dbInstance = withDatabase(database);
  const current = await getSyncSettings(dbInstance);
  const next: SyncSettings = { ...current, ...changes };
  await saveUserSettings({ bookmarkSync: next }, dbInstance);
  return { ...next };
};
