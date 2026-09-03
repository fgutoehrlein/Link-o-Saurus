import type { Bookmark, Tag } from '../types';
import { cosineSimilarity } from './embedding-service';
import { detectDomainRule, deriveKeywordTags } from './domain-rules';
import { dedupeTags, normalizeTag, parseDomain, tokenize } from './normalization';
import { embedTexts } from './model-service';
import type { BookmarkSignalInput, SimilarBookmark, TagSuggestion } from './types';

type Inputs = {
  input: BookmarkSignalInput;
  existingTags: Tag[];
  bookmarks: Bookmark[];
};

const MIN_TAG_SCORE = 0.28;
const MAX_ANCHORED_TAGS = 3;
const MAX_EXPLORATORY_TAGS = 3;
const MAX_PAGE_CHUNKS = 6;
const PAGE_CHUNK_LENGTH = 700;
const MAX_SIMILAR_BOOKMARKS = 120;
const MAX_EXISTING_TAGS = 160;
const PAGE_STOPWORDS = new Set(['about', 'also', 'and', 'are', 'for', 'from', 'have', 'into', 'mit', 'more', 'not', 'that', 'the', 'this', 'und', 'was', 'with', 'you']);

const buildInputText = (input: BookmarkSignalInput): string =>
  [input.title, input.url, input.metaDescription ?? '', input.pageTitle ?? '', input.selectedText ?? ''].join(' | ');

export const selectPageChunks = (content: string): string[] => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= PAGE_CHUNK_LENGTH) return [normalized];
  const lastStart = Math.max(0, normalized.length - PAGE_CHUNK_LENGTH);
  return Array.from({ length: MAX_PAGE_CHUNKS }, (_, index) => {
    const start = Math.round((lastStart * index) / (MAX_PAGE_CHUNKS - 1));
    return normalized.slice(start, start + PAGE_CHUNK_LENGTH);
  });
};

const averageEmbedding = (vectors: Float32Array[]): Float32Array => {
  if (vectors.length === 1) return vectors[0];
  const average = new Float32Array(vectors[0]?.length ?? 0);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      average[index] += value / vectors.length;
    });
  }
  return average;
};

const embedInput = async (input: BookmarkSignalInput): Promise<Float32Array> =>
  averageEmbedding(await embedTexts([buildInputText(input), ...selectPageChunks(input.pageContent ?? '')]));

const rankContentTokens = (input: BookmarkSignalInput): string[] => {
  const scores = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const token of tokenize(text)) {
      if (token.length < 4 || PAGE_STOPWORDS.has(token)) continue;
      scores.set(token, (scores.get(token) ?? 0) + weight);
    }
  };
  add(input.title, 4);
  add(input.metaDescription ?? '', 2);
  add(input.pageTitle ?? '', 2);
  add(input.pageContent ?? '', 1);
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([token]) => token).slice(0, 20);
};

const buildBookmarkText = (bookmark: Pick<Bookmark, 'title' | 'url' | 'tags' | 'notes'>): string =>
  [bookmark.title, bookmark.url, bookmark.notes ?? '', bookmark.tags.join(' ')].join(' | ');

const rankSimilarBookmarks = async (
  input: BookmarkSignalInput,
  bookmarks: Bookmark[],
): Promise<SimilarBookmark[]> => {
  const targetEmbedding = await embedInput(input);
  const inputDomain = parseDomain(input.url);
  const candidates = [...bookmarks]
    .sort((a, b) => Number(parseDomain(b.url) === inputDomain) - Number(parseDomain(a.url) === inputDomain) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_SIMILAR_BOOKMARKS);
  const candidateEmbeddings = await embedTexts(candidates.map(buildBookmarkText));

  const ranked: SimilarBookmark[] = [];
  for (const [index, bookmark] of candidates.entries()) {
    const similarity = cosineSimilarity(targetEmbedding, candidateEmbeddings[index]);
    if (similarity >= 0.2) {
      ranked.push({ bookmark, similarity });
    }
  }
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, 24);
};

export const suggestTags = async ({ input, existingTags, bookmarks }: Inputs): Promise<TagSuggestion[]> => {
  const contentText = [input.title, input.metaDescription ?? '', input.pageTitle ?? '', input.pageContent ?? '', input.selectedText ?? ''].join(' ');
  const tokens = tokenize(contentText);
  const domainRule = detectDomainRule(input.url);
  const keywordTags = deriveKeywordTags(tokens);
  const similarBookmarks = await rankSimilarBookmarks(input, bookmarks);

  const sourceEmbedding = await embedInput(input);

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

  const popularTags = [...existingTags].sort((a, b) => b.usageCount - a.usageCount).slice(0, MAX_EXISTING_TAGS);
  const tagEmbeddings = await embedTexts(popularTags.map((tag) => tag.name));
  for (const [index, existing] of popularTags.entries()) {
    const similarity = cosineSimilarity(sourceEmbedding, tagEmbeddings[index]);
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

  const contentDerived: TagSuggestion[] = dedupeTags(rankContentTokens(input))
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
