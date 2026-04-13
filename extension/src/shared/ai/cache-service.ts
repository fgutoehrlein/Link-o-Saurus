const MAX_EMBEDDING_CACHE = 1200;

export class EmbeddingCache {
  private readonly entries = new Map<string, Float32Array>();

  get(key: string): Float32Array | undefined {
    const found = this.entries.get(key);
    if (!found) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, found);
    return found;
  }

  set(key: string, value: Float32Array): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    while (this.entries.size > MAX_EMBEDDING_CACHE) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const embeddingCache = new EmbeddingCache();
