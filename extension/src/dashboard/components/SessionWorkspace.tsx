import type { FunctionalComponent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { SessionPack } from '../../shared/types';
import { translateText, useI18n } from '../../shared/i18n';
import { getAllSessionTabIndexes, toggleSessionTabIndex } from '../session-selection';
import { filterSessions, getVisibleSessionTabIndexes } from '../session-search';

export type SessionRestoreProgress = {
  total: number;
  opened: number;
  failed: number;
};

type SessionWorkspaceProps = {
  readonly sessions: readonly SessionPack[];
  readonly searchQuery: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly success: string | null;
  readonly restoreProgress: SessionRestoreProgress | null;
  readonly onSave: () => void;
  readonly onDelete: (session: SessionPack) => void;
  readonly onRestoreAll: (session: SessionPack) => void;
  readonly onRestoreSelected: (session: SessionPack, tabIndexes: number[]) => void;
};

const formatSavedAt = (timestamp: number, locale: string): string => new Date(timestamp).toLocaleString(locale);

export const SessionWorkspace: FunctionalComponent<SessionWorkspaceProps> = ({
  sessions,
  searchQuery,
  busy,
  error,
  success,
  restoreProgress,
  onSave,
  onDelete,
  onRestoreAll,
  onRestoreSelected,
}) => {
  const { locale } = useI18n();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessions[0]?.id ?? null);
  const [selectedTabIndexes, setSelectedTabIndexes] = useState<Set<number>>(
    () => new Set(getAllSessionTabIndexes(sessions[0]?.tabs.length ?? 0)),
  );
  const [lastFirstSessionId, setLastFirstSessionId] = useState<string | null>(sessions[0]?.id ?? null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const visibleSessions = useMemo(() => filterSessions(sessions, searchQuery), [sessions, searchQuery]);
  const selectedSession = useMemo(
    () => visibleSessions.find((session) => session.id === selectedSessionId) ?? visibleSessions[0] ?? null,
    [visibleSessions, selectedSessionId],
  );
  const visibleTabIndexes = useMemo(
    () => selectedSession ? getVisibleSessionTabIndexes(selectedSession, searchQuery) : [],
    [selectedSession, searchQuery],
  );

  const firstSessionId = sessions[0]?.id ?? null;
  useEffect(() => {
    if (firstSessionId !== lastFirstSessionId) {
      setLastFirstSessionId(firstSessionId);
      setSelectedSessionId(firstSessionId);
      setSelectedTabIndexes(new Set(getAllSessionTabIndexes(sessions[0]?.tabs.length ?? 0)));
      setConfirmDeleteId(null);
      return;
    }
    if (!selectedSession || selectedSession.id !== selectedSessionId) {
      setSelectedSessionId(selectedSession?.id ?? null);
      setSelectedTabIndexes(new Set(getAllSessionTabIndexes(selectedSession?.tabs.length ?? 0)));
      setConfirmDeleteId(null);
    }
  }, [firstSessionId, lastFirstSessionId, selectedSession, selectedSessionId, sessions]);

  const selectSession = (session: SessionPack) => {
    setSelectedSessionId(session.id);
    setSelectedTabIndexes(new Set(getAllSessionTabIndexes(session.tabs.length)));
    setConfirmDeleteId(null);
  };

  return (
    <section className="session-workspace" aria-labelledby="session-workspace-title">
      <header className="session-workspace-header">
        <div>
          <h2 id="session-workspace-title">{translateText('Sessions', locale)}</h2>
          <p>{translateText('Speichere ein Fenster und setze später dort fort.', locale)}</p>
        </div>
        <button type="button" onClick={onSave} disabled={busy}>
          {busy ? translateText('Speichern …', locale) : translateText('Aktuelles Fenster speichern', locale)}
        </button>
      </header>
      {error ? <p className="session-workspace-error" role="alert">{translateText(error, locale)}</p> : null}
      {success ? <p className="session-workspace-feedback" role="status" aria-live="polite">{success}</p> : null}
      {restoreProgress ? (
        <div className="session-restore-progress" role="status" aria-live="polite">
          <progress max={restoreProgress.total} value={restoreProgress.opened + restoreProgress.failed} />
          <span>
            {translateText('Tabs wiederherstellen', locale)}: {restoreProgress.opened}/{restoreProgress.total}
            {restoreProgress.failed ? ` · ${restoreProgress.failed} ${translateText('fehlgeschlagen', locale)}` : ''}
          </span>
        </div>
      ) : null}
      {sessions.length === 0 ? (
        <div className="session-workspace-empty">
          <p>{translateText('Noch keine Sessions gespeichert.', locale)}</p>
          <p>{translateText('Speichere das aktuelle Fenster, um Tabs später wieder zu öffnen.', locale)}</p>
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="session-workspace-empty">
          <p>{translateText('Keine passenden Sessions oder Tabs gefunden.', locale)}</p>
        </div>
      ) : (
        <div className="session-workspace-grid">
          <ul className="session-workspace-list" aria-label={translateText('Gespeicherte Sessions', locale)}>
            {visibleSessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={`session-workspace-card${session.id === selectedSession?.id ? ' is-selected' : ''}`}
                  aria-pressed={session.id === selectedSession?.id}
                  onClick={() => selectSession(session)}
                >
                  <strong>{session.title}</strong>
                  <span>{formatSavedAt(session.savedAt, locale)} · {session.tabs.length} {translateText('Tabs', locale)}</span>
                </button>
              </li>
            ))}
          </ul>
          {selectedSession ? (
            <section className="session-workspace-detail" aria-label={selectedSession.title}>
              <header>
                <div>
                  <h3>{selectedSession.title}</h3>
                  <p>{formatSavedAt(selectedSession.savedAt, locale)} · {selectedSession.tabs.length} {translateText('Tabs', locale)}</p>
                </div>
                <div className="session-workspace-actions">
                  {confirmDeleteId === selectedSession.id ? (
                    <>
                      <span>{translateText('Session löschen?', locale)}</span>
                      <button type="button" onClick={() => onDelete(selectedSession)} disabled={busy}>
                        {translateText('Löschen', locale)}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} disabled={busy}>
                        {translateText('Abbrechen', locale)}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(selectedSession.id)} disabled={busy}>
                      {translateText('Löschen', locale)}
                    </button>
                  )}
                </div>
              </header>
              <div className="session-tab-selection">
                <label>
                  <input
                    type="checkbox"
                    checked={visibleTabIndexes.length > 0 && visibleTabIndexes.every((index) => selectedTabIndexes.has(index))}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedTabIndexes((previous) => {
                        const next = new Set(previous);
                        visibleTabIndexes.forEach((index) => checked ? next.add(index) : next.delete(index));
                        return next;
                      });
                    }}
                  />
                  {translateText(searchQuery.trim() ? 'Alle angezeigten Tabs auswählen' : 'Alle Tabs auswählen', locale)}
                </label>
                <ul>
                  {visibleTabIndexes.map((index) => {
                    const tab = selectedSession.tabs[index];
                    return (
                      <li key={`${selectedSession.id}-${index}`}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selectedTabIndexes.has(index)}
                            onChange={() => setSelectedTabIndexes((previous) => toggleSessionTabIndex(previous, index, selectedSession.tabs.length))}
                          />
                          <span>
                            <strong>{tab.title || tab.url}</strong>
                            <small>{tab.url}</small>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <footer className="session-workspace-actions">
                <button
                  type="button"
                  onClick={() => onRestoreSelected(selectedSession, visibleTabIndexes.filter((index) => selectedTabIndexes.has(index)))}
                  disabled={busy || !visibleTabIndexes.some((index) => selectedTabIndexes.has(index))}
                >
                  {translateText('Ausgewählte im aktuellen Fenster öffnen', locale)}
                </button>
                <button type="button" onClick={() => onRestoreAll(selectedSession)} disabled={busy}>
                  {translateText('Alle in neuem Fenster öffnen', locale)}
                </button>
              </footer>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
};
