import { validateSyncSnapshot } from './snapshot';
import type { EncryptedSyncFile, SyncSnapshotV1 } from './types';

const ITERATIONS = 310_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
};

const deriveKey = async (passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const isEnvelope = (value: unknown): value is EncryptedSyncFile => {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<EncryptedSyncFile>;
  return file.format === 'link-o-saurus-encrypted-sync'
    && file.version === 1
    && file.kdf === 'PBKDF2-SHA-256'
    && typeof file.iterations === 'number'
    && Number.isInteger(file.iterations)
    && file.iterations >= MIN_ITERATIONS
    && file.iterations <= MAX_ITERATIONS
    && file.cipher === 'AES-GCM'
    && typeof file.salt === 'string'
    && typeof file.iv === 'string'
    && typeof file.ciphertext === 'string';
};

export const encryptSnapshot = async (
  input: SyncSnapshotV1,
  passphrase: string,
): Promise<EncryptedSyncFile> => {
  if (!passphrase.trim()) throw new Error('Passphrase must not be empty');
  const snapshot = validateSyncSnapshot(input);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(snapshot)),
  );
  return {
    format: 'link-o-saurus-encrypted-sync',
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    cipher: 'AES-GCM',
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
};

export const decryptSnapshot = async (
  input: unknown,
  passphrase: string,
): Promise<SyncSnapshotV1> => {
  if (!isEnvelope(input)) throw new Error('Invalid or unsupported encrypted sync file');
  if (!passphrase.trim()) throw new Error('Passphrase must not be empty');
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = fromBase64(input.salt);
    iv = fromBase64(input.iv);
    ciphertext = fromBase64(input.ciphertext);
  } catch {
    throw new Error('Invalid encrypted sync file encoding');
  }
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
    throw new Error('Invalid encrypted sync file dimensions');
  }
  const key = await deriveKey(passphrase, salt, input.iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );
  return validateSyncSnapshot(JSON.parse(decoder.decode(plaintext)) as unknown);
};
