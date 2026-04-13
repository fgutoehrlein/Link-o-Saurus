import type { Bookmark, Category } from '../types';

export type BookmarkSignalInput = {
  title: string;
  url: string;
  metaDescription?: string;
  pageTitle?: string;
  selectedText?: string;
  explicitTags?: string[];
};

export type FolderCandidate = {
  category: Category;
  score: number;
  confidence: number;
  reasons: string[];
};

export type TagSuggestion = {
  tag: string;
  score: number;
  confidence: number;
  reasons: string[];
  source: 'history' | 'domain-rule' | 'keyword-rule' | 'generated';
};

export type AiSuggestionResult = {
  tags: TagSuggestion[];
  bestFolder?: FolderCandidate;
  alternativeFolders: FolderCandidate[];
  diagnostics: {
    model: string;
    processingMs: number;
    fallbackUsed: boolean;
  };
};

export type FolderProfile = {
  category: Category;
  embedding: Float32Array;
  topTags: string[];
  topDomains: string[];
  bookmarkCount: number;
};

export type SimilarBookmark = {
  bookmark: Bookmark;
  similarity: number;
};
