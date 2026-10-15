import type { LinkOSaurusDB } from '../db';
import type { SyncCollectionName, SyncConflict, SyncMergeResult, SyncSnapshotV1 } from './types';

const collections: readonly SyncCollectionName[] = [
  'boards',
  'categories',
  'bookmarks',
  'tags',
  'comments',
  'readLater',
  'sessions',
];

const keyOf = (collection: SyncCollectionName, value: Record<string, unknown>): string =>
  collection === 'readLater' ? String(value.bookmarkId) : String(value.id);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, key: string, path: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return value;
};

const finiteNumber = (record: Record<string, unknown>, key: string, path: string): void => {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
};

const stringArray = (record: Record<string, unknown>, key: string, path: string): void => {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${path}.${key} must be an array of strings`);
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const equal = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

export const syncSnapshotsHaveSameData = (left: SyncSnapshotV1, right: SyncSnapshotV1): boolean =>
  collections.every((collection) => equal(left[collection], right[collection]));

export const collectSyncSnapshot = async (database: LinkOSaurusDB): Promise<SyncSnapshotV1> => {
  const data = await database.transaction('r', [
    database.boards,
    database.categories,
    database.bookmarks,
    database.tags,
    database.comments,
    database.readLater,
    database.sessions,
  ], () => Promise.all([
    database.boards.toArray(),
    database.categories.toArray(),
    database.bookmarks.toArray(),
    database.tags.toArray(),
    database.comments.toArray(),
    database.readLater.toArray(),
    database.sessions.toArray(),
  ]));
  const [boards, categories, bookmarks, tags, comments, readLater, sessions] = data;
  return validateSyncSnapshot({
    format: 'link-o-saurus-sync',
    version: 1,
    exportedAt: new Date().toISOString(),
    boards,
    categories,
    bookmarks,
    tags,
    comments,
    readLater,
    sessions,
  });
};

export const validateSyncSnapshot = (value: unknown): SyncSnapshotV1 => {
  if (!isObject(value) || value.format !== 'link-o-saurus-sync' || value.version !== 1) {
    throw new Error('Unsupported Link-o-Saurus sync snapshot format or version');
  }
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error('Snapshot exportedAt must be a valid date');
  }

  const ids = new Map<SyncCollectionName, Set<string>>();
  for (const collection of collections) {
    const records = value[collection];
    if (!Array.isArray(records)) throw new Error(`Snapshot ${collection} must be an array`);
    const seen = new Set<string>();
    ids.set(collection, seen);
    for (const [index, raw] of records.entries()) {
      const path = `${collection}[${index}]`;
      if (!isObject(raw)) throw new Error(`${path} must be an object`);
      const id = requiredString(raw, collection === 'readLater' ? 'bookmarkId' : 'id', path);
      if (seen.has(id)) throw new Error(`${collection} contains duplicate ID ${id}`);
      seen.add(id);
      validateRecord(collection, raw, path);
    }
  }

  const boardIds = ids.get('boards')!;
  const categoryIds = ids.get('categories')!;
  const bookmarkIds = ids.get('bookmarks')!;
  for (const category of value.categories as Record<string, unknown>[]) {
    if (!boardIds.has(String(category.boardId))) throw new Error(`Category ${String(category.id)} references a missing board`);
  }
  for (const bookmark of value.bookmarks as Record<string, unknown>[]) {
    if (bookmark.categoryId !== undefined && !categoryIds.has(String(bookmark.categoryId))) {
      throw new Error(`Bookmark ${String(bookmark.id)} references a missing category`);
    }
  }
  for (const comment of value.comments as Record<string, unknown>[]) {
    if (!bookmarkIds.has(String(comment.bookmarkId))) throw new Error(`Comment ${String(comment.id)} references a missing bookmark`);
  }
  for (const entry of value.readLater as Record<string, unknown>[]) {
    if (!bookmarkIds.has(String(entry.bookmarkId))) throw new Error(`Read-later entry references a missing bookmark`);
  }
  return value as unknown as SyncSnapshotV1;
};

const validateRecord = (collection: SyncCollectionName, value: Record<string, unknown>, path: string): void => {
  switch (collection) {
    case 'boards':
      requiredString(value, 'title', path);
      finiteNumber(value, 'sortOrder', path);
      finiteNumber(value, 'createdAt', path);
      finiteNumber(value, 'updatedAt', path);
      break;
    case 'categories':
      requiredString(value, 'boardId', path);
      requiredString(value, 'title', path);
      finiteNumber(value, 'sortOrder', path);
      break;
    case 'bookmarks':
      requiredString(value, 'url', path);
      requiredString(value, 'title', path);
      stringArray(value, 'tags', path);
      finiteNumber(value, 'createdAt', path);
      finiteNumber(value, 'updatedAt', path);
      finiteNumber(value, 'visitCount', path);
      break;
    case 'tags':
      requiredString(value, 'name', path);
      requiredString(value, 'path', path);
      stringArray(value, 'slugParts', path);
      finiteNumber(value, 'usageCount', path);
      break;
    case 'comments':
      requiredString(value, 'bookmarkId', path);
      requiredString(value, 'author', path);
      requiredString(value, 'body', path);
      finiteNumber(value, 'createdAt', path);
      break;
    case 'readLater':
      finiteNumber(value, 'dueAt', path);
      break;
    case 'sessions':
      requiredString(value, 'title', path);
      finiteNumber(value, 'savedAt', path);
      if (!Array.isArray(value.tabs)) throw new Error(`${path}.tabs must be an array`);
      for (const [index, tab] of value.tabs.entries()) {
        if (!isObject(tab)) throw new Error(`${path}.tabs[${index}] must be an object`);
        requiredString(tab, 'url', `${path}.tabs[${index}]`);
      }
      break;
  }
};

export const mergeSyncSnapshots = (
  base: SyncSnapshotV1,
  local: SyncSnapshotV1,
  remote: SyncSnapshotV1,
  resolutions: Record<string, 'local' | 'remote'> = {},
): SyncMergeResult => {
  const conflicts: SyncConflict[] = [];
  const merged = {
    format: 'link-o-saurus-sync',
    version: 1,
    exportedAt: new Date().toISOString(),
  } as SyncSnapshotV1;

  for (const collection of collections) {
    const baseMap = new Map(base[collection].map((record) => [keyOf(collection, record as unknown as Record<string, unknown>), record]));
    const localMap = new Map(local[collection].map((record) => [keyOf(collection, record as unknown as Record<string, unknown>), record]));
    const remoteMap = new Map(remote[collection].map((record) => [keyOf(collection, record as unknown as Record<string, unknown>), record]));
    const keys = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    const records: unknown[] = [];

    for (const id of keys) {
      const original = baseMap.get(id) ?? null;
      const localRecord = localMap.get(id) ?? null;
      const remoteRecord = remoteMap.get(id) ?? null;
      const localChanged = !equal(localRecord, original);
      const remoteChanged = !equal(remoteRecord, original);
      if (localChanged && remoteChanged && !equal(localRecord, remoteRecord)) {
        const key = `${collection}/${id}`;
        conflicts.push({ collection, id, key, base: original, local: localRecord, remote: remoteRecord });
        const choice = resolutions[key] === 'remote' ? remoteRecord : resolutions[key] === 'local' ? localRecord : (localRecord ?? remoteRecord);
        const provisional = choice;
        if (provisional !== null) records.push(provisional);
      } else {
        const selected = localChanged ? localRecord : remoteRecord;
        if (selected !== null) records.push(selected);
      }
    }
    (merged as unknown as Record<SyncCollectionName, unknown[]>)[collection] = records;
  }

  const bookmarkIds = new Set(merged.bookmarks.map((bookmark) => bookmark.id));
  const orphanedBookmarkIds = new Set([
    ...merged.comments.map((comment) => comment.bookmarkId),
    ...merged.readLater.map((entry) => entry.bookmarkId),
  ].filter((id) => !bookmarkIds.has(id)));
  for (const id of orphanedBookmarkIds) {
    const key = `bookmarks/${id}`;
    const baseRecord = base.bookmarks.find((record) => record.id === id) ?? null;
    const localRecord = local.bookmarks.find((record) => record.id === id) ?? null;
    const remoteRecord = remote.bookmarks.find((record) => record.id === id) ?? null;
    if (!conflicts.some((conflict) => conflict.key === key)) {
      conflicts.push({ collection: 'bookmarks', id, key, base: baseRecord, local: localRecord, remote: remoteRecord });
    }
    const choice = resolutions[key];
    const selectedParent = choice === 'remote'
      ? remoteRecord
      : choice === 'local'
        ? localRecord
        : localRecord ?? remoteRecord ?? baseRecord;
    const selectedSide = choice === 'remote' || (!localRecord && remoteRecord) ? remote : local;
    const childConflicts = new Set(conflicts
      .filter((conflict) => (conflict.collection === 'comments' || conflict.collection === 'readLater')
        && (conflict.local as { bookmarkId?: string } | null)?.bookmarkId === id)
      .map((conflict) => conflict.key));
    for (let index = conflicts.length - 1; index >= 0; index -= 1) {
      if (childConflicts.has(conflicts[index]!.key)) conflicts.splice(index, 1);
    }

    merged.bookmarks = merged.bookmarks.filter((record) => record.id !== id);
    if (selectedParent) merged.bookmarks.push(selectedParent);
    merged.comments = merged.comments.filter((record) => record.bookmarkId !== id);
    merged.readLater = merged.readLater.filter((record) => record.bookmarkId !== id);
    if (selectedParent) {
      merged.comments.push(...selectedSide.comments.filter((record) => record.bookmarkId === id));
      merged.readLater.push(...selectedSide.readLater.filter((record) => record.bookmarkId === id));
    }
  }

  return { snapshot: validateSyncSnapshot(merged), conflicts };
};
