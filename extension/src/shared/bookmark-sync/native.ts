import type { NativeId } from './types';

type BookmarksApi = typeof chrome.bookmarks;
type BookmarkTreeNode = chrome.bookmarks.BookmarkTreeNode;

type GlobalWithBrowser = typeof globalThis & { browser?: typeof chrome };

const getBookmarksApi = (): BookmarksApi => {
  if (typeof chrome !== 'undefined' && chrome?.bookmarks) {
    return chrome.bookmarks;
  }
  const maybeBrowser = (globalThis as GlobalWithBrowser).browser;
  if (maybeBrowser?.bookmarks) {
    return maybeBrowser.bookmarks;
  }
  throw new Error('Bookmarks API is not available in this context');
};

export const getTree = async (): Promise<BookmarkTreeNode[]> => {
  const api = getBookmarksApi();
  return api.getTree();
};

const findFolderByTitle = (
  nodes: BookmarkTreeNode[] | undefined,
  title: string,
): BookmarkTreeNode | undefined => {
  if (!nodes?.length) {
    return undefined;
  }
  for (const node of nodes) {
    if (!node.url && node.title === title) {
      return node;
    }
    const childMatch = findFolderByTitle(node.children, title);
    if (childMatch) {
      return childMatch;
    }
  }
  return undefined;
};

export const ensureMirrorRoot = async (name: string): Promise<NativeId> => {
  const api = getBookmarksApi();
  const tree = await getTree();
  const root = tree[0];
  const existing = findFolderByTitle(root?.children, name);
  if (existing) {
    return existing.id;
  }
  const parentId = root?.id ?? '0';
  const created = await api.create({ parentId, title: name });
  return created.id;
};

export const createNativeBookmark = async (
  details: chrome.bookmarks.BookmarkCreateArg,
): Promise<BookmarkTreeNode> => {
  const api = getBookmarksApi();
  return api.create(details);
};

export const updateNativeBookmark = async (
  nativeId: NativeId,
  changes: chrome.bookmarks.BookmarkChangesArg,
): Promise<BookmarkTreeNode> => {
  const api = getBookmarksApi();
  return api.update(nativeId, changes);
};

export const removeNativeNode = async (nativeId: NativeId): Promise<void> => {
  const api = getBookmarksApi();
  const [node] = await api.get(nativeId);
  if (!node) {
    return;
  }
  if (node.url) {
    await api.remove(nativeId);
  } else {
    await api.removeTree(nativeId);
  }
};

export const moveNativeNode = async (
  nativeId: NativeId,
  destination: chrome.bookmarks.BookmarkDestinationArg,
): Promise<BookmarkTreeNode> => {
  const api = getBookmarksApi();
  return api.move(nativeId, destination);
};
