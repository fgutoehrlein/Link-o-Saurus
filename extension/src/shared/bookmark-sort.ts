import type { Bookmark, BookmarkSortMode } from './types';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RECENCY_DECAY_DAYS = 14;

const safeTimestamp = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return value;
};

const toSortableTitle = (bookmark: Bookmark): string => {
  const title = bookmark.title.trim();
  return title || bookmark.url;
};

const buildAlphabeticalCollator = (): Intl.Collator =>
  new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true });

const computeRelevanceScore = (bookmark: Bookmark, now: number): number => {
  const visits = Math.max(0, bookmark.visitCount ?? 0);
  const lastActivity = Math.max(
    safeTimestamp(bookmark.lastVisitedAt),
    safeTimestamp(bookmark.updatedAt),
    safeTimestamp(bookmark.createdAt),
  );
  const age = Math.max(0, now - lastActivity);
  const ageDays = age / DAY_IN_MS;
  const recencyWeight = Math.exp(-ageDays / RECENCY_DECAY_DAYS);
  const frequencyWeight = Math.log2(visits + 1);
  return frequencyWeight * (0.6 + recencyWeight) + recencyWeight * 2;
};

export const compareBookmarksBySortMode = (
  left: Bookmark,
  right: Bookmark,
  sortMode: BookmarkSortMode,
  now: number,
  collator: Intl.Collator = buildAlphabeticalCollator(),
): number => {
  if (sortMode === 'alphabetical') {
    return (
      collator.compare(toSortableTitle(left), toSortableTitle(right)) ||
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt ||
      left.id.localeCompare(right.id)
    );
  }

  if (sortMode === 'newest') {
    return (
      right.createdAt - left.createdAt ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id)
    );
  }

  const scoreDiff = computeRelevanceScore(right, now) - computeRelevanceScore(left, now);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  return (
    safeTimestamp(right.lastVisitedAt) - safeTimestamp(left.lastVisitedAt) ||
    right.visitCount - left.visitCount ||
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
};

export const sortBookmarks = (
  bookmarks: readonly Bookmark[],
  sortMode: BookmarkSortMode,
  now = Date.now(),
): Bookmark[] => {
  const collator = buildAlphabeticalCollator();
  return [...bookmarks].sort((left, right) =>
    compareBookmarksBySortMode(left, right, sortMode, now, collator),
  );
};
