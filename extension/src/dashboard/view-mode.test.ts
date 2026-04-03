import { describe, expect, it } from 'vitest';

import {
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
    expect(getGridColumnCount(320)).toBe(1);
    expect(getGridColumnCount(700)).toBe(2);
    expect(getGridColumnCount(1000)).toBe(3);
    expect(getGridColumnCount(1320)).toBe(4);

    expect(toGridRows(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });
});
