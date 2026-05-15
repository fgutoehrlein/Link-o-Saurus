import type { ImportProgress } from '../../shared/import-export';

export const formatPercent = (ratio: number | undefined): string => {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) {
    return '0%';
  }
  return `${Math.min(100, Math.max(0, Math.round(ratio * 100)))}%`;
};

export const stageLabel = (progress: ImportProgress): string => {
  if (progress.stage === 'parsing') {
    return 'Parsing bookmarks…';
  }
  return 'Saving to database…';
};

export const computeProgressRatio = (progress: ImportProgress): number | undefined => {
  if (progress.stage === 'parsing') {
    if (progress.totalBytes && progress.totalBytes > 0) {
      return progress.processedBytes / progress.totalBytes;
    }
    if (progress.processedBookmarks > 0) {
      return progress.createdBookmarks / progress.processedBookmarks;
    }
    return 0;
  }

  if (progress.totalBookmarks > 0) {
    return progress.processedBookmarks / progress.totalBookmarks;
  }
  return 0;
};
