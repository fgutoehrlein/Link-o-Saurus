import type { FunctionalComponent } from 'preact';
import type { SessionPack } from '../../shared/types';
import { AccessibleModal } from './AccessibleModal';

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
  <AccessibleModal
    title="Sessions"
    description="Speichere deine aktuellen Tabs oder öffne gespeicherte Sessions."
    closeOnBackdrop={!state.busy}
    onClose={onClose}
  >
    <div className="modal-actions">
      <button type="button" onClick={onSave} disabled={state.busy}>Aktuelle Tabs speichern</button>
    </div>
    {state.error ? <p className="error" role="alert">{state.error}</p> : null}
    {sessions.length === 0 ? (
      <p className="empty-state">Noch keine Sessions gespeichert.</p>
    ) : (
      <ul className="session-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <div>
              <strong>{session.title}</strong>
              <span>{session.tabs.length} Tabs</span>
            </div>
            <div className="session-actions">
              <button type="button" onClick={() => onOpen(session)} disabled={state.busy}>Öffnen</button>
              <button type="button" onClick={() => onDelete(session)} disabled={state.busy}>Löschen</button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </AccessibleModal>
);
