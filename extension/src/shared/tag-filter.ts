import { canonicalizeTagId, isAncestorSlug } from './tag-utils';

export type TagFilterState = {
  readonly include: string[];
  readonly exclude: string[];
};

export type TagFilterMode = 'include' | 'exclude';

export const EMPTY_TAG_FILTER_STATE: TagFilterState = {
  include: [],
  exclude: [],
};

const normalizeTagCollection = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const canonical = canonicalizeTagId(value);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    normalized.push(canonical);
  }
  return normalized;
};

export const normalizeTagFilterState = (state: Partial<TagFilterState> | undefined): TagFilterState => ({
  include: normalizeTagCollection(state?.include ?? []),
  exclude: normalizeTagCollection(state?.exclude ?? []),
});

export const getTagFilterMode = (state: TagFilterState, tag: string): TagFilterMode | null => {
  const normalizedState = normalizeTagFilterState(state);
  const canonicalTag = canonicalizeTagId(tag);
  if (!canonicalTag) {
    return null;
  }
  if (normalizedState.include.includes(canonicalTag)) {
    return 'include';
  }
  if (normalizedState.exclude.includes(canonicalTag)) {
    return 'exclude';
  }
  return null;
};

export const toggleTagFilter = (state: TagFilterState, tag: string, mode: TagFilterMode): TagFilterState => {
  const normalizedState = normalizeTagFilterState(state);
  const canonicalTag = canonicalizeTagId(tag);
  if (!canonicalTag) {
    return normalizedState;
  }

  const include = normalizedState.include.filter((value) => value !== canonicalTag);
  const exclude = normalizedState.exclude.filter((value) => value !== canonicalTag);
  const collection = mode === 'include' ? include : exclude;
  const isSameState = getTagFilterMode(normalizedState, canonicalTag) === mode;
  if (!isSameState) {
    collection.push(canonicalTag);
  }

  return {
    include,
    exclude,
  };
};

export const matchesTagFilter = (bookmarkTags: readonly string[], state: TagFilterState): boolean => {
  const normalizedState = normalizeTagFilterState(state);
  if (normalizedState.include.length === 0 && normalizedState.exclude.length === 0) {
    return true;
  }
  const normalizedBookmarkTags = normalizeTagCollection(bookmarkTags);

  const includesAll = normalizedState.include.every((requiredTag) =>
    normalizedBookmarkTags.some((candidate) => isAncestorSlug(requiredTag, candidate)),
  );
  if (!includesAll) {
    return false;
  }

  const excludesAll = normalizedState.exclude.every(
    (blockedTag) => !normalizedBookmarkTags.some((candidate) => isAncestorSlug(blockedTag, candidate)),
  );
  return excludesAll;
};

const splitTagParamValue = (rawValues: readonly string[]): string[] => {
  const values: string[] = [];
  rawValues.forEach((value) => {
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => values.push(part));
  });
  return values;
};

export const parseTagFilterFromParams = (params: URLSearchParams): TagFilterState => {
  const legacyTag = params.get('tag');
  const include = splitTagParamValue(params.getAll('includeTags'));
  if (legacyTag) {
    include.push(legacyTag);
  }
  return normalizeTagFilterState({
    include,
    exclude: splitTagParamValue(params.getAll('excludeTags')),
  });
};

export const writeTagFilterToParams = (params: URLSearchParams, state: TagFilterState): void => {
  const normalizedState = normalizeTagFilterState(state);
  if (normalizedState.include.length > 0) {
    params.set('includeTags', normalizedState.include.join(','));
  }
  if (normalizedState.exclude.length > 0) {
    params.set('excludeTags', normalizedState.exclude.join(','));
  }
};

export const applyNegativeTagContextAction = (
  event: Pick<MouseEvent, 'preventDefault'>,
  apply: () => void,
): void => {
  event.preventDefault();
  apply();
};
