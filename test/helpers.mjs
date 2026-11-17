import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractPages } from '../src/core/pdf.js';
import { parseStatement } from '../src/core/parse.js';

const require = createRequire(import.meta.url);
globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.Path2D ??= class Path2D {};
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

export const FIXTURES = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

export async function parseFile(file, opts) {
  const data = new Uint8Array(fs.readFileSync(file));
  const { pages } = await extractPages(pdfjsLib, data, opts);
  return parseStatement(pages, opts);
}

export function cashflow(st, t) {
  return st.accountType === 'liability' ? -t.effect : t.effect;
}

export function norm(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
