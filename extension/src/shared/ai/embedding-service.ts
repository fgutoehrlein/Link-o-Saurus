import { wrap } from 'comlink';
import EmbeddingWorkerFactory from './embedding-worker?worker&module';
import type { EmbeddingWorker } from './embedding-worker';

export type EmbeddingProvider = {
  modelName: string;
  isFallback: boolean;
  embed(texts: string[]): Promise<Float32Array[]>;
};

const VECTOR_SIZE = 192;

const l2Normalize = (vector: Float32Array): Float32Array => {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] /= norm;
  }
  return vector;
};

const fnv1a = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
};

export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  const size = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < size; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const createFallbackEmbeddingProvider = (): EmbeddingProvider => ({
  modelName: 'local-hash-embeddings-v1',
  isFallback: true,
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vector = new Float32Array(VECTOR_SIZE);
      const normalized = text.toLowerCase();
      for (let i = 0; i < normalized.length - 2; i += 1) {
        const gram = normalized.slice(i, i + 3);
        const hash = fnv1a(gram);
        vector[hash % VECTOR_SIZE] += 1;
      }
      return l2Normalize(vector);
    });
  },
});

const createModelEmbeddingProvider = async (): Promise<EmbeddingProvider | null> => {
  if (typeof Worker === 'undefined' || typeof chrome === 'undefined') return null;
  const worker = new EmbeddingWorkerFactory();
  try {
    const api = wrap<EmbeddingWorker>(worker);
    const modelName = await api.ready();
    return {
      modelName,
      isFallback: false,
      embed(texts: string[]): Promise<Float32Array[]> {
        return api.embed(texts);
      },
    };
  } catch {
    worker.terminate();
    return null;
  }
};

let providerPromise: Promise<EmbeddingProvider> | null = null;

export const getEmbeddingProvider = async (): Promise<EmbeddingProvider> => {
  if (!providerPromise) {
    providerPromise = (async () => {
      const modelProvider = await createModelEmbeddingProvider();
      return modelProvider ?? createFallbackEmbeddingProvider();
    })();
  }
  return providerPromise;
};
