import { describe, expect, it } from 'vitest';

import {
  GRID_MAX_COLUMNS,
  getGridColumnCount,
  isBookmarkViewMode,
  resolveBookmarkViewMode,
  toGridRows,
} from './view-mode';
import type { UserSettings } from '../shared/types';

const createSettings = (overrides: Partial<UserSettings> = {}): UserSettings => ({
  theme: 'system',
  dashboardViewMode: 'list',
  newTabEnabled: false,
  hotkeys: {},
  bookmarkSync: {
    enableBidirectional: false,
    mirrorRootName: 'Link-O-Saurus',
    importFolderHierarchy: true,
    conflictPolicy: 'last-writer-wins',
    deleteBehavior: 'delete',
  },
  ...overrides,
});

describe('dashboard view mode helpers', () => {
  it('validates known view modes', () => {
    expect(isBookmarkViewMode('list')).toBe(true);
    expect(isBookmarkViewMode('tiles')).toBe(true);
    expect(isBookmarkViewMode('grid')).toBe(false);
  });

  it('resolves invalid persisted view modes safely', () => {
    const invalid = createSettings({ dashboardViewMode: 'list' });
    expect(resolveBookmarkViewMode(invalid)).toBe('list');
    expect(resolveBookmarkViewMode({ ...invalid, dashboardViewMode: 'tiles' })).toBe('tiles');
  });

  it('creates responsive grid rows', () => {
    expect(getGridColumnCount(0)).toBe(1);
    expect(getGridColumnCount(320)).toBe(1);
    expect(getGridColumnCount(520)).toBe(2);
    expect(getGridColumnCount(790)).toBe(3);
    expect(getGridColumnCount(1090)).toBe(4);
    expect(getGridColumnCount(5000)).toBe(GRID_MAX_COLUMNS);

    expect(toGridRows(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
    expect(toGridRows(['a', 'b'], 0)).toEqual([['a'], ['b']]);
  });
});
