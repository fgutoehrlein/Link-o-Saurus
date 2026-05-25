import { describe, expect, it } from 'vitest';
import { getParentIndex, getTreeKeyAction } from './tree-navigation';
import type { VisibleRow } from './types';

const rows: VisibleRow[] = [
  { kind: 'folder', id: 'board:1', title: 'Board', depth: 0, hasChildren: true, expanded: true },
  { kind: 'folder', id: 'category:1', title: 'Category', depth: 1, hasChildren: true, expanded: false },
  { kind: 'bookmark', id: 'bookmark:1', bookmarkId: 'bookmark:1', depth: 2 },
];

describe('tree navigation', () => {
  it('maps keyboard actions for folders and bookmarks', () => {
    expect(getTreeKeyAction('ArrowDown', rows[1])).toBe('focus-next');
    expect(getTreeKeyAction('ArrowRight', rows[1])).toBe('expand');
    expect(getTreeKeyAction('ArrowLeft', rows[1])).toBe('collapse');
    expect(getTreeKeyAction('Enter', rows[2])).toBe('activate');
    expect(getTreeKeyAction('x', rows[2])).toBe('none');
  });

  it('resolves parent index for nested entries', () => {
    expect(getParentIndex(rows, 2)).toBe(1);
    expect(getParentIndex(rows, 1)).toBe(0);
    expect(getParentIndex(rows, 0)).toBe(-1);
  });
});
