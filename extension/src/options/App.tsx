import { wrap, releaseProxy } from 'comlink';
import type { Remote } from 'comlink';
import type { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import ImportExportWorker from '../shared/import-export-worker?worker&module';
import type {
  ImportExportWorkerApi,
  ImportProgressHandler,
} from '../shared/import-export-worker';
import type { ExportFormat, ImportProgress, ImportResult } from '../shared/import-export';

const formatPercent = (ratio: number | undefined): string => {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) {
    return '0%';
  }
  return `${Math.min(100, Math.max(0, Math.round(ratio * 100)))}%`;
};

const stageLabel = (progress: ImportProgress): string => {
  if (progress.stage === 'parsing') {
    return 'Parsing bookmarks…';
  }
  return 'Saving to database…';
};

const computeProgressRatio = (progress: ImportProgress): number | undefined => {
  if (progress.stage === 'parsing') {
    if (progress.totalBytes && progress.totalBytes > 0) {
      return progress.processedBytes / progress.totalBytes;
    }
    if (progress.processedBookmarks > 0) {
      return progress.createdBookmarks / progress.processedBookmarks;
    }
    return 0;
  }

  if (progress.totalBookmarks > 0) {
    return progress.processedBookmarks / progress.totalBookmarks;
  }
  return 0;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const createWorker = (): Worker => new ImportExportWorker();

const STYLES = `
  body {
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f5f7fb;
    color: #0f172a;
  }

  .options {
    margin: 0 auto;
    max-width: 960px;
    padding: 2.5rem 1.5rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .panel {
    background: #ffffff;
    border-radius: 18px;
    padding: 1.75rem;
    box-shadow: 0 30px 60px rgba(15, 23, 42, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.2);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  header h1 {
    font-size: 2.1rem;
    margin: 0 0 0.35rem;
  }

  header p {
    margin: 0;
    color: #475569;
    font-size: 1rem;
  }

  .panel h2 {
    font-size: 1.35rem;
    margin: 0;
  }

  .panel p {
    margin: 0;
    color: #475569;
    line-height: 1.5;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.95rem;
  }

  .toggle input {
    width: 1.2rem;
    height: 1.2rem;
  }

  .import-actions,
  .export-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .file-input {
    position: relative;
    padding: 0.85rem 1.6rem;
    border-radius: 12px;
    border: 1px dashed rgba(14, 165, 233, 0.45);
    background: rgba(224, 242, 254, 0.6);
    color: #0369a1;
    font-weight: 600;
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease;
  }

  .file-input:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 30px rgba(14, 165, 233, 0.15);
  }

  .file-input input {
    display: none;
  }

  button {
    padding: 0.85rem 1.8rem;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, #0284c7, #0ea5e9);
    color: #ffffff;
    font-weight: 600;
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease;
  }

  button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 18px 35px rgba(14, 165, 233, 0.22);
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: none;
  }

  .progress {
    display: grid;
    gap: 0.35rem;
  }

  .progress progress {
    width: 100%;
    height: 0.75rem;
    border-radius: 999px;
    overflow: hidden;
    appearance: none;
  }

  .progress progress::-webkit-progress-bar {
    background-color: #e2e8f0;
    border-radius: 999px;
  }

  .progress progress::-webkit-progress-value {
    background: linear-gradient(135deg, #22d3ee, #0284c7);
    border-radius: 999px;
  }

  .progress span {
    font-size: 0.85rem;
    color: #475569;
  }

  .stats {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .stats div {
    background: #f8fafc;
    border-radius: 12px;
    padding: 0.85rem 1rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }

  .stats dt {
    margin: 0;
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    color: #64748b;
    text-transform: uppercase;
  }

  .stats dd {
    margin: 0.35rem 0 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: #0f172a;
  }

  .panel.error {
    background: #fef2f2;
    border: 1px solid rgba(248, 113, 113, 0.35);
    color: #b91c1c;
  }

  .panel.error h2 {
    margin: 0;
  }

  @media (max-width: 720px) {
    .options {
      padding: 1.5rem 1rem 2.5rem;
    }

    .panel {
      padding: 1.25rem;
      border-radius: 14px;
    }

    .import-actions,
    .export-actions {
      flex-direction: column;
    }

    button,
    .file-input {
      width: 100%;
      justify-content: center;
    }
  }
`;

const App: FunctionalComponent = () => {
  const workerRef = useRef<Worker>();
  const apiRef = useRef<Remote<ImportExportWorkerApi>>();
  const [dedupeEnabled, setDedupeEnabled] = useState(true);
  const [includeFavicons, setIncludeFavicons] = useState(true);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    const worker = createWorker();
    const api = wrap<ImportExportWorkerApi>(worker);
    workerRef.current = worker;
    apiRef.current = api;

    return () => {
      if (apiRef.current) {
        void apiRef.current[releaseProxy]();
        apiRef.current = undefined;
      }
      workerRef.current?.terminate();
      workerRef.current = undefined;
    };
  }, []);

  const withWorker = useCallback(async () => {
    if (!apiRef.current) {
      const worker = createWorker();
      const api = wrap<ImportExportWorkerApi>(worker);
      workerRef.current = worker;
      apiRef.current = api;
    }
    return apiRef.current!;
  }, []);

  const handleProgress = useCallback<ImportProgressHandler>((progress) => {
    setImportProgress(progress);
  }, []);

  const resetInputs = (input: HTMLInputElement | null) => {
    if (input) {
      input.value = '';
    }
  };

  const handleImport = useCallback(
    async (file: File, format: 'html' | 'json', input?: HTMLInputElement | null) => {
      setError(null);
      setImportResult(null);
      setImportProgress(null);
      setIsImporting(true);
      try {
        const worker = await withWorker();
        const callbacks = { onProgress: handleProgress };
        let result: ImportResult;
        if (format === 'html') {
          result = await worker.importHtml(file, { dedupe: dedupeEnabled }, callbacks);
        } else {
          result = await worker.importJson(file, { dedupe: dedupeEnabled }, callbacks);
        }
        setImportResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setIsImporting(false);
        setImportProgress(null);
        resetInputs(input ?? null);
      }
    },
    [dedupeEnabled, handleProgress, withWorker],
  );

  const handleFileChange = useCallback(
    (format: 'html' | 'json') => async (event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      await handleImport(file, format, input);
    },
    [handleImport],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setError(null);
      setIsExporting(true);
      try {
        const worker = await withWorker();
        const { blob, fileName } = await worker.export(format, {
          includeFavicons: includeFavicons && format === 'zip',
        });
        downloadBlob(blob, fileName);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setIsExporting(false);
      }
    },
    [includeFavicons, withWorker],
  );

  const progressRatio = useMemo(() => (importProgress ? computeProgressRatio(importProgress) : undefined), [
    importProgress,
  ]);

  return (
    <main class="options">
      <header>
        <h1>Link-O-Saurus Datenportabilität</h1>
        <p>Importiere oder exportiere deine Bookmarks ohne die UI zu blockieren.</p>
      </header>

      <section class="panel">
        <h2>Import</h2>
        <p>
          Unterstützte Formate: <strong>Netscape Bookmark HTML</strong> (Chrome/Firefox) und das{' '}
          <strong>Link-O-Saurus JSON</strong>-Format.
        </p>

        <label class="toggle">
          <input
            type="checkbox"
            checked={dedupeEnabled}
            onChange={(event) => setDedupeEnabled(event.currentTarget.checked)}
          />
          <span>Duplikate anhand normalisierter URLs überspringen</span>
        </label>

        <div class="import-actions">
          <label class="file-input">
            <span>HTML importieren</span>
            <input
              type="file"
              accept="text/html,.html,.htm"
              disabled={isImporting}
              onChange={handleFileChange('html')}
            />
          </label>
          <label class="file-input">
            <span>JSON importieren</span>
            <input
              type="file"
              accept="application/json,.json"
              disabled={isImporting}
              onChange={handleFileChange('json')}
            />
          </label>
        </div>

        {importProgress && (
          <div class="progress">
            <label>{stageLabel(importProgress)}</label>
            <progress value={progressRatio ?? 0} max={1} />
            <span>{formatPercent(progressRatio)}</span>
          </div>
        )}

        {importResult && (
          <dl class="stats">
            <div>
              <dt>Verarbeitet</dt>
              <dd>{importResult.stats.processedBookmarks.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Importiert</dt>
              <dd>{importResult.stats.createdBookmarks.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Übersprungen</dt>
              <dd>{importResult.stats.skippedBookmarks.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Duplikate</dt>
              <dd>{importResult.stats.duplicateBookmarks.toLocaleString()}</dd>
            </div>
          </dl>
        )}
      </section>

      <section class="panel">
        <h2>Export</h2>
        <p>Erzeuge portierbare Backups. Der HTML-Export ist kompatibel mit Chrome und Firefox.</p>

        <div class="export-actions">
          <button type="button" disabled={isExporting} onClick={() => handleExport('html')}>
            HTML exportieren
          </button>
          <button type="button" disabled={isExporting} onClick={() => handleExport('json')}>
            JSON exportieren
          </button>
          <button type="button" disabled={isExporting} onClick={() => handleExport('zip')}>
            ZIP exportieren
          </button>
        </div>

        <label class="toggle">
          <input
            type="checkbox"
            checked={includeFavicons}
            onChange={(event) => setIncludeFavicons(event.currentTarget.checked)}
          />
          <span>Favicons in ZIP aufnehmen (falls verfügbar)</span>
        </label>
      </section>

      {error && (
        <section class="panel error" role="alert">
          <h2>Fehler</h2>
          <p>{error}</p>
        </section>
      )}
    </main>
  );
};

export default App;
