import { proxy, wrap, releaseProxy } from 'comlink';
import type { Remote } from 'comlink';
import type { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import ImportExportWorker from '../shared/import-export-worker?worker&module';
import {
  createRule,
  deleteRule,
  DEFAULT_SYNC_SETTINGS,
  getUserSettings,
  listRules,
  saveUserSettings,
  updateRule,
} from '../shared/db';
import { sendBackgroundMessage } from '../shared/messaging';
import { initialImport } from '../shared/bookmark-sync';
import type {
  ImportExportWorkerApi,
  ImportProgressHandler,
} from '../shared/import-export-worker';
import type { ExportFormat, ImportProgress, ImportResult } from '../shared/import-export';
import type { Rule } from '../shared/types';
import './App.css';
import { computeProgressRatio, formatPercent, stageLabel } from './utils/import-progress';
import { describeRuleActions, describeRuleConditions, parseCsvInput } from './utils/rule-formatting';
import { downloadBlob } from './utils/download';

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

const App: FunctionalComponent = () => {
  const workerRef = useRef<Worker>();
  const apiRef = useRef<Remote<ImportExportWorkerApi>>();
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [newTabEnabled, setNewTabEnabled] = useState(false);
  const [isUpdatingNewTab, setIsUpdatingNewTab] = useState(false);
  const [newTabMessage, setNewTabMessage] = useState<string | null>(null);
  const [newTabError, setNewTabError] = useState<string | null>(null);
  const [syncSettings, setSyncSettings] = useState(DEFAULT_SYNC_SETTINGS);
  const [isSavingSync, setIsSavingSync] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isRunningInitialImport, setIsRunningInitialImport] = useState(false);
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
    let cancelled = false;
    (async () => {
      try {
        const settings = await getUserSettings();
        if (!cancelled) {
          setNewTabEnabled(settings.newTabEnabled);
          setSyncSettings(settings.bookmarkSync);
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

  const updateSyncPreference = useCallback(
    async (changes: Partial<typeof syncSettings>) => {
      setIsSavingSync(true);
      setSyncMessage(null);
      setSyncError(null);
      try {
        const nextSettings = { ...syncSettings, ...changes };
        const stored = await saveUserSettings({ bookmarkSync: nextSettings });
        setSyncSettings(stored.bookmarkSync);
        setSyncMessage('Sync-Einstellungen gespeichert. Service Worker ggf. neu laden.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSyncError(message);
      } finally {
        setIsSavingSync(false);
      }
    },
    [syncSettings],
  );

  const triggerInitialImport = useCallback(async () => {
    setIsRunningInitialImport(true);
    setSyncMessage(null);
    setSyncError(null);
    try {
      await initialImport({ importFolderHierarchy: syncSettings.importFolderHierarchy });
      setSyncMessage('Initial-Import abgeschlossen.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSyncError(message);
    } finally {
      setIsRunningInitialImport(false);
    }
  }, [syncSettings.importFolderHierarchy]);

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
        const callbacks = proxy({ onProgress: handleProgress });
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
          Link-o-Saurus kann als besonders schneller Startpunkt genutzt werden. Die Einstellung bleibt komplett
          optional und lässt sich jederzeit zurücksetzen.
        </p>

        <label class="toggle">
          <input
            type="checkbox"
            checked={newTabEnabled}
            disabled={isLoadingSettings || isUpdatingNewTab}
            onChange={(event) => updateNewTabPreference(event.currentTarget.checked)}
          />
          <span>Link-o-Saurus als neuen Tab verwenden</span>
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
        <h2>Bookmark-Sync</h2>
        <p>
          Steuere die bidirektionale Synchronisation mit dem nativen Lesezeichenbaum. Änderungen an den Einstellungen
          greifen sofort; bei Bedarf den Service Worker neu laden.
        </p>

        <label class="toggle">
          <input
            type="checkbox"
            checked={syncSettings.enableBidirectional}
            disabled={isSavingSync || isLoadingSettings}
            onChange={(event) => updateSyncPreference({ enableBidirectional: event.currentTarget.checked })}
          />
          <span>Bidirektionale Synchronisation aktivieren</span>
        </label>

        <label class="toggle">
          <input
            type="checkbox"
            checked={syncSettings.importFolderHierarchy}
            disabled={isSavingSync}
            onChange={(event) => updateSyncPreference({ importFolderHierarchy: event.currentTarget.checked })}
          />
          <span>Ordnerhierarchie importieren</span>
        </label>

        <label class="toggle">
          <span>Beim Löschen</span>
          <select
            value={syncSettings.deleteBehavior}
            disabled={isSavingSync}
            onChange={(event) =>
              updateSyncPreference({ deleteBehavior: event.currentTarget.value as typeof syncSettings.deleteBehavior })
            }
          >
            <option value="delete">Nativer Bookmark wird gelöscht</option>
            <option value="archive">Nur archivieren (native Kopie bleibt)</option>
          </select>
        </label>

        <button type="button" disabled={isRunningInitialImport || isSavingSync} onClick={triggerInitialImport}>
          {isRunningInitialImport ? 'Import läuft…' : 'Initial-Import jetzt ausführen'}
        </button>

        <p class="hint">
          Warnung: Bei destruktiven Aktionen (Löschen/Archivieren) werden Änderungen sofort übernommen. Starte den
          Import nur, wenn der Mirror-Ordner aktuell ist.
        </p>

        {syncMessage && <p class="status success">{syncMessage}</p>}
        {syncError && <p class="status error">{syncError}</p>}
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
