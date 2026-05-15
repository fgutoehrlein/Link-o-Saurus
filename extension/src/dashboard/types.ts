import type { Bookmark, Board, Category } from '../shared/types';
import type { TagFilterMode, TagFilterState } from '../shared/tag-filter';

export type BookmarkListEntry = {
  readonly id: string;
  readonly bookmark: Bookmark;
  readonly category?: Category;
  readonly board?: Board;
};

export type BookmarkListData = {
  readonly ids: readonly string[];
  readonly bookmarkById: Map<string, BookmarkListEntry>;
  readonly setRowHeight: (rowIndex: number, height: number) => void;
  readonly selected: Set<string>;
  readonly onRowClick: (event: MouseEvent | KeyboardEvent, id: string) => void;
  readonly onOpenBookmark: (bookmark: Bookmark) => void;
  readonly onRowContextMenu: (event: MouseEvent, id: string) => void;
  readonly onDragStart: (event: DragEvent, id: string) => void;
  readonly activeTagFilters: TagFilterState;
  readonly onTagFilterAction: (event: MouseEvent | KeyboardEvent, tag: string, mode: TagFilterMode) => void;
};

export type BookmarkTileListData = Omit<BookmarkListData, 'ids' | 'setRowHeight'> & {
  readonly rows: readonly (readonly string[])[];
  readonly columnCount: number;
  readonly setRowHeight: (rowIndex: number, height: number) => void;
};
