export const createTokenSet = (source: string): Set<string> =>
  new Set(
    source
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
