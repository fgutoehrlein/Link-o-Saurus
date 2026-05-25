import type { VisibleRow } from './types';

export type TreeKeyAction = 'focus-prev' | 'focus-next' | 'expand' | 'collapse' | 'activate' | 'none';

export const getParentIndex = (rows: readonly VisibleRow[], index: number): number => {
  const current = rows[index];
  if (!current) {
    return -1;
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = rows[cursor];
    if (candidate && candidate.depth < current.depth) {
      return cursor;
    }
  }
  return -1;
};

export const getTreeKeyAction = (eventKey: string, row: VisibleRow): TreeKeyAction => {
  if (eventKey === 'ArrowUp') return 'focus-prev';
  if (eventKey === 'ArrowDown') return 'focus-next';
  if (eventKey === 'ArrowRight' && row.kind === 'folder') return 'expand';
  if (eventKey === 'ArrowLeft' && row.kind === 'folder') return 'collapse';
  if ((eventKey === 'Enter' || eventKey === ' ') && row.kind === 'bookmark') return 'activate';
  if ((eventKey === 'Enter' || eventKey === ' ') && row.kind === 'folder') return 'expand';
  return 'none';
};
