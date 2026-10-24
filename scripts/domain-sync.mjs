#!/usr/bin/env node
/**
 * Shares the pure domain with Supabase Edge Functions (ARCHITECTURE §3.3).
 *
 *   node scripts/domain-sync.mjs sync   copy src/domain → supabase/functions/_shared/domain
 *   node scripts/domain-sync.mjs check  exit 1 if the copy differs from src/domain
 *
 * The copy is byte-for-byte (no headers, no transforms) and excludes tests and test builders.
 * Never edit the copy by hand: edit src/domain and run `npm run domain:sync`.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src', 'domain');
const TARGET = join(ROOT, 'supabase', 'functions', '_shared', 'domain');

const isShared = (rel) =>
  rel.endsWith('.ts') && !rel.endsWith('.test.ts') && !rel.split('/').includes('testing');

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function checkDomainCopy() {
  const expected = listFiles(SOURCE).filter(isShared);
  const actual = listFiles(TARGET);
  const problems = [];
  for (const rel of expected) {
    if (!actual.includes(rel)) problems.push(`missing in copy: ${rel}`);
    else if (hash(join(SOURCE, rel)) !== hash(join(TARGET, rel))) problems.push(`differs: ${rel}`);
  }
  for (const rel of actual)
    if (!expected.includes(rel)) problems.push(`unexpected in copy: ${rel}`);
  return { files: expected.length, problems };
}

function sync() {
  rmSync(TARGET, { recursive: true, force: true });
  const files = listFiles(SOURCE).filter(isShared);
  for (const rel of files) {
    mkdirSync(dirname(join(TARGET, rel)), { recursive: true });
    cpSync(join(SOURCE, rel), join(TARGET, rel));
  }
  console.log(`domain:sync copied ${files.length} files to ${relative(ROOT, TARGET)}`);
}

const mode = process.argv[2];
if (mode === 'sync') {
  sync();
} else if (mode === 'check') {
  const { files, problems } = checkDomainCopy();
  if (problems.length > 0) {
    console.error(`domain:check FAILED — Edge domain copy drifted from src/domain:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('Run `npm run domain:sync` (never edit the copy by hand).');
    process.exit(1);
  }
  console.log(`domain:check OK (${files} files identical)`);
} else {
  console.error('usage: domain-sync.mjs <sync|check>');
  process.exit(2);
}
