#!/usr/bin/env node
/**
 * Verifies that every `'use server'` module exports only async functions.
 *
 * This exists because **`tsc --noEmit` cannot catch this class of bug.** The
 * rule is a Next.js constraint, not a TypeScript one: each export of a server
 * module becomes a callable RPC endpoint, and an object cannot be one. The
 * code type-checks perfectly and then fails at `next build` — or worse, at
 * runtime in dev, which is how it was found.
 *
 * A static check is therefore the only way to catch it without a full build,
 * which matters because a build takes minutes and this takes milliseconds.
 *
 *   node scripts/check-server-actions.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ILLEGAL = [
  [/^export const (\w+)/gm, (m) => `export const ${m[1]}`],
  [/^export class (\w+)/gm, (m) => `export class ${m[1]}`],
  [/^export function (\w+)/gm, (m) => `export function ${m[1]} (not async)`],
  [/^export \{([^}]*)\}/gm, (m) => `export { ${m[1].trim()} }`],
  [/^export default/gm, () => 'export default'],
];

let failures = 0;
let checked = 0;

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  if (!source.trimStart().startsWith("'use server'")) continue;
  checked++;

  const found = [];
  for (const [pattern, describe] of ILLEGAL) {
    for (const match of source.matchAll(pattern)) {
      // `export type` / `export interface` are erased at compile time and are
      // legal; the patterns above deliberately do not match them.
      found.push({ text: describe(match), line: source.slice(0, match.index).split('\n').length });
    }
  }

  if (found.length > 0) {
    failures++;
    console.error(`\n  ${relative(ROOT, file)}`);
    for (const item of found) {
      console.error(`    line ${item.line}: ${item.text}`);
    }
  }
}

if (failures > 0) {
  console.error(
    `\n  A 'use server' file can only export async functions.` +
      `\n  Move constants and types into a plain module and import them directly.\n`,
  );
  process.exit(1);
}

console.log(`✓ ${checked} 'use server' modules export only async functions`);
