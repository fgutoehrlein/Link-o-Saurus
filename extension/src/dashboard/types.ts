import type { Bookmark, Board, Category } from '../shared/types';
import type { TagFilterMode, TagFilterState } from '../shared/tag-filter';

export type BookmarkListEntry = {
  readonly id: string;
  readonly bookmark: Bookmark;
  readonly category?: Category;
  readonly board?: Board;
};

export type FolderNode = {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
  readonly children: readonly TreeNode[];
};

export type BookmarkNode = {
  readonly id: string;
  readonly bookmarkId: string;
  readonly depth: number;
};

export type TreeNode = FolderNode | BookmarkNode;

export type VisibleRow =
  | { readonly kind: 'folder'; readonly id: string; readonly title: string; readonly depth: number; readonly hasChildren: boolean; readonly expanded: boolean }
  | { readonly kind: 'bookmark'; readonly id: string; readonly bookmarkId: string; readonly depth: number };

export type BookmarkListData = {
  readonly rows: readonly VisibleRow[];
  readonly bookmarkById: Map<string, BookmarkListEntry>;
  readonly setRowHeight: (rowIndex: number, height: number) => void;
  readonly selected: Set<string>;
  readonly onRowClick: (event: MouseEvent | KeyboardEvent, id: string) => void;
  readonly onOpenBookmark: (bookmark: Bookmark) => void;
  readonly onRowContextMenu: (event: MouseEvent, id: string) => void;
  readonly onDragStart: (event: DragEvent, id: string) => void;
  readonly activeTagFilters: TagFilterState;
  readonly onTagFilterAction: (event: MouseEvent | KeyboardEvent, tag: string, mode: TagFilterMode) => void;
  readonly onToggleFolder: (folderId: string) => void;
};

export type BookmarkTileListData = Omit<BookmarkListData, 'rows' | 'setRowHeight' | 'onToggleFolder'> & {
  readonly rows: readonly (readonly string[])[];
  readonly columnCount: number;
  readonly setRowHeight: (rowIndex: number, height: number) => void;
};
