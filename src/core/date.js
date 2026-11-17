// Date parsing for statement rows: numeric (DMY / MDY / ISO), with or without
// year, and month names in EN, RU, DE, FR, ES, IT, PT, NL.

const MONTHS = {};
function addMonths(list) {
  list.forEach((names, i) => names.split('|').forEach((n) => (MONTHS[n] = i + 1)));
}
addMonths([
  'jan|january|янв|января|январь|januar|jän|jänner|janv|janvier|ene|enero|gen|gennaio|janeiro|januari',
  'feb|february|фев|февр|февраля|февраль|februar|févr|fevr|février|fevrier|febrero|febbraio|fev|fevereiro|februari',
  'mar|march|мар|марта|март|mär|märz|mrz|mars|marzo|março|marco|mrt|maart',
  'apr|april|апр|апреля|апрель|avr|avril|abr|abril|aprile',
  'may|мая|май|mai|mayo|mag|maggio|maio|mei',
  'jun|june|июн|июня|июнь|juni|juin|junio|giu|giugno|junho',
  'jul|july|июл|июля|июль|juli|juil|juillet|julio|lug|luglio|julho',
  'aug|august|авг|августа|август|août|aout|ago|agosto|augustus',
  'sep|sept|september|сен|сент|сентября|сентябрь|septembre|septiembre|set|settembre|setembro',
  'oct|october|окт|октября|октябрь|okt|oktober|octobre|octubre|ott|ottobre|out|outubro',
  'nov|november|ноя|нояб|ноября|ноябрь|novembre|noviembre|novembro',
  'dec|december|дек|декабря|декабрь|dez|dezember|déc|décembre|decembre|dic|diciembre|dicembre|dezembro',
]);

export function monthFromName(name) {
  if (!name) return null;
  const n = name.toLowerCase().replace(/\.$/, '');
  return MONTHS[n] || null;
}

const MONTH_WORD = String.raw`[A-Za-zÀ-ÿА-Яа-яЁё]{3,10}\.?`;

// Patterns are anchored at the start of a chunk; group "rest" is what follows.
const PATTERNS = [
  // ISO 2026-03-12
  { re: /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?![\d])/, kind: 'iso' },
  // 12/03/2026, 12.03.26, 03-12-2026
  { re: /^(\d{1,2})([./\-])(\d{1,2})\2(\d{4}|\d{2})(?![\d])/, kind: 'num3' },
  // 12/03, 12.03 (no year)
  { re: /^(\d{1,2})([./\-])(\d{1,2})(?![\d./\-]\d)(?!\d)/, kind: 'num2' },
  // 12 Mar 2026, 12-Mar-26, 12MAR26, 12 марта 2026 г.
  { re: new RegExp(String.raw`^(\d{1,2})[\s.\-]?(` + MONTH_WORD + String.raw`)[\s.\-,]*(\d{4}|\d{2})?(?:\s*г\.)?(?![\d])`), kind: 'dmy-text' },
  // Mar 12, 2026 / March 12
  { re: new RegExp(String.raw`^(` + MONTH_WORD + String.raw`)\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?(?![\d])`), kind: 'mdy-text' },
];

function fullYear(y) {
  if (y == null || y === '') return null;
  const n = Number(y);
  if (y.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

/**
 * Try to read a date at the start of `text`.
 * Returns {a, b, y, kind, raw, rest} where for numeric dates a/b are the first
 * two numbers (order resolved later) and for text dates a=day, b=month.
 */
export function matchDateAtStart(text) {
  const t = text.trimStart();
  for (const { re, kind } of PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    let r;
    if (kind === 'iso') r = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), kind };
    else if (kind === 'num3') r = { a: Number(m[1]), b: Number(m[3]), y: fullYear(m[4]), kind: 'num' };
    else if (kind === 'num2') r = { a: Number(m[1]), b: Number(m[3]), y: null, kind: 'num' };
    else if (kind === 'dmy-text') {
      const mon = monthFromName(m[2]);
      if (!mon) continue;
      r = { d: Number(m[1]), m: mon, y: fullYear(m[3]), kind: 'text' };
    } else if (kind === 'mdy-text') {
      const mon = monthFromName(m[1]);
      if (!mon) continue;
      r = { d: Number(m[2]), m: mon, y: m[3] ? Number(m[3]) : null, kind: 'text' };
    }
    if (r.kind === 'num' && (r.a < 1 || r.b < 1 || r.a > 31 || r.b > 31 || (r.a > 12 && r.b > 12))) continue;
    if ((r.kind === 'text' || r.kind === 'iso') && (r.d < 1 || r.d > 31 || r.m < 1 || r.m > 12)) continue;
    r.raw = m[0];
    r.rest = t.slice(m[0].length);
    // A date must be followed by whitespace or end, not by more digits/letters glued on.
    if (r.rest && !/^[\s,;|]/.test(r.rest) && r.kind !== 'text') continue;
    r.rest = r.rest.replace(/^[\s,;|]+/, '');
    return r;
  }
  return null;
}

