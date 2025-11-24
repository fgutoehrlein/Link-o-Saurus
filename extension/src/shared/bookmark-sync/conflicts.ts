import type { Bookmark } from '../types';
import type { SyncSettings } from './types';

export type ConflictField = 'title' | 'url' | 'folder';

export type ConflictResolution<T> = {
  readonly value: T;
  readonly source: 'local' | 'native';
};

const nowMs = () => Date.now();

const resolveTimestamp = (
  localUpdatedAt: number | undefined,
  nativeUpdatedAt: number | undefined,
): number => {
  if (typeof nativeUpdatedAt === 'number') {
    return nativeUpdatedAt;
  }
  if (typeof localUpdatedAt === 'number') {
    return localUpdatedAt;
  }
  return nowMs();
};

export const resolveConflict = <T>(
  field: ConflictField,
  localValue: T,
  localUpdatedAt: number | undefined,
  nativeValue: T,
  nativeUpdatedAt: number | undefined,
  settings: SyncSettings,
): ConflictResolution<T> => {
  if (settings.conflictPolicy !== 'last-writer-wins') {
    return { value: localValue, source: 'local' };
  }

  const effectiveNative = resolveTimestamp(localUpdatedAt, nativeUpdatedAt);
  const effectiveLocal = typeof localUpdatedAt === 'number' ? localUpdatedAt : effectiveNative;

  if (effectiveNative > effectiveLocal) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[bookmark-sync] native wins for ${field}`);
    }
    return { value: nativeValue, source: 'native' };
  }

  if (process.env.NODE_ENV === 'development') {
    console.debug(`[bookmark-sync] local wins for ${field}`);
  }
  return { value: localValue, source: 'local' };
};

export const resolveBookmarkConflict = (
  bookmark: Bookmark,
  native: { title?: string | null; url?: string | null; updatedAt?: number | undefined },
  settings: SyncSettings,
): { title: string; url: string; updatedAt: number } => {
  const resolvedTitle = resolveConflict(
    'title',
    bookmark.title,
    bookmark.updatedAt,
    native.title ?? bookmark.title,
    native.updatedAt,
    settings,
  );
  const resolvedUrl = resolveConflict(
    'url',
    bookmark.url,
    bookmark.updatedAt,
    native.url ?? bookmark.url,
    native.updatedAt,
    settings,
  );

  const updatedAt =
    resolvedTitle.source === 'native' || resolvedUrl.source === 'native'
      ? resolveTimestamp(bookmark.updatedAt, native.updatedAt)
      : bookmark.updatedAt;

  return { title: resolvedTitle.value, url: resolvedUrl.value, updatedAt };
};
