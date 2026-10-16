import type { FunctionalComponent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { SessionPack } from '../../shared/types';
import { translateText, useI18n } from '../../shared/i18n';
import { getAllSessionTabIndexes, toggleSessionTabIndex } from '../session-selection';

export type SessionRestoreProgress = {
  total: number;
  opened: number;
  failed: number;
};

type SessionWorkspaceProps = {
  readonly sessions: readonly SessionPack[];
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
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
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
      ) : (
        <div className="session-workspace-grid">
          <ul className="session-workspace-list" aria-label={translateText('Gespeicherte Sessions', locale)}>
            {sessions.map((session) => (
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
                    checked={selectedTabIndexes.size === selectedSession.tabs.length}
                    onChange={(event) => setSelectedTabIndexes(
                      event.currentTarget.checked
                        ? new Set(getAllSessionTabIndexes(selectedSession.tabs.length))
                        : new Set(),
                    )}
                  />
                  {translateText('Alle Tabs auswählen', locale)}
                </label>
                <ul>
                  {selectedSession.tabs.map((tab, index) => (
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
                  ))}
                </ul>
              </div>
              <footer className="session-workspace-actions">
                <button type="button" onClick={() => onRestoreSelected(selectedSession, [...selectedTabIndexes].sort((a, b) => a - b))} disabled={busy || selectedTabIndexes.size === 0}>
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
