import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savePatToken } from './auth';
import {
  GitHubApiConflictError,
  listAccessibleRepositories,
  listRepositoryBranches,
  readSyncFile,
  writeSyncFile,
} from './github-api';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('GitHub repository sync API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    let stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => { stored = { ...stored, ...value }; }),
          remove: vi.fn(async (key: string) => { delete stored[key]; }),
        },
      },
    });
    await savePatToken('token-for-tests');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists all accessible repositories across pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      name: `repo-${index}`,
      full_name: `owner/repo-${index}`,
      owner: { login: 'owner' },
      default_branch: 'main',
      private: true,
    }));
    fetchMock
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([{
        id: 101, name: 'last', full_name: 'owner/last', owner: { login: 'owner' }, default_branch: 'trunk', private: true,
      }]));

    const repositories = await listAccessibleRepositories();
    expect(repositories).toHaveLength(101);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('page=1');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('page=2');
    expect(repositories[100]).toMatchObject({ fullName: 'owner/last', defaultBranch: 'trunk' });
  });

  it('lists repository branches', async () => {
    fetchMock.mockResolvedValueOnce(response([{ name: 'main' }, { name: 'work' }]));
    expect(await listRepositoryBranches('owner', 'repo')).toEqual(['main', 'work']);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/repos/owner/repo/branches');
  });

  it('reads a JSON file and returns its current SHA', async () => {
    const encryptedFile = { format: 'link-o-saurus-encrypted-sync', version: 1 };
    const content = btoa(JSON.stringify(encryptedFile));
    fetchMock.mockResolvedValueOnce(response({ content, encoding: 'base64', sha: 'file-sha' }));

    expect(await readSyncFile('owner', 'repo', 'main', 'link-o-saurus/sync.json'))
      .toEqual({ encryptedFile, sha: 'file-sha' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('ref=main');
  });

  it('downloads large sync files using GitHub raw content mode', async () => {
    const encryptedFile = { format: 'link-o-saurus-encrypted-sync', version: 1 };
    fetchMock
      .mockResolvedValueOnce(response({ content: '', encoding: 'none', sha: 'large-file-sha' }))
      .mockResolvedValueOnce(new Response(JSON.stringify(encryptedFile), { status: 200 }));

    expect(await readSyncFile('owner', 'repo', 'main', 'sync.json'))
      .toEqual({ encryptedFile, sha: 'large-file-sha' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Accept: 'application/vnd.github.raw+json' });
  });

  it('returns null for a missing file and rejects traversal paths', async () => {
    fetchMock.mockResolvedValueOnce(response({ message: 'Not Found' }, 404));
    expect(await readSyncFile('owner', 'repo', 'main', 'sync.json')).toBeNull();
    await expect(readSyncFile('owner', 'repo', 'main', '../secrets.json')).rejects.toThrow(/path/i);
  });

  it('writes a new file or updates with the current SHA', async () => {
    fetchMock.mockResolvedValueOnce(response({ content: { sha: 'new-sha' } }, 201));
    expect(await writeSyncFile('owner', 'repo', 'main', 'sync.json', { format: 'test' } as never))
      .toEqual({ sha: 'new-sha' });
    const createBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(createBody.sha).toBeUndefined();

    fetchMock.mockResolvedValueOnce(response({ content: { sha: 'updated-sha' } }, 200));
    expect(await writeSyncFile('owner', 'repo', 'main', 'sync.json', { format: 'test' } as never, 'old-sha'))
      .toEqual({ sha: 'updated-sha' });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).sha).toBe('old-sha');
  });

  it('surfaces a changed remote file as a conflict', async () => {
    fetchMock.mockResolvedValueOnce(response({ message: 'Conflict' }, 409));
    await expect(writeSyncFile('owner', 'repo', 'main', 'sync.json', { format: 'test' } as never, 'sha'))
      .rejects.toBeInstanceOf(GitHubApiConflictError);
  });
});
