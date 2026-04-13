import { embeddingCache } from './cache-service';
import { getEmbeddingProvider } from './embedding-service';

const buildKey = (text: string): string => text.toLowerCase().trim();

export const embedText = async (text: string): Promise<Float32Array> => {
  const key = buildKey(text);
  const cached = embeddingCache.get(key);
  if (cached) {
    return cached;
  }
  const provider = await getEmbeddingProvider();
  const embedded = await provider.embed(key);
  embeddingCache.set(key, embedded);
  return embedded;
};

export const getModelDiagnostics = async (): Promise<{ modelName: string; fallbackUsed: boolean }> => {
  const provider = await getEmbeddingProvider();
  return { modelName: provider.modelName, fallbackUsed: provider.isFallback };
};
