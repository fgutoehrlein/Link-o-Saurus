import type { SessionPack } from '../shared/types';

const normalizeQuery = (query: string): string => query.trim().toLowerCase();

export const getVisibleSessionTabIndexes = (session: SessionPack, query: string): number[] => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery || session.title.toLowerCase().includes(normalizedQuery)) {
    return session.tabs.map((_tab, index) => index);
  }

  return session.tabs.flatMap((tab, index) =>
    tab.title?.toLowerCase().includes(normalizedQuery) || tab.url.toLowerCase().includes(normalizedQuery) ? [index] : [],
  );
};

export const filterSessions = (sessions: readonly SessionPack[], query: string): readonly SessionPack[] => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return sessions;
  }

  return sessions.filter((session) =>
    session.title.toLowerCase().includes(normalizedQuery) || getVisibleSessionTabIndexes(session, normalizedQuery).length > 0,
  );
};
