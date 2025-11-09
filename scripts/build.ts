import { build, InlineConfig } from 'vite';
import preact from '@preact/preset-vite';
import chokidar from 'chokidar';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { RollupOutput, RollupWatcher, RollupWatcherEvent } from 'rollup';

const modeArg = process.argv[2] ?? 'build';
const target = process.argv[3] ?? 'chrome';
const watchRequested = process.argv.includes('--watch') || modeArg === 'dev';

if (!['chrome', 'firefox'].includes(target)) {
  console.error(`Unsupported target "${target}". Expected "chrome" or "firefox".`);
  process.exitCode = 1;
  throw new Error('Aborting build due to invalid target.');
}

const rootDir = process.cwd();
const extensionDir = path.resolve(rootDir, 'extension');
const srcDir = path.resolve(extensionDir, 'src');
const distDir = path.resolve(rootDir, 'dist', target);

interface EntryDefinition {
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

const entries: EntryDefinition[] = [
  {
    entry: path.join(srcDir, 'background/sw.ts'),
    outSubDir: '',
    fileName: 'sw.js',
    name: 'feathermarks-background'
  },
  {
    entry: path.join(srcDir, 'content/inject.ts'),
    outSubDir: 'content',
    fileName: 'inject.js',
    name: 'feathermarks-content'
  },
  {
    entry: path.join(srcDir, 'popup/main.tsx'),
    outSubDir: '',
    fileName: 'popup.js',
    name: 'feathermarks-popup',
    cssFileName: 'popup.css',
    html: { title: 'Feathermarks', fileName: 'popup.html' },
  },
  {
    entry: path.join(srcDir, 'options/main.tsx'),
    outSubDir: '',
    fileName: 'options.js',
    name: 'feathermarks-options',
    cssFileName: 'options.css',
    html: { title: 'Feathermarks Options', fileName: 'options.html' }
  },
  {
    entry: path.join(srcDir, 'dashboard/main.tsx'),
    outSubDir: '',
    fileName: 'dashboard.js',
    name: 'feathermarks-dashboard',
    cssFileName: 'dashboard.css',
    html: { title: 'Feathermarks Dashboard', fileName: 'dashboard.html' }
  }
];

async function ensureCleanOutput() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyManifest() {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);

  if (target === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: 'feathermarks@example.com',
        strict_min_version: '109.0'
      }
    };
  }

  const outPath = path.join(distDir, 'manifest.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function writeHtmlShell(entry: EntryDefinition, cssFiles: readonly string[] = []) {
  if (!entry.html) return;

  const outDir = path.join(distDir, entry.outSubDir ?? '');
  await fs.mkdir(outDir, { recursive: true });
  const cssLinks = cssFiles.map((file) => `<link rel="stylesheet" href="./${file}" />`);
  const headLines = [
    '<meta charset="utf-8" />',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>${entry.html.title}</title>`,
    ...cssLinks,
  ];
  const html = `<!doctype html>
<html lang="en">
  <head>
${headLines.map((line) => `    ${line}`).join('\n')}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./${entry.fileName}"></script>
  </body>
</html>
`;
  await fs.writeFile(path.join(outDir, entry.html.fileName), html, 'utf-8');
}

async function collectCssFilesFromDisk(entry: EntryDefinition): Promise<string[]> {
  if (!entry.html) return [];

  const outDir = path.join(distDir, entry.outSubDir ?? '');
  const expectedCss = entry.cssFileName ? new Set([entry.cssFileName]) : undefined;

  const gather = async (dir: string, baseDir: string): Promise<string[]> => {
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const collected: string[] = [];

    for (const dirent of dirents) {
      const absolute = path.join(dir, dirent.name);
      const relative = path.relative(baseDir, absolute).split(path.sep).join('/');

      if (dirent.isDirectory()) {
        collected.push(...(await gather(absolute, baseDir)));
      } else if (dirent.isFile() && dirent.name.endsWith('.css')) {
        if (!expectedCss || expectedCss.has(dirent.name)) {
          collected.push(relative);
        }
      }
    }

    return collected;
  };

  const cssFiles = await gather(outDir, outDir);
  cssFiles.sort();
  return cssFiles;
}

function extractCssFiles(result: RollupOutput | RollupOutput[]): string[] {
  const outputs = Array.isArray(result) ? result : [result];
  const files = new Set<string>();

  for (const output of outputs) {
    for (const item of output.output) {
      if (item.type === 'asset' && typeof item.fileName === 'string' && item.fileName.endsWith('.css')) {
        files.add(item.fileName);
      }
    }
  }

  return [...files].sort();
}

function isRollupEndEvent(event: RollupWatcherEvent): boolean {
  return event.code === 'END';
}

function createViteConfig(entry: EntryDefinition): InlineConfig {
  const outDir = path.join(distDir, entry.outSubDir ?? '');
  const cssFileName = entry.cssFileName ?? 'style.css';

  return {
    configFile: false,
    publicDir: false,
    plugins: [preact()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(modeArg === 'build' ? 'production' : 'development'),
    },
    resolve: {
      alias: {
        '~shared': path.join(srcDir, 'shared')
      }
    },
    build: {
      emptyOutDir: false,
      outDir,
      minify: modeArg === 'build',
      sourcemap: true,
      lib: {
        entry: entry.entry,
        formats: ['es'],
        name: entry.name,
        fileName: () => entry.fileName
      },
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            if (assetInfo.type === 'asset' && assetInfo.name?.endsWith('.css')) {
              return cssFileName;
            }
            return assetInfo.name ?? 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          format: 'es',
        }
      }
    }
  } satisfies InlineConfig;
}

async function run() {
  await ensureCleanOutput();
  await copyManifest();
  await Promise.all(entries.map((entry) => writeHtmlShell(entry)));

  const activeWatchers: { watcher: RollupWatcher; entry: EntryDefinition }[] = [];

  for (const entry of entries) {
    const config = createViteConfig(entry);
    if (watchRequested) {
      config.build = { ...config.build, watch: {} };
    }

    const result = await build(config);

    if (isWatcher(result)) {
      activeWatchers.push({ watcher: result, entry });
    } else {
      const cssFiles = extractCssFiles(result as RollupOutput | RollupOutput[]);
      await writeHtmlShell(entry, cssFiles);
    }
  }

  if (watchRequested) {
    for (const { watcher, entry } of activeWatchers) {
      watcher.on('event', (event) => {
        if (isRollupEndEvent(event as RollupWatcherEvent)) {
          collectCssFilesFromDisk(entry)
            .then((cssFiles) => writeHtmlShell(entry, cssFiles))
            .catch((error) => {
              console.error(`Failed to update HTML shell for ${entry.name}:`, error);
            });
        }
      });
    }

    const manifestWatcher = chokidar.watch(path.join(extensionDir, 'manifest.json'), {
      ignoreInitial: true
    });

    manifestWatcher.on('change', () => {
      copyManifest().catch((error) => {
        console.error('Failed to copy manifest:', error);
      });
    });

    console.log(`Watching sources for ${target}…`);
    await new Promise(() => undefined);
  }

  for (const entry of entries) {
    if (!entry.html) continue;

    const cssFiles = await collectCssFilesFromDisk(entry);
    if (cssFiles.length > 0) {
      await writeHtmlShell(entry, cssFiles);
    }
  }

  return activeWatchers.map(({ watcher }) => watcher);
}

function isWatcher(result: unknown): result is RollupWatcher {
  return typeof result === 'object' && result !== null && 'on' in result;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
