import { wrap, releaseProxy } from 'comlink';
import type { Remote } from 'comlink';
import type { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import ImportExportWorker from '../shared/import-export-worker?worker&module';
import {
  createRule,
  deleteRule,
  getUserSettings,
  listRules,
  saveUserSettings,
  updateRule,
} from '../shared/db';
import { sendBackgroundMessage } from '../shared/messaging';
import type {
  ImportExportWorkerApi,
  ImportProgressHandler,
} from '../shared/import-export-worker';
import type { ExportFormat, ImportProgress, ImportResult } from '../shared/import-export';
import type { Rule } from '../shared/types';

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

type RuleFormState = {
  name: string;
  host: string;
  urlIncludes: string;
  mime: string;
  addTags: string;
  categoryId: string;
};

const INITIAL_RULE_FORM: RuleFormState = {
  name: '',
  host: '',
  urlIncludes: '',
  mime: '',
  addTags: '',
  categoryId: '',
};

const parseCsvInput = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const describeRuleConditions = (rule: Rule): string => {
  const segments: string[] = [];
  if (rule.conditions.host) {
    segments.push(`Host entspricht: ${rule.conditions.host}`);
  }
  if (rule.conditions.urlIncludes && rule.conditions.urlIncludes.length > 0) {
    segments.push(`URL enthält: ${rule.conditions.urlIncludes.join(', ')}`);
  }
  if (rule.conditions.mime) {
    segments.push(`MIME-Typ: ${rule.conditions.mime}`);
  }
  return segments.length > 0 ? segments.join(' · ') : '—';
};

const describeRuleActions = (rule: Rule): string => {
  const segments: string[] = [];
  if (rule.actions.addTags && rule.actions.addTags.length > 0) {
    segments.push(`Tags hinzufügen: ${rule.actions.addTags.join(', ')}`);
  }
  if (rule.actions.setCategoryId) {
    segments.push(`Kategorie setzen: ${rule.actions.setCategoryId}`);
  }
  return segments.length > 0 ? segments.join(' · ') : '—';
};

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

  .hint {
    margin: 0;
    color: #64748b;
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .status {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .status.success {
    color: #047857;
  }

  .status.error {
    color: #b91c1c;
  }

  .status.pending {
    color: #0ea5e9;
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

  .rules {
    display: grid;
    gap: 1.25rem;
  }

  .rule-form {
    display: grid;
    gap: 0.9rem;
  }

  .rule-form-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }

  .rule-form label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: #475569;
  }

  .rule-form input {
    padding: 0.65rem 0.75rem;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.45);
    background: #ffffff;
    font-size: 0.95rem;
    color: #0f172a;
  }

  .rule-form input:disabled {
    background: #e2e8f0;
    cursor: not-allowed;
  }

  .rule-form-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .button-secondary {
    background: #e2e8f0;
    color: #0f172a;
  }

  .button-secondary:hover:not(:disabled) {
    box-shadow: 0 8px 20px rgba(148, 163, 184, 0.35);
  }

  .button-danger {
    background: #fee2e2;
    color: #b91c1c;
  }

  .button-danger:hover:not(:disabled) {
    box-shadow: 0 12px 25px rgba(248, 113, 113, 0.35);
  }

  .rule-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.9rem;
  }

  .rule-item {
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 12px;
    padding: 1rem 1.1rem;
    background: #f8fafc;
    display: grid;
    gap: 0.75rem;
  }

  .rule-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .rule-header h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .rule-status {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
  }

  .rule-status.enabled {
    background: #dcfce7;
    color: #047857;
  }

  .rule-status.disabled {
    background: #fee2e2;
    color: #b91c1c;
  }

  .rule-details {
    display: grid;
    gap: 0.35rem;
    margin: 0;
  }

  .rule-details dt {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }

  .rule-details dd {
    margin: 0.2rem 0 0;
    font-size: 0.9rem;
    color: #1e293b;
    line-height: 1.4;
  }

  .rule-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
  }

  .rule-empty {
    margin: 0;
    color: #64748b;
    font-size: 0.9rem;
  }

  .rule-error {
    margin: 0;
    color: #b91c1c;
    font-size: 0.85rem;
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

    .rule-form-grid {
      grid-template-columns: 1fr;
    }

    .rule-actions {
      flex-direction: column;
    }

    .rule-actions button {
      width: 100%;
    }
  }
