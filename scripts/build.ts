import { build, InlineConfig } from 'vite';
import preact from '@preact/preset-vite';
import chokidar from 'chokidar';
import path from 'node:path';
import fs from 'node:fs/promises';

type RollupWatcher = {
  close(): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): void;
};

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
  outSubDir: string;
  fileName: string;
  name: string;
  html?: {
    title: string;
  };
  cssFileName?: string;
}

const entries: EntryDefinition[] = [
  {
    entry: path.join(srcDir, 'background/sw.ts'),
    outSubDir: 'background',
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
    outSubDir: 'popup',
    fileName: 'main.js',
    name: 'feathermarks-popup',
    html: { title: 'Feathermarks' },
    cssFileName: 'style.css'
  },
  {
    entry: path.join(srcDir, 'options/main.tsx'),
    outSubDir: 'options',
    fileName: 'main.js',
    name: 'feathermarks-options',
    html: { title: 'Feathermarks Options' }
  },
  {
    entry: path.join(srcDir, 'newtab/main.tsx'),
    outSubDir: 'newtab',
    fileName: 'main.js',
    name: 'feathermarks-newtab',
    html: { title: 'Feathermarks New Tab (Preview)' }
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

async function writeHtmlShell(entry: EntryDefinition) {
  if (!entry.html) return;

  const outDir = path.join(distDir, entry.outSubDir);
  await fs.mkdir(outDir, { recursive: true });
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${entry.html.title}</title>
    ${entry.cssFileName ? `<link rel="stylesheet" href="./${entry.cssFileName}" />` : ''}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./${entry.fileName}"></script>
  </body>
</html>
`;
  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf-8');
}

function createViteConfig(entry: EntryDefinition): InlineConfig {
  const outDir = path.join(distDir, entry.outSubDir);

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
      }
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

  const watchers: RollupWatcher[] = [];

  for (const entry of entries) {
    const config = createViteConfig(entry);
    if (watchRequested) {
      config.build = { ...config.build, watch: {} };
    }

    const result = await build(config);

    if (isWatcher(result)) {
      watchers.push(result);
    }
  }

  if (watchRequested) {
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

  return watchers;
}

function isWatcher(result: unknown): result is RollupWatcher {
  return typeof result === 'object' && result !== null && 'on' in result;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
