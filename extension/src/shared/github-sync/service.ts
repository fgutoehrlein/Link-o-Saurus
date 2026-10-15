import {
  applySyncSnapshot,
  db,
  getSyncBaseline,
  setSyncBaseline,
  type LinkOSaurusDB,
} from '../db';
import { GitHubApiConflictError, readSyncFile, writeSyncFile } from './github-api';
import { decryptSnapshot, encryptSnapshot } from './crypto';
import { collectSyncSnapshot, mergeSyncSnapshots } from './snapshot';
import type { SyncConflict, SyncSnapshotV1 } from './types';

export type SyncDirection = 'push' | 'pull';
export type InitialSyncChoice = 'merge' | 'replace-local' | 'replace-remote';

export interface SyncOptions {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  passphrase: string;
  initialChoice?: InitialSyncChoice;
  resolutions?: Record<string, 'local' | 'remote'>;
}

export type SyncResult =
  | { status: 'complete'; direction: SyncDirection; fileSha: string; counts: Record<string, number> }
  | { status: 'conflicts'; direction: SyncDirection; conflicts: SyncConflict[] }
  | { status: 'needs-initial-choice'; direction: SyncDirection; hasLocalData: boolean; hasRemoteData: boolean };

const emptySnapshot = (): SyncSnapshotV1 => ({
  format: 'link-o-saurus-sync',
  version: 1,
  exportedAt: new Date(0).toISOString(),
  boards: [],
  categories: [],
  bookmarks: [],
  tags: [],
  comments: [],
  readLater: [],
  sessions: [],
});

const hasData = (snapshot: SyncSnapshotV1): boolean =>
  snapshot.boards.length + snapshot.categories.length + snapshot.bookmarks.length
    + snapshot.tags.length + snapshot.comments.length + snapshot.readLater.length + snapshot.sessions.length > 0;

const counts = (snapshot: SyncSnapshotV1): Record<string, number> => ({
  boards: snapshot.boards.length,
  categories: snapshot.categories.length,
  bookmarks: snapshot.bookmarks.length,
  comments: snapshot.comments.length,
  readLater: snapshot.readLater.length,
  sessions: snapshot.sessions.length,
});

const unresolved = (conflicts: SyncConflict[], resolutions: SyncOptions['resolutions']): SyncConflict[] =>
  conflicts.filter((conflict) => !resolutions?.[conflict.key]);

const readRemote = async (options: SyncOptions) => {
  const file = await readSyncFile(options.owner, options.repo, options.branch, options.path);
  return file ? { ...file, snapshot: await decryptSnapshot(file.encryptedFile, options.passphrase) } : null;
};

const targetKey = (options: SyncOptions): string =>
  JSON.stringify([options.owner.toLowerCase(), options.repo.toLowerCase(), options.branch, options.path]);

const complete = (direction: SyncDirection, snapshot: SyncSnapshotV1, fileSha: string): SyncResult => ({
  status: 'complete',
  direction,
  fileSha,
  counts: counts(snapshot),
});

const sync = async (
  direction: SyncDirection,
  options: SyncOptions,
  database: LinkOSaurusDB,
): Promise<SyncResult> => {
  const baselineId = targetKey(options);
  const baseline = await getSyncBaseline(database, baselineId);
  const local = await collectSyncSnapshot(database);
  let remote = await readRemote(options);

  if (!baseline && remote) {
    if (!options.initialChoice) {
      return { status: 'needs-initial-choice', direction, hasLocalData: hasData(local), hasRemoteData: true };
    }
    if (options.initialChoice === 'replace-local') {
      if (direction !== 'pull') throw new Error('Choose Pull to replace local data with the repository snapshot');
      await applySyncSnapshot(database, remote.snapshot, local);
      await setSyncBaseline(database, { snapshot: remote.snapshot, fileSha: remote.sha }, baselineId);
      return complete('pull', remote.snapshot, remote.sha);
    }
    if (options.initialChoice === 'replace-remote') {
      if (direction !== 'push') throw new Error('Choose Push to replace the repository snapshot with local data');
      const file = await encryptSnapshot(local, options.passphrase);
      const { sha } = await writeSyncFile(options.owner, options.repo, options.branch, options.path, file, remote.sha);
      await setSyncBaseline(database, { snapshot: local, fileSha: sha }, baselineId);
      return complete('push', local, sha);
    }
  }

  if (direction === 'pull' && !remote) {
    throw new Error(baseline ? 'The remote sync file was deleted.' : 'No sync file exists in the selected repository. Push local data first.');
  }

  // If the file was deleted remotely, a deliberate Push recreates it from local state.
  const base = baseline && remote ? baseline.snapshot : emptySnapshot();
  const remoteSnapshot = remote?.snapshot ?? emptySnapshot();
  let merged = mergeSyncSnapshots(base, local, remoteSnapshot, options.resolutions);
  let conflicts = unresolved(merged.conflicts, options.resolutions);
  if (conflicts.length) return { status: 'conflicts', direction, conflicts };

  if (direction === 'pull') {
    await applySyncSnapshot(database, merged.snapshot, local);
    await setSyncBaseline(database, { snapshot: remote!.snapshot, fileSha: remote!.sha }, baselineId);
    return complete(direction, merged.snapshot, remote!.sha);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await encryptSnapshot(merged.snapshot, options.passphrase);
      const { sha } = await writeSyncFile(
        options.owner,
        options.repo,
        options.branch,
        options.path,
        file,
        remote?.sha,
      );
      await applySyncSnapshot(database, merged.snapshot, local);
      await setSyncBaseline(database, { snapshot: merged.snapshot, fileSha: sha }, baselineId);
      return complete(direction, merged.snapshot, sha);
    } catch (error) {
      if (!(error instanceof GitHubApiConflictError) || attempt === 1) throw error;
      remote = await readRemote(options);
      if (!remote) throw new Error('The remote sync file changed or was deleted during push.');
      merged = mergeSyncSnapshots(base, local, remote.snapshot, options.resolutions);
      conflicts = unresolved(merged.conflicts, options.resolutions);
      if (conflicts.length) return { status: 'conflicts', direction, conflicts };
    }
  }
  throw new Error('GitHub sync did not complete');
};

export const pushSync = (options: SyncOptions, database: LinkOSaurusDB = db): Promise<SyncResult> =>
  sync('push', options, database);

export const pullSync = (options: SyncOptions, database: LinkOSaurusDB = db): Promise<SyncResult> =>
  sync('pull', options, database);
