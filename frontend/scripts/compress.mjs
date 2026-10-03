// Post-build: write max-level .gz next to each text asset for nginx gzip_static.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let n = 0;
for (const f of walk('dist')) {
  if (!/\.(js|css|html|svg|json)$/.test(f) || statSync(f).size < 1024) continue;
  writeFileSync(`${f}.gz`, gzipSync(readFileSync(f), { level: 9 }));
  n++;
}
console.log(`gzip: ${n} files pre-compressed`);
