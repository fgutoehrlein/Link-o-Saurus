import { expose } from 'comlink';
import type { FeatureExtractionPipelineType } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/paraphrase-MiniLM-L3-v2';

const extensionUrl = (path: string): string =>
  typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : `/${path}`;

type TransformersRuntime = {
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    useBrowserCache: boolean;
    backends: { onnx: { wasm?: { wasmPaths?: string; numThreads?: number } } };
  };
  pipeline: (
    task: 'feature-extraction',
    model: string,
    options: { device: 'wasm'; dtype: 'q8'; local_files_only: true },
  ) => Promise<FeatureExtractionPipelineType>;
};

let runtimePromise: Promise<TransformersRuntime> | null = null;

const getRuntime = (): Promise<TransformersRuntime> => {
  runtimePromise ??= import(/* @vite-ignore */ extensionUrl('assets/transformers/transformers.web.min.js')) as Promise<TransformersRuntime>;
  return runtimePromise;
};

const createFeatureExtractor = (runtime: TransformersRuntime) => runtime.pipeline as (
  task: 'feature-extraction',
  model: string,
  options: { device: 'wasm'; dtype: 'q8'; local_files_only: true },
) => Promise<FeatureExtractionPipelineType>;

let extractorPromise: Promise<FeatureExtractionPipelineType> | null = null;

const getExtractor = () => {
  if (!extractorPromise) {
    extractorPromise = getRuntime().then((runtime) => {
      const { env } = runtime;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = extensionUrl('assets/models/');
      env.useBrowserCache = true;
      const onnx = env.backends.onnx as typeof env.backends.onnx & {
        wasm?: { wasmPaths?: string; numThreads?: number };
      };
      onnx.wasm ??= {};
      onnx.wasm.wasmPaths = extensionUrl('assets/transformers/');
      onnx.wasm.numThreads = 1;
      return createFeatureExtractor(runtime)('feature-extraction', MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        local_files_only: true,
      });
    });
  }
  return extractorPromise;
};

const embed = async (texts: string[]): Promise<Float32Array[]> => {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  const vectorSize = output.data.length / texts.length;
  return texts.map((_, index) => Float32Array.from(output.data.slice(index * vectorSize, (index + 1) * vectorSize)));
};

const api = {
  ready: async (): Promise<string> => {
    await getExtractor();
    return `${MODEL_ID} (q8)`;
  },
  embed,
};

export type EmbeddingWorker = typeof api;

expose(api);
