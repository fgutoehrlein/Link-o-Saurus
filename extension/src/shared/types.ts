export type EntityId = string;

export type Board = {
  id: EntityId;
  title: string;
  icon?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type Category = {
  id: EntityId;
  boardId: EntityId;
  title: string;
  sortOrder: number;
};

export type Bookmark = {
  id: EntityId;
  categoryId?: EntityId;
  url: string;
  title: string;
  notes?: string;
  tags: string[];
  pinned?: boolean;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
  visitCount: number;
  lastVisitedAt?: number;
};

export type Comment = {
  id: EntityId;
  bookmarkId: EntityId;
  author: string;
  body: string;
  createdAt: number;
};

export type Tag = {
  id: EntityId;
  name: string;
  path: string;
  slugParts: string[];
  usageCount: number;
};

export type SessionPack = {
  id: EntityId;
  title: string;
  tabs: {
    url: string;
    title?: string;
    favIconUrl?: string;
  }[];
  savedAt: number;
};

export type UserSettings = {
  theme: 'light' | 'dark' | 'system';
  newTabEnabled: boolean;
  hotkeys?: Record<string, string>;
};

export type EntityMap<T extends { id: EntityId }> = Record<EntityId, T>;

export type RuleConditions = {
  host?: string;
  urlIncludes?: string[];
  mime?: string;
};

export type RuleActions = {
  addTags?: string[];
  setCategoryId?: EntityId;
};

export type Rule = {
  id: EntityId;
  name: string;
  conditions: RuleConditions;
  actions: RuleActions;
  enabled: boolean;
};
