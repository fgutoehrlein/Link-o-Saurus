import type { UserSettings } from '../shared/types';

export const BOOKMARK_VIEW_MODES = ['list', 'tiles'] as const;

export type BookmarkViewMode = (typeof BOOKMARK_VIEW_MODES)[number];

export const isBookmarkViewMode = (value: string): value is BookmarkViewMode =>
  BOOKMARK_VIEW_MODES.includes(value as BookmarkViewMode);

export const resolveBookmarkViewMode = (settings: UserSettings): BookmarkViewMode => {
  if (isBookmarkViewMode(settings.dashboardViewMode)) {
    return settings.dashboardViewMode;
  }
  return 'list';
};

export const getGridColumnCount = (width: number): number => {
  if (width >= 1280) {
    return 4;
  }
  if (width >= 960) {
    return 3;
  }
  if (width >= 640) {
    return 2;
  }
  return 1;
};

export const toGridRows = (ids: readonly string[], columns: number): string[][] => {
  const safeColumns = Math.max(1, columns);
  const rows: string[][] = [];
  for (let index = 0; index < ids.length; index += safeColumns) {
    rows.push(ids.slice(index, index + safeColumns));
  }
  return rows;
};
