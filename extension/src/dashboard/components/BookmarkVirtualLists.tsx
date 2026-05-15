import type { FunctionalComponent } from 'preact';
import { VariableSizeList, type VariableSizeListProps } from 'react-window';
import type { BookmarkListData, BookmarkTileListData } from '../types';

export const VirtualList = VariableSizeList as unknown as FunctionalComponent<
  VariableSizeListProps<BookmarkListData>
>;

export const TileVirtualList = VariableSizeList as unknown as FunctionalComponent<
  VariableSizeListProps<BookmarkTileListData>
>;
