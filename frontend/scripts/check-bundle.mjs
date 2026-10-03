// Fails the build when gzip budgets are exceeded (Quality bar G7).
// "Initial" = what index.html loads up front (entry script + modulepreloads + CSS);
// everything else is a lazy chunk that must stay small on its own.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = { initialJs: 95, css: 15, lazyChunk: 30 };

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024;

const initial = new Set(
  [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
);
const assets = readdirSync(join(dist, 'assets'))
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => `assets/${f}`);

const rows = assets
  .map((f) => ({ file: f, kb: gz(f), initial: initial.has(f), css: f.endsWith('.css') }))
  .sort((a, b) => b.kb - a.kb);

const initialJs = rows.filter((r) => r.initial && !r.css).reduce((s, r) => s + r.kb, 0);
const css = rows.filter((r) => r.css).reduce((s, r) => s + r.kb, 0);
const failures = [];
if (initialJs > BUDGET_KB.initialJs) failures.push(`initial JS ${initialJs.toFixed(1)} KB > ${BUDGET_KB.initialJs} KB`);
if (css > BUDGET_KB.css) failures.push(`CSS ${css.toFixed(1)} KB > ${BUDGET_KB.css} KB`);
for (const r of rows.filter((r) => !r.initial && !r.css)) {
  if (r.kb > BUDGET_KB.lazyChunk) failures.push(`lazy chunk ${r.file} ${r.kb.toFixed(1)} KB > ${BUDGET_KB.lazyChunk} KB`);
}

console.log('gzip   kind     file');
for (const r of rows) console.log(`${r.kb.toFixed(1).padStart(5)}  ${(r.css ? 'css' : r.initial ? 'initial' : 'lazy').padEnd(7)}  ${r.file}`);
console.log(`\ninitial JS ${initialJs.toFixed(1)} / ${BUDGET_KB.initialJs} KB · CSS ${css.toFixed(1)} / ${BUDGET_KB.css} KB`);

if (failures.length) {
  console.error(`\n✗ Bundle budget exceeded:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('✓ within budget');
