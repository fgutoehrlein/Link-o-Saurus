import type { UserSettings } from '../shared/types';

export const BOOKMARK_VIEW_MODES = ['list', 'tiles'] as const;

export type BookmarkViewMode = (typeof BOOKMARK_VIEW_MODES)[number];

export const GRID_MIN_TILE_WIDTH = 250;
export const GRID_MAX_COLUMNS = 6;
export const GRID_COLUMN_GAP = 14;

export const isBookmarkViewMode = (value: string): value is BookmarkViewMode =>
  BOOKMARK_VIEW_MODES.includes(value as BookmarkViewMode);

export const resolveBookmarkViewMode = (settings: UserSettings): BookmarkViewMode => {
  if (isBookmarkViewMode(settings.dashboardViewMode)) {
    return settings.dashboardViewMode;
  }
  return 'list';
};

export const getGridColumnCount = (width: number): number => {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const computed = Math.floor((safeWidth + GRID_COLUMN_GAP) / (GRID_MIN_TILE_WIDTH + GRID_COLUMN_GAP));
  return Math.min(GRID_MAX_COLUMNS, Math.max(1, computed));
};

export const toGridRows = (ids: readonly string[], columns: number): string[][] => {
  const safeColumns = Math.max(1, columns);
  const rows: string[][] = [];
  for (let index = 0; index < ids.length; index += safeColumns) {
    rows.push(ids.slice(index, index + safeColumns));
  }
  return rows;
};
