import path from 'node:path';

export interface EntryDefinition {
  entry: string;
  outSubDir?: string;
  fileName: string;
  name: string;
  html?: {
    title: string;
    fileName: string;
  };
  cssFileName?: string;
}

export const createEntries = (srcDir: string): EntryDefinition[] => [
  {
    entry: path.join(srcDir, 'background/sw.ts'),
    outSubDir: '',
    fileName: 'sw.js',
    name: 'link-o-saurus-background'
  },
  {
    entry: path.join(srcDir, 'content/inject.ts'),
    outSubDir: 'content',
    fileName: 'inject.js',
    name: 'link-o-saurus-content'
  },
  {
    entry: path.join(srcDir, 'popup/main.tsx'),
    outSubDir: '',
    fileName: 'popup.js',
    name: 'link-o-saurus-popup',
    cssFileName: 'popup.css',
    html: { title: 'Link-o-Saurus', fileName: 'popup.html' },
  },
  {
    entry: path.join(srcDir, 'options/main.tsx'),
    outSubDir: '',
    fileName: 'options.js',
    name: 'link-o-saurus-options',
    cssFileName: 'options.css',
    html: { title: 'Link-o-Saurus Options', fileName: 'options.html' }
  },
  {
    entry: path.join(srcDir, 'dashboard/main.tsx'),
    outSubDir: '',
    fileName: 'dashboard.js',
    name: 'link-o-saurus-dashboard',
    cssFileName: 'dashboard.css',
    html: { title: 'Link-o-Saurus Dashboard', fileName: 'dashboard.html' }
  },
  {
    entry: path.join(srcDir, 'sidepanel/main.tsx'),
    outSubDir: '',
    fileName: 'sidepanel.js',
    name: 'link-o-saurus-sidepanel',
    cssFileName: 'sidepanel.css',
    html: { title: 'Link-o-Saurus Side Panel', fileName: 'sidepanel.html' }
  }
];