/** Decide day/month order for numeric dates across a whole document. */
export function resolveOrder(numericDates, hint = 'dmy') {
  let dmyPossible = true;
  let mdyPossible = true;
  for (const d of numericDates) {
    if (d.b > 12) dmyPossible = false; // second number is month in DMY
    if (d.a > 12) mdyPossible = false; // first number is month in MDY
  }
  if (dmyPossible && !mdyPossible) return 'dmy';
  if (mdyPossible && !dmyPossible) return 'mdy';
  if (!dmyPossible && !mdyPossible) return hint;
  // Both possible: statements are chronological, pick the order with fewer
  // backward steps.
  const inv = (order) => {
    let n = 0;
    let prev = null;
    for (const d of numericDates) {
      const [m, day] = order === 'dmy' ? [d.b, d.a] : [d.a, d.b];
      const key = (d.y || 0) * 10000 + m * 100 + day;
      if (prev != null && key < prev) n++;
      prev = key;
    }
    return n;
  };
  const a = inv('dmy');
  const b = inv('mdy');
  if (a < b) return 'dmy';
  if (b < a) return 'mdy';
  return hint;
}

export function toYMD(d, order) {
  if (d.kind === 'num') {
    return order === 'mdy' ? { y: d.y, m: d.a, d: d.b } : { y: d.y, m: d.b, d: d.a };
  }
  return { y: d.y, m: d.m, d: d.d };
}

/** Fill in missing years using the statement end date. */
export function inferYear(ymd, endDate) {
  if (ymd.y) return ymd;
  if (!endDate) return { ...ymd, y: new Date().getFullYear(), yearGuessed: true };
  let y = endDate.y;
  if (ymd.m > endDate.m + 0 || (ymd.m === endDate.m && ymd.d > endDate.d + 7)) y -= 1;
  return { ...ymd, y, yearInferred: true };
}

export function isoDate({ y, m, d }) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isValidYMD({ y, m, d }) {
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const FULL_DATE_SCAN = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g,
  new RegExp(String.raw`\b(\d{1,2})\s+(` + MONTH_WORD + String.raw`)\s+(\d{4})`, 'g'),
  new RegExp(String.raw`\b(` + MONTH_WORD + String.raw`)\s+(\d{1,2}),?\s+(\d{4})`, 'g'),
];

/** All full dates (with years) mentioned anywhere in the text. */
export function scanFullDates(text, order = 'dmy') {
  const out = [];
  let m;
  const re0 = FULL_DATE_SCAN[0];
  re0.lastIndex = 0;
  while ((m = re0.exec(text))) out.push({ y: +m[1], m: +m[2], d: +m[3] });
  const re1 = FULL_DATE_SCAN[1];
  re1.lastIndex = 0;
  while ((m = re1.exec(text))) {
    const a = +m[1];
    const b = +m[2];
    const ymd = order === 'mdy' ? { y: +m[3], m: a, d: b } : { y: +m[3], m: b, d: a };
    out.push(ymd);
  }
  const re2 = FULL_DATE_SCAN[2];
  re2.lastIndex = 0;
  while ((m = re2.exec(text))) {
    const mon = monthFromName(m[2]);
    if (mon) out.push({ y: +m[3], m: mon, d: +m[1] });
  }
  const re3 = FULL_DATE_SCAN[3];
  re3.lastIndex = 0;
  while ((m = re3.exec(text))) {
    const mon = monthFromName(m[1]);
    if (mon) out.push({ y: +m[3], m: mon, d: +m[2] });
  }
  return out.filter((x) => x.y >= 1990 && x.y <= 2100 && isValidYMD(x));
}

export function cmpYMD(a, b) {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}
