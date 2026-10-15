import { getGitHubAccessToken } from './auth';
import type { EncryptedSyncFile } from './types';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

interface GitHubRepositoryResponse {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
}

export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubApiConflictError extends GitHubApiError {
  constructor() {
    super('The remote sync file changed. Fetch it again before updating.', 409);
    this.name = 'GitHubApiConflictError';
  }
}

const pathSegments = (path: string): string => {
  const normalized = path.trim();
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\\')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || /[\u0000-\u001f]/u.test(normalized)) {
    throw new Error('Sync file path must be a safe repository-relative path');
  }
  return segments.map(encodeURIComponent).join('/');
};

const repoPath = (owner: string, repo: string, suffix: string): string => {
  if (!owner.trim() || !repo.trim()) throw new Error('Choose a GitHub repository first');
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
};

const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const token = await getGitHubAccessToken();
  return fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
};

const readJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    if (response.status === 409 || response.status === 422) throw new GitHubApiConflictError();
    if (response.status === 401) throw new GitHubApiError('GitHub authorization failed. Reconnect and try again.', 401);
    if (response.status === 403 || response.status === 429) {
      throw new GitHubApiError('GitHub denied the request or rate limit was reached.', response.status);
    }
    throw new GitHubApiError(`GitHub request failed (${response.status}).`, response.status);
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new GitHubApiError('GitHub returned an invalid response.', response.status);
  }
};

const isRepository = (value: unknown): value is GitHubRepositoryResponse => {
  if (!value || typeof value !== 'object') return false;
  const repo = value as Record<string, unknown>;
  return typeof repo.id === 'number'
    && typeof repo.name === 'string'
    && typeof repo.full_name === 'string'
    && typeof repo.default_branch === 'string'
    && typeof repo.private === 'boolean'
    && typeof repo.owner === 'object'
    && repo.owner !== null
    && typeof (repo.owner as Record<string, unknown>).login === 'string';
};

export const listAccessibleRepositories = async (): Promise<GitHubRepository[]> => {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = `${API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner%2Ccollaborator%2Corganization_member`;
    const body = await readJson(await request(url));
    if (!Array.isArray(body) || !body.every(isRepository)) {
      throw new GitHubApiError('GitHub returned an invalid repository list.', 200);
    }
    repositories.push(...body.map((repo) => ({
      id: repo.id,
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    })));
    if (body.length < 100) return repositories;
  }
  throw new GitHubApiError('GitHub returned too many repositories to list safely.', 200);
};

export const listRepositoryBranches = async (owner: string, repo: string): Promise<string[]> => {
  const branches: string[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = `${API}${repoPath(owner, repo, '/branches')}?per_page=100&page=${page}`;
    const body = await readJson(await request(url));
    if (!Array.isArray(body) || !body.every((branch) => branch && typeof branch === 'object' && typeof (branch as Record<string, unknown>).name === 'string')) {
      throw new GitHubApiError('GitHub returned an invalid branch list.', 200);
    }
    branches.push(...body.map((branch) => (branch as { name: string }).name));
    if (body.length < 100) return branches;
  }
  throw new GitHubApiError('GitHub returned too many branches to list safely.', 200);
};

const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): string => {
  const binary = atob(value.replace(/\s/gu, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

export const readSyncFile = async (
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<{ encryptedFile: EncryptedSyncFile; sha: string } | null> => {
  if (!branch.trim()) throw new Error('Choose a GitHub branch first');
  const url = `${API}${repoPath(owner, repo, `/contents/${pathSegments(path)}`)}?ref=${encodeURIComponent(branch)}`;
  const response = await request(url);
  if (response.status === 404) return null;
  const body = await readJson(response);
  if (!body || typeof body !== 'object') throw new GitHubApiError('GitHub returned an invalid sync file response.', 200);
  const content = body as Record<string, unknown>;
  if (typeof content.sha !== 'string') {
    throw new GitHubApiError('The selected repository file is not a readable JSON sync file.', 200);
  }
  let json: string;
  if (content.encoding === 'base64' && typeof content.content === 'string') {
    json = fromBase64(content.content);
  } else if (content.encoding === 'none' && content.content === '') {
    const raw = await request(url, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!raw.ok) throw new GitHubApiError(`GitHub request failed (${raw.status}).`, raw.status);
    json = await raw.text();
  } else {
    throw new GitHubApiError('The selected repository file is not a readable JSON sync file.', 200);
  }
  try {
    return { encryptedFile: JSON.parse(json) as EncryptedSyncFile, sha: content.sha };
  } catch {
    throw new GitHubApiError('The selected repository file does not contain valid JSON.', 200);
  }
};

export const writeSyncFile = async (
  owner: string,
  repo: string,
  branch: string,
  path: string,
  encryptedFile: EncryptedSyncFile,
  currentSha?: string,
): Promise<{ sha: string }> => {
  if (!branch.trim()) throw new Error('Choose a GitHub branch first');
  const url = `${API}${repoPath(owner, repo, `/contents/${pathSegments(path)}`)}`;
  const body = await readJson(await request(url, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Update Link-o-Saurus sync data',
      branch,
      content: toBase64(JSON.stringify(encryptedFile)),
      ...(currentSha ? { sha: currentSha } : {}),
    }),
  }));
  if (!body || typeof body !== 'object' || typeof (body as { content?: { sha?: unknown } }).content?.sha !== 'string') {
    throw new GitHubApiError('GitHub did not confirm the sync file update.', 200);
  }
  return { sha: (body as { content: { sha: string } }).content.sha };
};
