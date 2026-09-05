import type { FunctionalComponent, JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { listSessions } from '../shared/db';
import type { SessionPack } from '../shared/types';
import { sendBackgroundMessage } from '../shared/messaging';
import { translateText, useI18n } from '../shared/i18n';

type Feedback = { tone: 'info' | 'error'; message: string };

const formatTimestamp = (timestamp: number, locale: string): string =>
  new Date(timestamp).toLocaleString(locale);

const SessionManager: FunctionalComponent = () => {
  const { locale } = useI18n();
  const [sessions, setSessions] = useState<SessionPack[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedTabIndexes, setSelectedTabIndexes] = useState<Set<number>>(new Set());
  const [titleInput, setTitleInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const selectionRef = useRef<string | null>(null);

  useEffect(() => {
    selectionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const refreshSessions = useCallback(async (focusId?: string) => {
    setLoading(true);
    try {
      const data = await listSessions();
      setSessions(data);
      let nextSession: SessionPack | undefined;
      if (focusId) {
        nextSession = data.find((session) => session.id === focusId);
      } else if (selectionRef.current) {
        nextSession = data.find((session) => session.id === selectionRef.current);
      }
      if (!nextSession && data.length > 0) {
        nextSession = data[0];
      }
      const nextId = nextSession?.id ?? null;
      selectionRef.current = nextId;
      setSelectedSessionId(nextId);
      setSelectedTabIndexes(
        new Set(nextSession ? nextSession.tabs.map((_tab, index) => index) : []),
      );
      setFeedback((prev) => (prev?.tone === 'error' ? null : prev));
    } catch (error) {
      console.error(`[Link-o-Saurus] ${translateText('Sessions konnten nicht geladen werden', locale)}`, error);
      setFeedback({ tone: 'error', message: translateText('Sessions konnten nicht geladen werden.', locale) });
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const handleTitleInput = useCallback(
    (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
      setTitleInput(event.currentTarget.value);
    },
    [],
  );

  const handleSaveSession = useCallback(
    async (event: JSX.TargetedEvent<HTMLFormElement, Event>) => {
      event.preventDefault();
      if (saving) {
        return;
      }
      const trimmedTitle = titleInput.trim();
      setSaving(true);
      setFeedback(null);
      try {
        const response = await sendBackgroundMessage({
          type: 'session.saveCurrentWindow',
          title: trimmedTitle.length ? trimmedTitle : undefined,
        });
        if (response.type !== 'session.saveCurrentWindow.result') {
          throw new Error(translateText('Unerwartete Antwort beim Speichern.', locale));
        }
        await refreshSessions(response.session.id);
        setTitleInput('');
        setFeedback({
          tone: 'info',
          message: translateText(`Session mit ${response.session.tabs.length} Tabs gespeichert.`, locale),
        });
      } catch (error) {
        console.error(`[Link-o-Saurus] ${translateText('Session konnte nicht gespeichert werden', locale)}`, error);
        setFeedback({
          tone: 'error',
          message:
            error instanceof Error
              ? translateText(error.message, locale)
              : translateText('Session konnte nicht gespeichert werden.', locale),
        });
      } finally {
        setSaving(false);
      }
    },
    [locale, refreshSessions, saving, titleInput],
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((item) => item.id === sessionId) ?? null;
      selectionRef.current = sessionId;
      setSelectedSessionId(sessionId);
      setSelectedTabIndexes(new Set(session ? session.tabs.map((_tab, index) => index) : []));
    },
    [sessions],
  );

  const handleToggleTab = useCallback((index: number) => {
    setSelectedTabIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleOpenAll = useCallback(async () => {
    if (!selectedSession || working) {
      return;
    }
    setWorking(true);
    setFeedback(null);
    try {
      const response = await sendBackgroundMessage({
        type: 'session.openAll',
        sessionId: selectedSession.id,
      });
      if (response.type !== 'session.openAll.result') {
        throw new Error(translateText('Unerwartete Antwort beim Öffnen.', locale));
      }
      setFeedback({ tone: 'info', message: translateText(`${response.opened} Tabs geöffnet.`, locale) });
    } catch (error) {
      console.error(`[Link-o-Saurus] ${translateText('Session konnte nicht geöffnet werden', locale)}`, error);
      setFeedback({
        tone: 'error',
        message:
          error instanceof Error
            ? translateText(error.message, locale)
            : translateText('Tabs konnten nicht geöffnet werden.', locale),
      });
    } finally {
      setWorking(false);
    }
  }, [locale, selectedSession, working]);

  const handleOpenSelection = useCallback(async () => {
    if (!selectedSession || working) {
      return;
    }
    const indexes = Array.from(selectedTabIndexes).sort((a, b) => a - b);
    if (!indexes.length) {
      setFeedback({ tone: 'error', message: translateText('Keine Tabs ausgewählt.', locale) });
      return;
    }
    setWorking(true);
    setFeedback(null);
    try {
      const response = await sendBackgroundMessage({
        type: 'session.openSelected',
        sessionId: selectedSession.id,
        tabIndexes: indexes,
      });
      if (response.type !== 'session.openSelected.result') {
        throw new Error(translateText('Unerwartete Antwort beim Öffnen.', locale));
      }
      setFeedback({ tone: 'info', message: translateText(`${response.opened} Tabs geöffnet.`, locale) });
    } catch (error) {
      console.error(`[Link-o-Saurus] ${translateText('Auswahl konnte nicht geöffnet werden', locale)}`, error);
      setFeedback({
        tone: 'error',
        message:
          error instanceof Error
            ? translateText(error.message, locale)
            : translateText('Auswahl konnte nicht geöffnet werden.', locale),
      });
    } finally {
      setWorking(false);
    }
  }, [locale, selectedSession, selectedTabIndexes, working]);

  const handleDeleteSession = useCallback(async () => {
    if (!selectedSession || working) {
      return;
    }
    setWorking(true);
    setFeedback(null);
    try {
      const response = await sendBackgroundMessage({
        type: 'session.delete',
        sessionId: selectedSession.id,
      });
      if (response.type !== 'session.delete.result') {
        throw new Error(translateText('Unerwartete Antwort beim Löschen.', locale));
      }
      await refreshSessions();
      setFeedback({ tone: 'info', message: translateText('Session gelöscht.', locale) });
    } catch (error) {
      console.error(`[Link-o-Saurus] ${translateText('Session konnte nicht gelöscht werden', locale)}`, error);
      setFeedback({
        tone: 'error',
        message:
          error instanceof Error
            ? translateText(error.message, locale)
            : translateText('Session konnte nicht gelöscht werden.', locale),
      });
    } finally {
      setWorking(false);
    }
  }, [locale, refreshSessions, selectedSession, working]);

  return (
    <section class="session-panel" aria-label="Tab-Sessions sichern und wiederherstellen">
      <h2 class="session-panel__title">Sessions</h2>
      <form class="session-save-form" onSubmit={handleSaveSession}>
        <label class="session-save-form__field">
          <span class="session-save-form__label">Session-Titel (optional)</span>
          <input
            type="text"
            value={titleInput}
            onInput={handleTitleInput}
            placeholder="Fenstername"
            aria-label="Session-Titel"
            disabled={saving}
          />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'Sichern …' : 'Tabs sichern'}
        </button>
      </form>
      {feedback ? (
        <div
          class={`session-feedback session-feedback--${feedback.tone}`}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </div>
      ) : null}
      <div class="session-list" role="list" aria-live="polite">
        {loading ? (
          <div class="session-list__spinner" role="status">
            Lädt Sessions …
          </div>
        ) : sessions.length ? (
          sessions.map((session) => {
            const isActive = session.id === selectedSessionId;
            return (
              <div key={session.id} role="listitem">
                <button
                  type="button"
                  class={`session-item${isActive ? ' is-active' : ''}`}
                  onClick={() => handleSelectSession(session.id)}
                  aria-pressed={isActive}
                >
                  <span class="session-item__title">{session.title}</span>
                  <span class="session-item__meta">
                    <span>{session.tabs.length} Tabs</span>
                    <time dateTime={new Date(session.savedAt).toISOString()}>
                      {formatTimestamp(session.savedAt, locale)}
                    </time>
                  </span>
                </button>
              </div>
            );
          })
        ) : (
          <p class="session-empty" role="note">
            Noch keine Sessions gespeichert.
          </p>
        )}
      </div>
      {selectedSession ? (
        <div class="session-detail" aria-live="polite">
          <div class="session-actions">
            <span class="session-actions__summary">
              {selectedTabIndexes.size} / {selectedSession.tabs.length} ausgewählt
            </span>
            <div class="session-actions__buttons">
              <button type="button" onClick={handleOpenAll} disabled={working}>
                Alle öffnen
              </button>
              <button
                type="button"
                onClick={handleOpenSelection}
                disabled={working || selectedTabIndexes.size === 0}
              >
                Auswahl öffnen
              </button>
              <button type="button" onClick={handleDeleteSession} disabled={working}>
                Löschen
              </button>
            </div>
          </div>
          <ul class="session-tabs" role="listbox" aria-multiselectable="true">
            {selectedSession.tabs.map((tab, index) => {
              const checkboxId = `${selectedSession.id}-tab-${index}`;
              const isChecked = selectedTabIndexes.has(index);
              return (
                <li key={checkboxId} class="session-tab" role="option" aria-selected={isChecked}>
                  <label class="session-tab__label" htmlFor={checkboxId}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleTab(index)}
                    />
                    <span class="session-tab__texts">
                      <span class="session-tab__title">{tab.title ?? tab.url}</span>
                      <span class="session-tab__url" title={tab.url}>
                        {tab.url.replace(/^https?:\/\//, '')}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export default SessionManager;
