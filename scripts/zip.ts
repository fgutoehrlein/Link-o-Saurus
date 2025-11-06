import AdmZip from 'adm-zip';
import path from 'node:path';
import fs from 'node:fs/promises';

const target = process.argv[2] ?? 'chrome';
const rootDir = process.cwd();
const distDir = path.resolve(rootDir, 'dist', target);
const outFile = path.resolve(rootDir, 'dist', `${target}.zip`);

async function zip() {
  try {
    await fs.access(distDir);
  } catch (error) {
    console.error(`Cannot find build directory for target "${target}" at ${distDir}`);
    process.exitCode = 1;
    return;
  }

  const zip = new AdmZip();
  zip.addLocalFolder(distDir);
  zip.writeZip(outFile);
  console.log(`Created ${outFile}`);
}

zip().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
