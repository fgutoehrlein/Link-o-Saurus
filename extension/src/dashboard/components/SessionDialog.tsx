import type { FunctionalComponent } from 'preact';
import type { SessionPack } from '../../shared/types';

export type SessionDialogState = {
  busy: boolean;
  error: string | null;
};

type SessionDialogProps = {
  readonly sessions: readonly SessionPack[];
  readonly state: SessionDialogState;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly onOpen: (session: SessionPack) => void;
  readonly onDelete: (session: SessionPack) => void;
};

export const SessionDialog: FunctionalComponent<SessionDialogProps> = ({
  sessions,
  state,
  onClose,
  onSave,
  onOpen,
  onDelete,
}) => (
  <div className="modal" role="dialog" aria-modal="true">
    <div className="modal-content">
      <header>
        <h2>Sessions</h2>
        <button type="button" aria-label="Schließen" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="modal-body">
        <p>Speichere deine aktuellen Tabs oder öffne gespeicherte Sessions.</p>
        <div className="modal-actions">
          <button type="button" onClick={onSave} disabled={state.busy}>
            Aktuelle Tabs speichern
          </button>
        </div>
        {state.error ? <p className="error">{state.error}</p> : null}
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <div>
                <strong>{session.title}</strong>
                <span>{session.tabs.length} Tabs</span>
              </div>
              <div className="session-actions">
                <button type="button" onClick={() => onOpen(session)} disabled={state.busy}>
                  Öffnen
                </button>
                <button type="button" onClick={() => onDelete(session)} disabled={state.busy}>
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);
