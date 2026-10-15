const STORAGE_KEY = 'github-sync-settings';

export interface GitHubSyncSettings {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

const DEFAULT_SETTINGS: GitHubSyncSettings = {
  owner: '',
  repo: '',
  branch: '',
  path: 'link-o-saurus/sync.json',
};

const storage = (): chrome.storage.LocalStorageArea => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('Extension local storage is unavailable');
  }
  return chrome.storage.local;
};

export const getGitHubSyncSettings = async (): Promise<GitHubSyncSettings> => {
  const result = await storage().get(STORAGE_KEY);
  const value: unknown = result[STORAGE_KEY];
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const stored = value as Partial<GitHubSyncSettings>;
  return {
    owner: typeof stored.owner === 'string' ? stored.owner : '',
    repo: typeof stored.repo === 'string' ? stored.repo : '',
    branch: typeof stored.branch === 'string' ? stored.branch : '',
    path: typeof stored.path === 'string' && stored.path ? stored.path : DEFAULT_SETTINGS.path,
  };
};

export const saveGitHubSyncSettings = async (changes: Partial<GitHubSyncSettings>): Promise<GitHubSyncSettings> => {
  const current = await getGitHubSyncSettings();
  const next = { ...current, ...changes };
  if (Object.values(next).some((value) => typeof value !== 'string' || value.length > 500)) {
    throw new Error('GitHub sync settings contain an invalid value');
  }
  await storage().set({ [STORAGE_KEY]: next });
  return next;
};
