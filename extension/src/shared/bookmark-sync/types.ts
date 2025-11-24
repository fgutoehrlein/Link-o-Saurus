export type NativeId = string; // chrome.bookmarks id / browser.bookmarks id
export type LocalId = string; // Link-O-Saurus Bookmark.id
export type NodeType = 'bookmark' | 'folder';

export interface Mapping {
  nativeId: NativeId;
  localId?: LocalId; // nur für bookmarks
  nodeType: NodeType;
  boardId?: string; // für Folder→Board
  categoryId?: string; // für (sub)Folder→Category
  lastSyncAt: number; // ms since epoch
}

export interface SyncSettings {
  enableBidirectional: boolean;
  mirrorRootName: 'Link-O-Saurus';
  importFolderHierarchy: boolean; // true = ordnet native Ordner → Boards/Kategorien
  conflictPolicy: 'last-writer-wins';
  deleteBehavior: 'delete' | 'archive';
}
