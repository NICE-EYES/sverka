// Turn positioned text items (from pdf.js) into lines of cells ("chunks").
//
// Input page: { width, height, items: [{ str, x, y, w, h }] }  — y is the
// distance from the TOP of the page to the text baseline, in PDF points.

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Split an item on runs of 2+ spaces (monospace layouts print a whole row as one string). */
function splitItem(it) {
  const str = it.str.replace(/\t/g, '    ');
  if (!/\S\s{2,}\S/.test(str)) {
    const lead = str.length - str.trimStart().length;
    const t = str.trim();
    if (!t) return [];
    const cw = str.length ? it.w / str.length : 0;
    return [{ text: t, x0: it.x + lead * cw, x1: it.x + (lead + t.length) * cw, y: it.y, size: it.h }];
  }
  const cw = str.length ? it.w / str.length : 0;
  const out = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(str))) {
    out.push({ text: m[0], x0: it.x + m.index * cw, x1: it.x + (m.index + m[0].length) * cw, y: it.y, size: it.h });
  }
  return out;
}

export function buildLines(pages) {
  const lines = [];
  pages.forEach((page, pageIndex) => {
    const toks = [];
    for (const it of page.items) {
      if (!it.str || !it.str.trim()) continue;
      for (const t of splitItem(it)) toks.push(t);
    }
    if (!toks.length) return;
    const sizes = toks.map((t) => t.size).filter((s) => s > 0);
    const pageSize = median(sizes) || 9;
    toks.sort((a, b) => a.y - b.y || a.x0 - b.x0);

    // Group into lines by baseline.
    const groups = [];
    for (const t of toks) {
      const size = t.size || pageSize;
      const g = groups[groups.length - 1];
      if (g && Math.abs(t.y - g.y) <= Math.max(1.5, 0.4 * Math.min(size, g.size))) {
        g.toks.push(t);
        // keep the baseline of the dominant text
        g.size = Math.max(g.size, size);
      } else {
        groups.push({ y: t.y, size, toks: [t] });
      }
    }

    for (const g of groups) {
      g.toks.sort((a, b) => a.x0 - b.x0);
      const chunks = [];
      for (const t of g.toks) {
        const c = chunks[chunks.length - 1];
        const size = t.size || pageSize;
        const gap = c ? t.x0 - c.x1 : Infinity;
        if (c && gap < 0.6 * size) {
          c.text += gap > 0.12 * size ? ' ' + t.text : t.text;
          c.x1 = Math.max(c.x1, t.x1);
        } else {
          chunks.push({ text: t.text, x0: t.x0, x1: t.x1 });
        }
      }
      lines.push({
        page: pageIndex,
        y: g.y,
        size: g.size,
        chunks,
        text: chunks.map((c) => c.text).join(' '),
      });
    }
  });
  return lines;
}

/**
 * Cluster numbers on a 1-D axis. Values within `tol` of the running cluster
 * mean join it. Returns clusters sorted by center: {center, min, max, count, members}.
 */
export function cluster1d(values, tol) {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = [];
  for (const p of sorted) {
    const c = out[out.length - 1];
    if (c && p.v - c.max <= tol) {
      c.members.push(p.i);
      c.max = p.v;
      c.sum += p.v;
      c.count++;
      c.center = c.sum / c.count;
    } else {
      out.push({ min: p.v, max: p.v, sum: p.v, count: 1, center: p.v, members: [p.i] });
    }
  }
  return out;
}

export { median };
