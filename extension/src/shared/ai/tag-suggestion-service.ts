import type { Bookmark, Tag } from '../types';
import { cosineSimilarity } from './embedding-service';
import { detectDomainRule, deriveKeywordTags } from './domain-rules';
import { dedupeTags, normalizeTag, parseDomain, tokenize } from './normalization';
import { embedText } from './model-service';
import type { BookmarkSignalInput, SimilarBookmark, TagSuggestion } from './types';

type Inputs = {
  input: BookmarkSignalInput;
  existingTags: Tag[];
  bookmarks: Bookmark[];
};

const MIN_TAG_SCORE = 0.28;
const MAX_ANCHORED_TAGS = 3;
const MAX_EXPLORATORY_TAGS = 3;

const buildBookmarkText = (bookmark: Pick<Bookmark, 'title' | 'url' | 'tags' | 'notes'>): string =>
  [bookmark.title, bookmark.url, bookmark.notes ?? '', bookmark.tags.join(' ')].join(' | ');

const rankSimilarBookmarks = async (
  input: BookmarkSignalInput,
  bookmarks: Bookmark[],
): Promise<SimilarBookmark[]> => {
  const bookmarkText = [input.title, input.url, input.metaDescription ?? '', input.selectedText ?? ''].join(' | ');
  const targetEmbedding = await embedText(bookmarkText);

  const ranked: SimilarBookmark[] = [];
  for (const bookmark of bookmarks) {
    const similarity = cosineSimilarity(targetEmbedding, await embedText(buildBookmarkText(bookmark)));
    if (similarity >= 0.2) {
      ranked.push({ bookmark, similarity });
    }
  }
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, 24);
};

export const suggestTags = async ({ input, existingTags, bookmarks }: Inputs): Promise<TagSuggestion[]> => {
  const contentText = [input.title, input.metaDescription ?? '', input.pageTitle ?? '', input.selectedText ?? ''].join(' ');
  const tokens = tokenize(contentText);
  const domainRule = detectDomainRule(input.url);
  const keywordTags = deriveKeywordTags(tokens);
  const similarBookmarks = await rankSimilarBookmarks(input, bookmarks);

  const bookmarkText = [input.title, input.url, input.metaDescription ?? '', input.selectedText ?? ''].join(' | ');
  const sourceEmbedding = await embedText(bookmarkText);

  const candidateScores = new Map<string, TagSuggestion>();
  const collect = (tag: string, source: TagSuggestion['source'], score: number, reason: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized) {
      return;
    }
    const existing = candidateScores.get(normalized);
    if (existing) {
      existing.score += score;
      existing.reasons.push(reason);
      return;
    }
    candidateScores.set(normalized, {
      tag: normalized,
      score,
      confidence: 0,
      reasons: [reason],
      source,
    });
  };

  for (const tag of keywordTags) {
    collect(tag, 'keyword-rule', 0.38, 'keyword match');
  }

  if (domainRule) {
    for (const tag of [...domainRule.tags, ...(domainRule.formatTags ?? [])]) {
      collect(tag, 'domain-rule', 0.54, `domain rule (${parseDomain(input.url)})`);
    }
  }

  for (const existing of existingTags) {
    const similarity = cosineSimilarity(sourceEmbedding, await embedText(existing.name));
    if (similarity >= 0.24) {
      collect(existing.name, 'history', similarity * 0.8 + Math.min(existing.usageCount, 16) / 64, 'similar existing tag');
    }
  }

  for (const similar of similarBookmarks) {
    for (const tag of similar.bookmark.tags) {
      collect(tag, 'history', similar.similarity * 0.95, 'similar bookmark tag');
    }
    const domain = parseDomain(similar.bookmark.url);
    if (domain && domain === parseDomain(input.url)) {
      for (const tag of similar.bookmark.tags) {
        collect(tag, 'history', 0.18, 'same-domain bookmark');
      }
    }
  }

  for (const explicit of input.explicitTags ?? []) {
    collect(explicit, 'generated', 0.62, 'manually supplied by user');
  }

  const ranked = Array.from(candidateScores.values())
    .filter((candidate) => candidate.score >= MIN_TAG_SCORE)
    .map((candidate) => ({
      ...candidate,
      confidence: Math.max(0, Math.min(1, candidate.score / 1.8)),
      reasons: Array.from(new Set(candidate.reasons)).slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score);

  const anchored = ranked
    .filter((entry) => entry.source === 'history')
    .slice(0, MAX_ANCHORED_TAGS);

  const contentDerived: TagSuggestion[] = dedupeTags(tokens)
    .filter((token) => token.length >= 4)
    .slice(0, 20)
    .map((token) => ({
      tag: token,
      score: 0.36,
      confidence: 0.4,
      reasons: ['content token'],
      source: 'generated' as const,
    }));

  const exploratoryPool = [...ranked.filter((entry) => entry.source !== 'history'), ...contentDerived];
  const exploratory = exploratoryPool
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.tag === entry.tag) === index)
    .slice(0, MAX_EXPLORATORY_TAGS);

  const merged = [...anchored, ...exploratory];
  const mergedKeys = new Set(merged.map((entry) => entry.tag));
  const backfill = ranked
    .filter((entry) => !mergedKeys.has(entry.tag) && entry.source !== 'history')
    .slice(0, 2);
  return [...merged, ...backfill].slice(0, 8);
};
