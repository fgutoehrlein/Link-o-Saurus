import { embeddingCache } from './cache-service';
import { getEmbeddingProvider } from './embedding-service';

const buildKey = (text: string): string => text.toLowerCase().trim();

export const embedText = async (text: string): Promise<Float32Array> => {
  const [embedding] = await embedTexts([text]);
  return embedding;
};

export const embedTexts = async (texts: string[]): Promise<Float32Array[]> => {
  if (texts.length === 0) return [];
  const keys = texts.map(buildKey);
  const result = new Array<Float32Array>(keys.length);
  const missing = new Map<string, number[]>();

  keys.forEach((key, index) => {
    const cached = embeddingCache.get(key);
    if (cached) {
      result[index] = cached;
      return;
    }
    const indices = missing.get(key) ?? [];
    indices.push(index);
    missing.set(key, indices);
  });

  if (missing.size === 0) return result;
  const provider = await getEmbeddingProvider();
  const embedded = await provider.embed(Array.from(missing.keys()));
  Array.from(missing.entries()).forEach(([key, indices], index) => {
    const vector = embedded[index];
    embeddingCache.set(key, vector);
    indices.forEach((position) => {
      result[position] = vector;
    });
  });
  return result;
};

export const getModelDiagnostics = async (): Promise<{ modelName: string; fallbackUsed: boolean }> => {
  const provider = await getEmbeddingProvider();
  return { modelName: provider.modelName, fallbackUsed: provider.isFallback };
};
