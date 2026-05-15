import type { BookmarkSortMode } from '../../shared/types';
import { normalizeUrl } from '../../shared/url';
import {
  normalizeTagFilterState,
  parseTagFilterFromParams,
  writeTagFilterToParams,
} from '../../shared/tag-filter';

export type RouteSnapshot = {
  readonly search: string;
  readonly boardId: string;
  readonly sortMode?: BookmarkSortMode;
  readonly includeTags: string[];
  readonly excludeTags: string[];
  readonly isNew: boolean;
  readonly newTitle: string;
  readonly newUrl: string;
  readonly newTags: string;
};

const ROUTE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
export const ROUTE_MAX_SEARCH_LENGTH = 512;
export const ROUTE_MAX_TITLE_LENGTH = 256;
const ROUTE_MAX_TAG_LENGTH = 64;
const ROUTE_MAX_TAG_COUNT = 32;

export const sanitizeRouteText = (value: string, limit: number): string =>
  value.replace(ROUTE_CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);

export const sanitizeRouteTagsList = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const sanitized = sanitizeRouteText(value, ROUTE_MAX_TAG_LENGTH);
    if (!sanitized) {
      continue;
    }
    const key = sanitized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(sanitized);
    if (result.length >= ROUTE_MAX_TAG_COUNT) {
      break;
    }
  }
  return result;
};

const sanitizeRouteTagsParam = (values: readonly string[]): string[] => {
  const flattened: string[] = [];
  values.forEach((value) => {
    value
      .split(',')
      .map((part) => part)
      .forEach((part) => flattened.push(part));
  });
  return sanitizeRouteTagsList(flattened);
};

export const sanitizeRouteUrl = (value: string): string => {
  const trimmed = value.replace(ROUTE_CONTROL_CHARACTERS, '').trim();
  if (!trimmed) {
    return '';
  }
  const normalized =
    normalizeUrl(trimmed, { removeHash: false, sortQueryParameters: false }) ??
    normalizeUrl(`https://${trimmed}`, { removeHash: false, sortQueryParameters: false });
  return normalized ?? '';
};

export const parseInitialRoute = (): RouteSnapshot => {
  const params = new URLSearchParams(window.location.search);

  const hash = window.location.hash;
  if (hash.includes('?')) {
    const hashParams = new URLSearchParams(hash.replace(/^#\/?/, ''));
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
  }

  const search = sanitizeRouteText(params.get('q') ?? '', ROUTE_MAX_SEARCH_LENGTH);
  const boardId = params.get('board')?.replace(ROUTE_CONTROL_CHARACTERS, '').trim() ?? '';
  const sortParam = (params.get('sort') ?? '').toLowerCase();
  const sortMode: BookmarkSortMode | undefined =
    sortParam === 'relevance' || sortParam === 'alphabetical' || sortParam === 'newest'
      ? sortParam
      : undefined;
  const parsedTagFilters = parseTagFilterFromParams(params);
  const includeTags = sanitizeRouteTagsParam(parsedTagFilters.include);
  const excludeTags = sanitizeRouteTagsParam(parsedTagFilters.exclude);
  const isNew = params.get('new') === '1';
  const newTitle = sanitizeRouteText(params.get('title') ?? '', ROUTE_MAX_TITLE_LENGTH);
  const newUrl = sanitizeRouteUrl(params.get('url') ?? '');
  const tags = sanitizeRouteTagsParam(params.getAll('tags'));
  const newTags = tags.join(', ');

  const normalizedFilters = normalizeTagFilterState({
    include: includeTags,
    exclude: excludeTags,
  });

  return {
    search,
    boardId,
    sortMode,
    includeTags: normalizedFilters.include,
    excludeTags: normalizedFilters.exclude,
    isNew,
    newTitle,
    newUrl,
    newTags,
  };
};

export const updateRouteHash = (snapshot: RouteSnapshot): void => {
  const params = new URLSearchParams();
  if (snapshot.search) {
    params.set('q', snapshot.search);
  }
  if (snapshot.boardId) {
    params.set('board', snapshot.boardId);
  }
  if (snapshot.sortMode) {
    params.set('sort', snapshot.sortMode);
  }
  writeTagFilterToParams(params, {
    include: snapshot.includeTags,
    exclude: snapshot.excludeTags,
  });
  if (snapshot.isNew) {
    params.set('new', '1');
    if (snapshot.newTitle) {
      params.set('title', snapshot.newTitle);
    }
    if (snapshot.newUrl) {
      params.set('url', snapshot.newUrl);
    }
    if (snapshot.newTags) {
      const serializedTags = sanitizeRouteTagsList(
        snapshot.newTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
      if (serializedTags.length > 0) {
        params.set('tags', serializedTags.join(','));
      }
    }
  }
  const serialized = params.toString();
  const nextHash = serialized ? `#/?${serialized}` : '#/';
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
};
