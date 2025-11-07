import type { Tag } from './types';

export type TagMetadata = {
  readonly canonicalId: string;
  readonly path: string;
  readonly slugParts: string[];
  readonly leafName: string;
};

const cleanSegment = (segment: string): string => segment.replace(/\s+/g, ' ').trim();

export const normalizeTagPath = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed
    .split('/')
    .map((part) => cleanSegment(part))
    .filter((part) => part.length > 0);
  return parts.join('/');
};

const toSlugPart = (segment: string): string => cleanSegment(segment).toLowerCase();

export const deriveTagMetadata = (input: string): TagMetadata => {
  const normalizedPath = normalizeTagPath(input);
  if (!normalizedPath) {
    throw new Error('Tag path must not be empty');
  }
  const displayParts = normalizedPath.split('/');
  const slugParts = displayParts.map((part) => toSlugPart(part));
  const canonicalId = slugParts.join('/');
  const leafName = displayParts[displayParts.length - 1] ?? normalizedPath;
  return {
    canonicalId,
    path: normalizedPath,
    slugParts,
    leafName,
  };
};

export const canonicalizeTagId = (input: string): string => {
  try {
    return deriveTagMetadata(input).canonicalId;
  } catch {
    return '';
  }
};

export const normalizeTagList = (tags?: string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const metadata = (() => {
      try {
        return deriveTagMetadata(raw);
      } catch {
        return null;
      }
    })();
    if (!metadata || seen.has(metadata.canonicalId)) {
      continue;
    }
    seen.add(metadata.canonicalId);
    normalized.push(metadata.path);
  }
  return normalized;
};

export const isAncestorSlug = (ancestor: string, descendant: string): boolean => {
  if (!ancestor) {
    return true;
  }
  if (ancestor === descendant) {
    return true;
  }
  return descendant.startsWith(`${ancestor}/`);
};

export const createTagFromMetadata = (
  metadata: TagMetadata,
  overrides: Partial<Tag> = {},
): Tag => ({
  id: metadata.canonicalId,
  name: metadata.leafName,
  path: metadata.path,
  slugParts: metadata.slugParts,
  usageCount: 0,
  ...overrides,
});
