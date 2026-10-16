import { describe, expect, it } from 'vitest';
import { filterSessions, getVisibleSessionTabIndexes } from './session-search';

const sessions = [
  { id: 'work', title: 'Work', savedAt: 1, tabs: [{ title: 'Calendar', url: 'https://calendar.example' }] },
  {
    id: 'reading',
    title: 'Reading list',
    savedAt: 2,
    tabs: [
      { title: 'Research notes', url: 'https://papers.example/topic' },
      { title: 'News', url: 'https://news.example' },
    ],
  },
];

describe('session search', () => {
  it('matches session titles and tab titles or URLs case-insensitively', () => {
    expect(filterSessions(sessions, 'WORK').map(({ id }) => id)).toEqual(['work']);
    expect(filterSessions(sessions, 'research').map(({ id }) => id)).toEqual(['reading']);
    expect(filterSessions(sessions, 'PAPERS.EXAMPLE').map(({ id }) => id)).toEqual(['reading']);
    expect(filterSessions(sessions, 'missing')).toEqual([]);
  });

  it('shows matching tabs unless the session title itself matched', () => {
    expect(getVisibleSessionTabIndexes(sessions[1], 'papers.example')).toEqual([0]);
    expect(getVisibleSessionTabIndexes(sessions[1], 'reading')).toEqual([0, 1]);
  });

  it('shows all sessions and tabs for a blank query', () => {
    expect(filterSessions(sessions, '  ')).toEqual(sessions);
    expect(getVisibleSessionTabIndexes(sessions[1], '')).toEqual([0, 1]);
  });
});
