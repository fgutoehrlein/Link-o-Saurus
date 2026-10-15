import type { FunctionalComponent } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  disconnectGitHub,
  type DeviceAuthorization,
  getStoredGitHubAuth,
  pollDeviceAuthorization,
  savePatToken,
  startDeviceAuthorization,
} from '../shared/github-sync/auth';
import {
  listAccessibleRepositories,
  listRepositoryBranches,
  type GitHubRepository,
} from '../shared/github-sync/github-api';
import { getGitHubSyncSettings, saveGitHubSyncSettings, type GitHubSyncSettings } from '../shared/github-sync/settings';
import { pullSync, pushSync, type SyncDirection, type SyncOptions, type SyncResult } from '../shared/github-sync/service';
import type { SyncConflict } from '../shared/github-sync/types';
import './GitHubSyncPanel.css';

const githubAppClientId = import.meta.env.VITE_GITHUB_APP_CLIENT_ID ?? '';

type DeviceFlow = DeviceAuthorization & { clientId: string };
type PendingConflicts = { direction: SyncDirection; conflicts: SyncConflict[]; resolutions: Record<string, 'local' | 'remote'> };
type PendingInitial = Extract<SyncResult, { status: 'needs-initial-choice' }>;
const githubDataTypes = ['authenticationInfo', 'bookmarksInfo', 'websiteActivity'];
type FirefoxPermissions = {
  contains: (permissions: { data_collection: string[] }) => Promise<boolean>;
  request: (permissions: { data_collection: string[] }) => Promise<boolean>;
};
const firefoxPermissions = (): FirefoxPermissions | undefined =>
  (globalThis as typeof globalThis & { browser?: { permissions?: FirefoxPermissions } }).browser?.permissions;

