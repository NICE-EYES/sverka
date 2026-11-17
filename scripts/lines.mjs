// Usage: node scripts/lines.mjs file.pdf — dump grouped lines and chunks.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { extractPages } from '../src/core/pdf.js';
import { buildLines } from '../src/core/layout.js';
const require = createRequire(import.meta.url);
globalThis.DOMMatrix ??= class {}; globalThis.Path2D ??= class {};
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { pages } = await extractPages(pdfjsLib, new Uint8Array(fs.readFileSync(process.argv[2])));
const lines = buildLines(pages);
const from = +(process.argv[3] || 0), to = +(process.argv[4] || 40);
lines.slice(from, to).forEach((l, i) => console.log(String(i + from).padStart(3), 'p' + l.page, l.y.toFixed(1).padStart(6), l.size.toFixed(1), l.chunks.map(c => `[${c.x0.toFixed(0)}-${c.x1.toFixed(0)} ${c.text}]`).join(' ')));
