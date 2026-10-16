import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInitialRoute, updateRouteHash, type RouteSnapshot } from './dashboard-route';

const routeSnapshot = (overrides: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
  view: 'bookmarks',
  search: '',
  boardId: '',
  includeTags: [],
  excludeTags: [],
  isNew: false,
  newTitle: '',
  newUrl: '',
  newTags: '',
  ...overrides,
});

describe('dashboard view route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the Sessions view from the view route parameter', () => {
    vi.stubGlobal('window', { location: { search: '', hash: '#/?view=sessions' } });

    expect(parseInitialRoute().view).toBe('sessions');
  });

  it('defaults to the bookmarks view', () => {
    vi.stubGlobal('window', { location: { search: '', hash: '#/' } });

    expect(parseInitialRoute().view).toBe('bookmarks');
  });

  it('preserves the Sessions view when other route state changes', () => {
    const windowMock = { location: { search: '', hash: '#/?view=sessions' } };
    vi.stubGlobal('window', windowMock);

    updateRouteHash(routeSnapshot({ view: 'sessions', search: 'docs' }));

    const routeParams = new URLSearchParams(windowMock.location.hash.split('?')[1]);
    expect(routeParams.get('q')).toBe('docs');
    expect(routeParams.get('view')).toBe('sessions');
  });
});
