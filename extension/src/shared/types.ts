export type BookmarkId = string;

export interface BookmarkRecord {
  id: BookmarkId;
  title: string;
  url: string;
  createdAt: number;
  tags: string[];
}
