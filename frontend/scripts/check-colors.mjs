#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = join(__dirname, '..');

// Scan directories for raw hex colors or legacy non-semantic Tailwind color classes
const scanDirs = ['components/ui'];
const isStrictAll = process.argv.includes('--all') || process.env.STRICT_COLOR_GUARD === 'true';

const targets = isStrictAll ? ['app', 'components'] : scanDirs;

const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
const HARDCODED_CLASSES_REGEX = /\b(bg-white|text-black|text-white)\b/g;

async function getFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      files.push(...(await getFiles(fullPath)));
    } else if (entry.isFile()) {
      if (/\.(tsx|ts|jsx|js|css)$/.test(entry.name)) {
        // Exclude globals.css and test files from the guard
        if (entry.name === 'globals.css' || entry.name.endsWith('.test.tsx') || entry.name.endsWith('.test.ts')) {
          continue;
        }
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function main() {
  let hasErrors = false;
  let totalViolations = 0;

  for (const target of targets) {
    const targetDir = join(frontendRoot, target);
    let files = [];
    try {
      files = await getFiles(targetDir);
    } catch {
      // directory might not exist yet (e.g. components/ui before 6.2)
      continue;
    }

    for (const file of files) {
      const relPath = relative(frontendRoot, file);
      const content = await readFile(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const hexMatches = line.match(HEX_COLOR_REGEX);
        const classMatches = line.match(HARDCODED_CLASSES_REGEX);

        if (hexMatches || classMatches) {
          hasErrors = true;
          const issues = [...(hexMatches || []), ...(classMatches || [])].join(', ');
          console.error(`[Color Guard] ${relPath}:${index + 1}: Found forbidden raw color(s): ${issues}`);
          totalViolations++;
        }
      });
    }
  }

  if (hasErrors) {
    console.error(`\n❌ Color Guard failed with ${totalViolations} violation(s). Use semantic design tokens instead.`);
    process.exit(1);
  } else {
    console.log('✅ Color Guard passed: 0 raw colors found in guarded directories.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Color Guard error:', err);
  process.exit(1);
});
