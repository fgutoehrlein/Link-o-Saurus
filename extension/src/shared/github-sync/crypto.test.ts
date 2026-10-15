import { describe, expect, it } from 'vitest';
import type { SyncSnapshotV1 } from './types';
import { decryptSnapshot, encryptSnapshot } from './crypto';

const payload: SyncSnapshotV1 = {
  format: 'link-o-saurus-sync',
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  boards: [],
  categories: [],
  bookmarks: [],
  tags: [],
  comments: [],
  readLater: [],
  sessions: [],
};

describe('GitHub sync encryption', () => {
  it('round-trips an encrypted snapshot', async () => {
    const encrypted = await encryptSnapshot(payload, 'correct horse battery staple');
    expect(encrypted.format).toBe('link-o-saurus-encrypted-sync');
    expect(await decryptSnapshot(encrypted, 'correct horse battery staple')).toEqual(payload);
  });

  it('rejects a wrong passphrase or altered ciphertext', async () => {
    const encrypted = await encryptSnapshot(payload, 'correct horse battery staple');
    await expect(decryptSnapshot(encrypted, 'wrong passphrase')).rejects.toThrow();

    const altered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` };
    await expect(decryptSnapshot(altered, 'correct horse battery staple')).rejects.toThrow();
  });

  it('rejects unsupported or malformed envelopes', async () => {
    await expect(decryptSnapshot({ ...await encryptSnapshot(payload, 'secret'), version: 2 } as never, 'secret'))
      .rejects.toThrow(/unsupported/i);
    await expect(decryptSnapshot({ format: 'link-o-saurus-encrypted-sync' } as never, 'secret'))
      .rejects.toThrow(/invalid/i);
  });
});
