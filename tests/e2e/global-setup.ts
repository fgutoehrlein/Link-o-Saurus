import { FullConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function globalSetup(_config: FullConfig): Promise<void> {
  execSync('pnpm build:chrome', { cwd: rootDir, stdio: 'inherit' });
}

export default globalSetup;