`;

const App: FunctionalComponent = () => {
  const workerRef = useRef<Worker>();
  const apiRef = useRef<Remote<ImportExportWorkerApi>>();
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [newTabEnabled, setNewTabEnabled] = useState(false);
  const [isUpdatingNewTab, setIsUpdatingNewTab] = useState(false);
  const [newTabMessage, setNewTabMessage] = useState<string | null>(null);
  const [newTabError, setNewTabError] = useState<string | null>(null);
  const [dedupeEnabled, setDedupeEnabled] = useState(true);
  const [includeFavicons, setIncludeFavicons] = useState(true);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [ruleBusyId, setRuleBusyId] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<RuleFormState>(INITIAL_RULE_FORM);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getUserSettings();
        if (!cancelled) {
          setNewTabEnabled(settings.newTabEnabled);
        }
      } catch (err) {
        console.error('Failed to load user settings', err);
        if (!cancelled) {
          setNewTabError('Einstellungen konnten nicht geladen werden.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRules = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsLoadingRules(true);
      }
      try {
        const stored = await listRules();
        setRules(stored);
        setRulesError(null);
      } catch (err) {
        console.error('Failed to load smart rules', err);
        setRulesError('Regeln konnten nicht geladen werden.');
      } finally {
        setIsLoadingRules(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshRules();
  }, [refreshRules]);

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

  const handleRuleInputChange = useCallback(
    (key: keyof RuleFormState) => (event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      setNewRule((previous) => ({ ...previous, [key]: input.value }));
    },
    [],
  );

  const handleAddRule = useCallback(
    async (event: Event) => {
      event.preventDefault();
      const name = newRule.name.trim();
      const host = newRule.host.trim();
      const includes = parseCsvInput(newRule.urlIncludes);
      const mime = newRule.mime.trim();
      const tags = parseCsvInput(newRule.addTags);
      const categoryId = newRule.categoryId.trim();

      if (!name) {
        setRulesError('Bitte einen Namen für die Regel vergeben.');
        return;
      }
      if (!host && includes.length === 0 && !mime) {
        setRulesError('Mindestens eine Bedingung angeben (Host, URL-Teil oder MIME-Typ).');
        return;
      }
      if (tags.length === 0 && !categoryId) {
        setRulesError('Mindestens eine Aktion angeben (Tags oder Kategorie).');
        return;
      }

      setIsAddingRule(true);
      setRulesError(null);
      try {
        await createRule({
          name,
          conditions: {
            ...(host ? { host } : {}),
            ...(includes.length > 0 ? { urlIncludes: includes } : {}),
            ...(mime ? { mime } : {}),
          },
          actions: {
            ...(tags.length > 0 ? { addTags: tags } : {}),
            ...(categoryId ? { setCategoryId: categoryId } : {}),
          },
          enabled: true,
        });
        setNewRule(INITIAL_RULE_FORM);
        await refreshRules(true);
      } catch (err) {
        console.error('Failed to create rule', err);
        setRulesError('Regel konnte nicht gespeichert werden.');
      } finally {
        setIsAddingRule(false);
      }
    },
    [newRule, refreshRules],
  );

  const handleToggleRule = useCallback(
    async (rule: Rule) => {
      setRuleBusyId(rule.id);
      setRulesError(null);
      try {
        await updateRule(rule.id, { enabled: !rule.enabled });
        await refreshRules(true);
      } catch (err) {
        console.error('Failed to update rule', err);
        setRulesError('Regel konnte nicht aktualisiert werden.');
      } finally {
        setRuleBusyId(null);
      }
    },
    [refreshRules],
  );

  const handleDeleteRule = useCallback(
    async (rule: Rule) => {
      setRuleBusyId(rule.id);
      setRulesError(null);
      try {
        await deleteRule(rule.id);
        await refreshRules(true);
      } catch (err) {
        console.error('Failed to delete rule', err);
        setRulesError('Regel konnte nicht gelöscht werden.');
      } finally {
        setRuleBusyId(null);
      }
    },
    [refreshRules],
  );

  const withWorker = useCallback(async () => {
    if (!apiRef.current) {
      const worker = createWorker();
      const api = wrap<ImportExportWorkerApi>(worker);
      workerRef.current = worker;
      apiRef.current = api;
    }
    return apiRef.current!;
  }, []);

  const ensureNewTabPermission = useCallback(async (): Promise<boolean> => {
    if (typeof chrome === 'undefined' || !chrome.permissions) {
      return true;
    }
    const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
    if (hasPermission) {
      return true;
    }
    const granted = await chrome.permissions.request({ permissions: ['tabs'] });
    return granted;
  }, []);

  const updateNewTabPreference = useCallback(
    async (nextEnabled: boolean) => {
      const previous = newTabEnabled;
      setNewTabEnabled(nextEnabled);
      setIsUpdatingNewTab(true);
      setNewTabError(null);
      setNewTabMessage(null);
      try {
        if (nextEnabled) {
          const granted = await ensureNewTabPermission();
          if (!granted) {
            throw new Error('Die Tabs-Berechtigung wurde nicht erteilt.');
          }
        }

        await saveUserSettings({ newTabEnabled: nextEnabled });
        const response = await sendBackgroundMessage({
          type: 'settings.applyNewTab',
          enabled: nextEnabled,
        });

        if (response.type !== 'settings.applyNewTab.result') {
          throw new Error('Unerwartete Antwort vom Hintergrunddienst.');
        }

        if (nextEnabled && !response.enabled) {
          throw new Error(
            'Der Browser hat das Setzen von chrome_url_overrides verhindert. Prüfe die Tabs-Berechtigung.',
          );
        }

        setNewTabEnabled(response.enabled);
        if (response.enabled) {
          setNewTabMessage(
            'Neuer Tab aktiviert. Chrome übernimmt die chrome_url_overrides-Einstellung nach dem nächsten geöffneten Tab. Falls nichts passiert, lade die Erweiterung auf chrome://extensions neu. Firefox erfordert zusätzlich die Aktivierung von „Als Startseite verwenden“ in den Add-on-Einstellungen.',
          );
        } else {
          setNewTabMessage(
            'Neuer Tab deaktiviert. Der nächste neue Tab öffnet wieder die Standard-Startseite deines Browsers.',
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setNewTabError(message);
        setNewTabEnabled(previous);
        try {
          await saveUserSettings({ newTabEnabled: previous });
          void sendBackgroundMessage({ type: 'settings.applyNewTab', enabled: previous }).catch((error) => {
            console.warn('Failed to revert new tab override after error', error);
          });
        } catch (persistError) {
          console.warn('Failed to revert user settings after toggle error', persistError);
        }
      } finally {
        setIsUpdatingNewTab(false);
      }
    },
    [ensureNewTabPermission, newTabEnabled],
  );

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
        <h2>Neuer Tab (Opt-in)</h2>
        <p>
          Feathermarks kann als besonders schneller Startpunkt genutzt werden. Die Einstellung bleibt komplett
          optional und lässt sich jederzeit zurücksetzen.
        </p>

        <label class="toggle">
          <input
            type="checkbox"
            checked={newTabEnabled}
            disabled={isLoadingSettings || isUpdatingNewTab}
            onChange={(event) => updateNewTabPreference(event.currentTarget.checked)}
          />
          <span>Feathermarks als neuen Tab verwenden</span>
        </label>

        <p class="hint">
          Beim Aktivieren wird die <code>chrome_url_overrides</code>-Zuweisung gesetzt. Chrome lädt sie nach dem
          Öffnen des nächsten Tabs (oder nach einem manuellen Reload unter <code>chrome://extensions</code>). Firefox
          zeigt einen Hinweis, falls du das Add-on zusätzlich im Einstellungsdialog als Startseite freigeben musst.
        </p>

        {isUpdatingNewTab && <p class="status pending">Aktualisiere Einstellung…</p>}
        {newTabMessage && <p class="status success">{newTabMessage}</p>}
        {newTabError && <p class="status error">{newTabError}</p>}
      </section>

      <section class="panel">
        <h2>Smart Rules</h2>
        <p>
          Automatisiere die Kategorisierung neuer Bookmarks anhand von Host- oder URL-Mustern.
          Regeln wirken auf alle Speicher-Vorgänge, inklusive Importen.
        </p>

        <form class="rule-form" onSubmit={handleAddRule}>
          <div class="rule-form-grid">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={newRule.name}
                onInput={handleRuleInputChange('name')}
                placeholder="z. B. Videos"
                required
                disabled={isAddingRule}
              />
            </label>
            <label>
              <span>Host (optional)</span>
              <input
                type="text"
                value={newRule.host}
                onInput={handleRuleInputChange('host')}
                placeholder="youtube.com"
                disabled={isAddingRule}
              />
            </label>
            <label>
              <span>URL enthält (optional)</span>
              <input
                type="text"
                value={newRule.urlIncludes}
                onInput={handleRuleInputChange('urlIncludes')}
                placeholder="playlist,watch"
                disabled={isAddingRule}
              />
            </label>
            <label>
              <span>MIME-Typ (optional)</span>
              <input
                type="text"
                value={newRule.mime}
                onInput={handleRuleInputChange('mime')}
                placeholder="video/mp4"
                disabled={isAddingRule}
              />
            </label>
            <label>
              <span>Tags hinzufügen</span>
              <input
                type="text"
                value={newRule.addTags}
                onInput={handleRuleInputChange('addTags')}
                placeholder="video, inspiration"
                disabled={isAddingRule}
              />
            </label>
            <label>
              <span>Kategorie setzen</span>
              <input
                type="text"
                value={newRule.categoryId}
                onInput={handleRuleInputChange('categoryId')}
                placeholder="cat-videos"
                disabled={isAddingRule}
              />
            </label>
          </div>
          <div class="rule-form-actions">
            <button type="submit" disabled={isAddingRule}>Regel speichern</button>
            <span class="hint">
              Mehrere Tags oder URL-Teile bitte mit Komma trennen. Host-Matches gelten auch für Subdomains.
            </span>
          </div>
        </form>

        {rulesError && (
          <p class="rule-error" role="alert">
            {rulesError}
          </p>
        )}

        {isLoadingRules ? (
          <p class="hint">Regeln werden geladen…</p>
        ) : rules.length > 0 ? (
          <ul class="rule-list">
            {rules.map((rule) => (
              <li class="rule-item" key={rule.id}>
                <div class="rule-header">
                  <h3>{rule.name}</h3>
                  <span class={`rule-status ${rule.enabled ? 'enabled' : 'disabled'}`}>
                    {rule.enabled ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </div>
                <dl class="rule-details">
                  <div>
                    <dt>Bedingungen</dt>
                    <dd>{describeRuleConditions(rule)}</dd>
                  </div>
                  <div>
                    <dt>Aktionen</dt>
                    <dd>{describeRuleActions(rule)}</dd>
                  </div>
                </dl>
                <div class="rule-actions">
                  <button
                    type="button"
                    class="button-secondary"
                    disabled={ruleBusyId === rule.id}
                    onClick={() => handleToggleRule(rule)}
                  >
                    {rule.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  </button>
                  <button
                    type="button"
                    class="button-danger"
                    disabled={ruleBusyId === rule.id}
                    onClick={() => handleDeleteRule(rule)}
                  >
                    Entfernen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p class="rule-empty">Noch keine Regeln gespeichert.</p>
        )}
      </section>

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
