import type { FunctionalComponent } from 'preact';
import type { ExportFormat, ImportProgress } from '../../shared/import-export';

type ImportFormat = 'html' | 'json';

export type ImportDialogState = {
  busy: boolean;
  progress: ImportProgress | null;
  error: string | null;
};

type ImportExportDialogProps = {
  readonly state: ImportDialogState;
  readonly onClose: () => void;
  readonly onImportFile: (file: File, format: ImportFormat) => void;
  readonly onExport: (format: ExportFormat) => void;
};

export const ImportExportDialog: FunctionalComponent<ImportExportDialogProps> = ({
  state,
  onClose,
  onImportFile,
  onExport,
}) => (
  <div className="modal" role="dialog" aria-modal="true">
    <div className="modal-content">
      <header>
        <h2>Import &amp; Export</h2>
        <button type="button" aria-label="Schließen" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="modal-body">
        <p>Importiere HTML- oder JSON-Dateien. Vorgang läuft im Worker ohne UI-Blockade.</p>
        <div className="modal-actions">
          <label className="file-button">
            HTML importieren
            <input
              type="file"
              accept=".html,.htm,text/html"
              disabled={state.busy}
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement).files?.[0];
                if (file) {
                  onImportFile(file, 'html');
                }
              }}
            />
          </label>
          <label className="file-button">
            JSON importieren
            <input
              type="file"
              accept="application/json,.json"
              disabled={state.busy}
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement).files?.[0];
                if (file) {
                  onImportFile(file, 'json');
                }
              }}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => onExport('html')} disabled={state.busy}>
            Als HTML exportieren
          </button>
          <button type="button" onClick={() => onExport('json')} disabled={state.busy}>
            Als JSON exportieren
          </button>
        </div>
        {state.busy ? <p>Import/Export läuft…</p> : null}
        {state.progress ? <pre className="progress">{JSON.stringify(state.progress, null, 2)}</pre> : null}
        {state.error ? <p className="error">{state.error}</p> : null}
      </div>
    </div>
  </div>
);
