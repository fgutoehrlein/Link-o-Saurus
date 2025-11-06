import { expose, proxy } from 'comlink';
import {
  exportData,
  type ExportFormat,
  type ExportOptions,
  importFromJson,
  importFromNetscapeHtml,
  type ImportCallbacks,
  type ImportOptions,
  type ImportResult,
  type ImportProgress,
  type ExportResult,
} from './import-export';

export type ImportProgressHandler = (progress: ImportProgress) => void;

export type ImportRequestCallbacks = {
  onProgress?: ImportProgressHandler;
};

const toCallbacks = (callbacks?: ImportRequestCallbacks): ImportCallbacks | undefined => {
  if (!callbacks?.onProgress) {
    return callbacks;
  }

  return {
    onProgress: proxy(callbacks.onProgress),
  };
};

const workerApi = {
  async importHtml(file: File, options?: ImportOptions, callbacks?: ImportRequestCallbacks): Promise<ImportResult> {
    return importFromNetscapeHtml(file, options, toCallbacks(callbacks));
  },
  async importJson(file: File, options?: ImportOptions, callbacks?: ImportRequestCallbacks): Promise<ImportResult> {
    return importFromJson(file, options, toCallbacks(callbacks));
  },
  async export(format: ExportFormat, options?: ExportOptions): Promise<ExportResult> {
    return exportData(format, options);
  },
};

export type ImportExportWorkerApi = typeof workerApi;

expose(workerApi);