const GitHubSyncPanel: FunctionalComponent = () => {
  const [authMode, setAuthMode] = useState<'pat' | 'github-app' | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [settings, setSettings] = useState<GitHubSyncSettings>({ owner: '', repo: '', branch: '', path: 'link-o-saurus/sync.json' });
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [pendingInitial, setPendingInitial] = useState<PendingInitial | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<PendingConflicts | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const ensureDataPermission = async () => {
    const permissions = firefoxPermissions();
    if (!permissions) return true;
    if (await permissions.contains({ data_collection: githubDataTypes })) return true;
    return permissions.request({ data_collection: githubDataTypes });
  };

  const loadRepositories = useCallback(async (savedSettings: GitHubSyncSettings) => {
    const available = (await listAccessibleRepositories()).filter((repo) => repo.isPrivate);
    setRepositories(available);
    if (savedSettings.owner && savedSettings.repo) {
      setBranches(await listRepositoryBranches(savedSettings.owner, savedSettings.repo));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getStoredGitHubAuth(), getGitHubSyncSettings()])
      .then(async ([auth, savedSettings]) => {
        if (cancelled) return;
        setAuthMode(auth?.mode ?? null);
        setSettings(savedSettings);
        if (auth && await ensureDataPermission()) await loadRepositories(savedSettings);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'GitHub settings could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [loadRepositories]);

  useEffect(() => {
    if (!deviceFlow) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void pollDeviceAuthorization(deviceFlow.clientId, deviceFlow.deviceCode, deviceFlow.interval)
        .then(async (result) => {
          if (cancelled) return;
          if (result.status === 'pending') {
            setDeviceFlow((current) => current ? { ...current, interval: result.interval } : null);
            return;
          }
          setDeviceFlow(null);
          setAuthMode('github-app');
          setMessage('GitHub connected. Choose a private repository.');
          await loadRepositories(await getGitHubSyncSettings());
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setDeviceFlow(null);
          setError(reason instanceof Error ? reason.message : 'GitHub sign-in failed.');
        });
    }, Math.max(deviceFlow.interval, 5) * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deviceFlow, loadRepositories]);

  const connectPat = async () => {
    setError('');
    setMessage('');
    try {
      if (!await ensureDataPermission()) throw new Error('GitHub sync data permission is required.');
      await savePatToken(tokenInput);
      setTokenInput('');
      setAuthMode('pat');
      const current = await getGitHubSyncSettings();
      await loadRepositories(current);
      setMessage('GitHub connected. Choose a private repository.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect to GitHub.');
    }
  };

  const connectGitHubApp = async () => {
    setError('');
    setMessage('');
    try {
      if (!await ensureDataPermission()) throw new Error('GitHub sync data permission is required.');
      const flow = await startDeviceAuthorization(githubAppClientId);
      setDeviceFlow({ ...flow, clientId: githubAppClientId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start GitHub sign-in.');
    }
  };

  const refreshRepositories = async () => {
    setError('');
    try {
      if (!await ensureDataPermission()) throw new Error('GitHub sync data permission is required.');
      await loadRepositories(await getGitHubSyncSettings());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load GitHub repositories.');
    }
  };

  const disconnect = async () => {
    await disconnectGitHub();
    setAuthMode(null);
    setPassphrase('');
    setDeviceFlow(null);
    setRepositories([]);
    setBranches([]);
    setMessage('GitHub disconnected.');
  };

  const persistSettings = async (changes: Partial<GitHubSyncSettings>) => {
    const next = await saveGitHubSyncSettings(changes);
    setSettings(next);
    return next;
  };

  const chooseRepository = async (fullName: string) => {
    const repo = repositories.find((candidate) => candidate.fullName === fullName);
    if (!repo) return;
    setBranches([]);
    setError('');
    try {
      const next = await persistSettings({ owner: repo.owner, repo: repo.name, branch: repo.defaultBranch });
      setBranches(await listRepositoryBranches(repo.owner, repo.name));
      if (next.branch !== settings.branch) setSettings(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load repository branches.');
    }
  };

  const runSync = async (
    direction: SyncDirection,
    extra: Pick<SyncOptions, 'initialChoice' | 'resolutions'> = {},
  ) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!await ensureDataPermission()) throw new Error('GitHub sync data permission is required.');
      const options: SyncOptions = { ...settings, passphrase, ...extra };
      const result = direction === 'push' ? await pushSync(options) : await pullSync(options);
      if (result.status === 'needs-initial-choice') {
        setPendingInitial(result);
        setPendingConflicts(null);
      } else if (result.status === 'conflicts') {
        setPendingInitial(null);
        setPendingConflicts((current) => ({
          direction,
          conflicts: result.conflicts,
          resolutions: current?.direction === direction ? current.resolutions : {},
        }));
      } else {
        setPendingInitial(null);
        setPendingConflicts(null);
        setMessage(`${direction === 'push' ? 'Pushed' : 'Pulled'} ${result.counts.bookmarks} bookmarks and ${result.counts.sessions} sessions.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GitHub sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const resolveConflict = async (conflict: SyncConflict, choice: 'local' | 'remote') => {
    if (!pendingConflicts) return;
    const resolutions = { ...pendingConflicts.resolutions, [conflict.key]: choice };
    setPendingConflicts({ ...pendingConflicts, resolutions });
    if (pendingConflicts.conflicts.every((candidate) => resolutions[candidate.key])) {
      await runSync(pendingConflicts.direction, { resolutions });
    }
  };

  const selectedRepository = `${settings.owner}/${settings.repo}`;

  return (
    <section class="panel github-sync-panel" aria-labelledby="github-sync-title">
      <h3 id="github-sync-title">GitHub Sync</h3>
      <p>Use a private repository to sync your Link-o-Saurus bookmarks and sessions between PCs. The sync JSON is encrypted; keep the same passphrase on each PC.</p>

      {!authMode && (
        <div class="github-auth-options">
          <details class="github-pat-setup">
            <summary>Connect with a personal access token</summary>
            <p>Create a fine-grained token on GitHub. Select only the private repository you want to use, then grant <strong>Contents: Read and write</strong>. Repository listing may also require <strong>Metadata: Read-only</strong>.</p>
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a fine-grained token on GitHub</a>
            <label>
              Personal access token
              <input type="password" autoComplete="off" value={tokenInput} onInput={(event) => setTokenInput(event.currentTarget.value)} />
            </label>
            <button type="button" disabled={!tokenInput.trim() || busy} onClick={() => void connectPat()}>Connect with token</button>
          </details>
          <button type="button" disabled={!githubAppClientId || busy} onClick={() => void connectGitHubApp()}>
            {githubAppClientId ? 'Sign in with GitHub' : 'GitHub sign-in needs app configuration'}
          </button>
          {!githubAppClientId && <p class="hint">Set VITE_GITHUB_APP_CLIENT_ID when building the extension to enable GitHub sign-in.</p>}
        </div>
      )}

      {deviceFlow && (
        <p class="github-device-code" role="status">
          Open <a href={deviceFlow.verificationUri} target="_blank" rel="noreferrer">{deviceFlow.verificationUri}</a> and enter code <strong>{deviceFlow.userCode}</strong>.
          <button type="button" onClick={() => setDeviceFlow(null)}>Cancel</button>
        </p>
      )}

      {authMode && (
        <>
          <p class="hint">Connected with {authMode === 'pat' ? 'a personal access token' : 'GitHub'}.</p>
          <button type="button" disabled={busy} onClick={() => void refreshRepositories()}>Load private repositories</button>
          <label>
            Private repository
            <select value={selectedRepository === '/' ? '' : selectedRepository} onChange={(event) => void chooseRepository(event.currentTarget.value)}>
              <option value="">Choose a repository</option>
              {repositories.map((repo) => <option key={repo.id} value={repo.fullName}>{repo.fullName}</option>)}
            </select>
          </label>
          <label>
            Branch
            <select value={settings.branch} disabled={!branches.length} onChange={(event) => void persistSettings({ branch: event.currentTarget.value })}>
              {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
          </label>
          <label>
            Sync file path
            <input value={settings.path} onInput={(event) => setSettings((current) => ({ ...current, path: event.currentTarget.value }))} onBlur={() => void persistSettings({ path: settings.path })} />
          </label>
          <label>
            Sync passphrase
            <input type="password" autoComplete="off" value={passphrase} onInput={(event) => setPassphrase(event.currentTarget.value)} />
          </label>
          <div class="github-sync-actions">
            <button type="button" disabled={busy || !settings.repo || !settings.branch || !passphrase} onClick={() => void runSync('push')}>
              {busy ? 'Syncing…' : 'Push'}
            </button>
            <button type="button" disabled={busy || !settings.repo || !settings.branch || !passphrase} onClick={() => void runSync('pull')}>
              Pull
            </button>
            <button type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
          </div>
        </>
      )}

      {pendingInitial && (
        <div class="github-sync-choice" role="group" aria-label="First sync choice">
          <p>This repository already has sync data. Choose how to combine it with this PC.</p>
          {pendingInitial.direction === 'pull' && <button type="button" disabled={busy} onClick={() => void runSync('pull', { initialChoice: 'replace-local' })}>Use repository data on this PC</button>}
          <button type="button" disabled={busy} onClick={() => void runSync(pendingInitial.direction, { initialChoice: 'merge' })}>Merge by record ID</button>
          {pendingInitial.direction === 'push' && <button type="button" disabled={busy} onClick={() => void runSync('push', { initialChoice: 'replace-remote' })}>Replace repository file with this PC</button>}
        </div>
      )}

      {pendingConflicts && (
        <div class="github-sync-conflicts" aria-live="polite">
          <h4>Resolve sync conflicts</h4>
          {pendingConflicts.conflicts.map((conflict) => (
            <div class="github-sync-conflict" key={conflict.key}>
              <p><strong>{conflict.collection}: {conflict.id}</strong></p>
              <p>Local: {conflict.local === null ? 'deleted' : JSON.stringify(conflict.local).slice(0, 180)}</p>
              <p>GitHub: {conflict.remote === null ? 'deleted' : JSON.stringify(conflict.remote).slice(0, 180)}</p>
              <button type="button" disabled={busy} onClick={() => void resolveConflict(conflict, 'local')}>Keep local</button>
              <button type="button" disabled={busy} onClick={() => void resolveConflict(conflict, 'remote')}>Keep GitHub</button>
            </div>
          ))}
        </div>
      )}

      {message && <p class="status success" role="status">{message}</p>}
      {error && <p class="status error" role="alert">{error}</p>}
    </section>
  );
};

export default GitHubSyncPanel;
