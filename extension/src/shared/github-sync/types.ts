import type { Board, Bookmark, Category, Comment, ReadLater, SessionPack, Tag } from '../types';

export interface SyncSnapshotV1 {
  format: 'link-o-saurus-sync';
  version: 1;
  exportedAt: string;
  boards: Board[];
  categories: Category[];
  bookmarks: Bookmark[];
  tags: Tag[];
  comments: Comment[];
  readLater: ReadLater[];
  sessions: SessionPack[];
}

export type SyncCollectionName =
  | 'boards'
  | 'categories'
  | 'bookmarks'
  | 'tags'
  | 'comments'
  | 'readLater'
  | 'sessions';

export interface SyncConflict {
  collection: SyncCollectionName;
  id: string;
  key: string;
  base: unknown | null;
  local: unknown | null;
  remote: unknown | null;
}

export interface SyncMergeResult {
  snapshot: SyncSnapshotV1;
  conflicts: SyncConflict[];
}

export interface EncryptedSyncFile {
  format: 'link-o-saurus-encrypted-sync';
  version: 1;
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  cipher: 'AES-GCM';
  iv: string;
  ciphertext: string;
}
