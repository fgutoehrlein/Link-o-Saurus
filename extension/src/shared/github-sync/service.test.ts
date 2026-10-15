import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, getSyncBaseline, setSyncBaseline } from '../db';
import { savePatToken } from './auth';
import { decryptSnapshot, encryptSnapshot } from './crypto';
import { pullSync, pushSync, type SyncOptions } from './service';
import type { SyncSnapshotV1 } from './types';

const makeSnapshot = (title: string, session = false): SyncSnapshotV1 => ({
  format: 'link-o-saurus-sync',
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  boards: [{ id: 'board-1', title, sortOrder: 0, createdAt: 1, updatedAt: 1 }],
  categories: [],
  bookmarks: [],
  tags: [],
  comments: [],
  readLater: [],
  sessions: session ? [{ id: 'session-1', title: 'Saved', savedAt: 1, tabs: [{ url: 'https://example.com/' }] }] : [],
});

const options: SyncOptions = {
  owner: 'owner', repo: 'repo', branch: 'main', path: 'link-o-saurus/sync.json', passphrase: 'shared passphrase',
};
const optionsTarget = JSON.stringify([options.owner, options.repo, options.branch, options.path]);

const contentsResponse = (file: unknown, sha: string) => ({
  content: btoa(JSON.stringify(file)), encoding: 'base64', sha,
});

describe('GitHub sync service', () => {
  let database: ReturnType<typeof createDatabase>;
  let remoteFile: unknown | null;
  let remoteSha: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let writes: number;

  beforeEach(async () => {
    database = createDatabase(`github-sync-${crypto.randomUUID()}`);
    remoteFile = null;
    remoteSha = 'remote-sha-1';
    writes = 0;
    let stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { stored = { ...stored, ...value }; }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    } } });
    await savePatToken('token-for-tests');
    fetchMock = vi.fn();
    fetchMock.mockImplementation(async (input: string, init?: RequestInit): Promise<Response> => {
      void input;
      if (init?.method === 'PUT') {
        writes += 1;
        const payload = JSON.parse(String(init.body)) as { content: string };
        remoteFile = JSON.parse(atob(payload.content));
        remoteSha = `remote-sha-${writes + 1}`;
        return new Response(JSON.stringify({ content: { sha: remoteSha } }), { status: 201 });
      }
      if (!remoteFile) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      return new Response(JSON.stringify(contentsResponse(remoteFile, remoteSha)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await database.delete();
  });

  it('pushes a local snapshot to an empty remote file and records its baseline', async () => {
    await database.boards.put(makeSnapshot('Local').boards[0]!);
    const result = await pushSync(options, database);

    expect(result).toMatchObject({ status: 'complete', direction: 'push', fileSha: 'remote-sha-2' });
    expect(writes).toBe(1);
    expect(await decryptSnapshot(remoteFile, options.passphrase)).toMatchObject({ boards: [{ title: 'Local' }] });
    expect(await getSyncBaseline(database, optionsTarget)).toMatchObject({ fileSha: 'remote-sha-2' });
  });

  it('requires a first-pull choice and then applies the remote sessions', async () => {
    remoteFile = await encryptSnapshot(makeSnapshot('Remote', true), options.passphrase);
    const pending = await pullSync(options, database);
    expect(pending).toMatchObject({ status: 'needs-initial-choice', hasLocalData: false, hasRemoteData: true });
    expect(await database.sessions.toArray()).toEqual([]);

    const result = await pullSync({ ...options, initialChoice: 'replace-local' }, database);
    expect(result).toMatchObject({ status: 'complete', direction: 'pull' });
    expect(await database.boards.toArray()).toMatchObject([{ title: 'Remote' }]);
    expect(await database.sessions.toArray()).toMatchObject([{ id: 'session-1' }]);
    expect(await getSyncBaseline(database, optionsTarget)).toMatchObject({ snapshot: { boards: [{ title: 'Remote' }] } });
  });

  it('surfaces same-record conflicts and applies the selected remote version', async () => {
    const base = makeSnapshot('Base');
    await database.boards.put(base.boards[0]!);
    await setSyncBaseline(database, { snapshot: base, fileSha: remoteSha }, optionsTarget);
    remoteFile = await encryptSnapshot(makeSnapshot('Remote edit'), options.passphrase);
    await database.boards.put({ ...base.boards[0]!, title: 'Local edit', updatedAt: 2 });

    const pending = await pushSync(options, database);
    expect(pending).toMatchObject({ status: 'conflicts', conflicts: [{ key: 'boards/board-1' }] });
    expect(writes).toBe(0);

    const resolved = await pushSync({ ...options, resolutions: { 'boards/board-1': 'remote' } }, database);
    expect(resolved.status).toBe('complete');
    expect(await database.boards.toArray()).toMatchObject([{ title: 'Remote edit' }]);
    expect(writes).toBe(1);
  });

  it('re-reads and re-merges when another PC updates the remote during a push', async () => {
    const base = makeSnapshot('Base');
    await database.boards.put(base.boards[0]!);
    await setSyncBaseline(database, { snapshot: base, fileSha: remoteSha }, optionsTarget);
    remoteFile = await encryptSnapshot(base, options.passphrase);
    await database.boards.put({ ...base.boards[0]!, title: 'Local edit', updatedAt: 2 });
    const newerRemote = await encryptSnapshot(makeSnapshot('Other PC edit'), options.passphrase);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'PUT') {
        writes += 1;
        remoteFile = newerRemote;
        remoteSha = 'remote-sha-newer';
        return new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 });
      }
      return new Response(JSON.stringify(contentsResponse(remoteFile, remoteSha)), { status: 200 });
    });

    const result = await pushSync(options, database);

    expect(result).toMatchObject({ status: 'conflicts', conflicts: [{ key: 'boards/board-1' }] });
    expect(writes).toBe(1);
    expect(await database.boards.toArray()).toMatchObject([{ title: 'Local edit' }]);
  });

  it('preserves local edits made while a remote push is in flight', async () => {
    await database.boards.put(makeSnapshot('Before push').boards[0]!);
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'PUT') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        remoteFile = JSON.parse(atob(payload.content));
        await database.boards.put({ ...makeSnapshot('Edited during push').boards[0]!, updatedAt: 2 });
        remoteSha = 'remote-sha-after-race';
        return new Response(JSON.stringify({ content: { sha: remoteSha } }), { status: 201 });
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    });

    await expect(pushSync(options, database)).rejects.toThrow(/changed during sync/i);
    expect(await database.boards.toArray()).toMatchObject([{ title: 'Edited during push' }]);
    expect(await getSyncBaseline(database, optionsTarget)).toBeUndefined();
  });
});
