// Money parsing that understands the formats banks actually print:
// 1,234.56  1.234,56  1 234,56  1'234.56  (1,234.56)  1,234.56-  -1234,56
// 1,234.56 CR / DR  +5 000,00  $1,234.56  1 234,56 ₽  EUR 12,50

const CURRENCY_RE =
  /(?:US\$|C\$|A\$|NZ\$|HK\$|S\$|R\$|[$€£₽₹¥₴₸₺₩₪฿]|руб\.?|р\.|RUB|RUR|USD|EUR|GBP|CHF|PLN|zł|CZK|Kč|SEK|NOK|DKK|kr\.?|INR|CAD|AUD|NZD|SGD|HKD|JPY|CNY|UAH|KZT|BYN|TRY|BRL|MXN|ZAR|AED|SAR)/g;

const SPACE_CHARS = /[\s    ]/g;

// A token that looks like a printed amount (2 decimals; 3-decimal currencies are not supported yet).
const NUMBER_CORE = String.raw`(?:\d{1,3}(?:[,.'     ]\d{3})+|\d+)[.,]\d{2}`;
const MONEY_TOKEN_RE = new RegExp(
  String.raw`^[(]?\s*[+\-−–]?\s*(?:CUR\s*)?[+\-−–]?\s*` +
    NUMBER_CORE +
    String.raw`\s*(?:CUR)?\s*[)]?\s*(?:[+\-−–]|(?:CR|DR|Cr|Dr|cr|dr|C|D)\b\.?)?$`
);

export function stripCurrency(s) {
  return s.replace(CURRENCY_RE, ' CUR ');
}

export function looksLikeMoney(raw) {
  if (!raw) return false;
  const s = stripCurrency(raw.trim()).replace(/\s+/g, ' ').trim();
  return MONEY_TOKEN_RE.test(s);
}

// Find trailing amounts at the end of a text run: "COFFEE SHOP 12.50 1,234.56"
// Returns {head, tails:[raw...]} or null.
const TRAIL_RE = new RegExp(
  String.raw`^(.*?\S)\s+((?:[(]?[+\-−]?\s*(?:[$€£₽]\s*)?` + NUMBER_CORE + String.raw`[)]?(?:\s?(?:CR|DR|Cr|Dr|-))?)(?:\s+[(]?[+\-−]?\s*(?:[$€£₽]\s*)?` + NUMBER_CORE + String.raw`[)]?(?:\s?(?:CR|DR|Cr|Dr|-))?)*)$`
);

export function splitTrailingAmounts(text) {
  const m = TRAIL_RE.exec(text.trim());
  if (!m) return null;
  const tails = m[2].trim().split(/\s+(?=[(+\-−$€£₽]?\s*\d)/).map((t) => t.trim()).filter(Boolean);
  // Re-join pieces split inside grouped thousands with spaces ("1 234,56").
  const merged = [];
  for (const t of tails) {
    if (merged.length && /^\d{3}[.,]\d{2}/.test(t) && /\d$/.test(merged[merged.length - 1]) && !/[.,]\d{2}$/.test(merged[merged.length - 1])) {
      merged[merged.length - 1] += ' ' + t;
    } else merged.push(t);
  }
  if (!merged.every(looksLikeMoney)) return null;
  return { head: m[1], tails: merged };
}

/**
 * Parse a printed amount.
 * @returns {{minor:number, scale:number, negative:boolean, plus:boolean, crdr:(''|'CR'|'DR'), raw:string}|null}
 *   minor: absolute value in minor units (e.g. cents)
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!looksLikeMoney(s)) return null;
  s = stripCurrency(s).replace(/CUR/g, ' ');

  let negative = false;
  let plus = false;
  let crdr = '';

  const crdrM = /(?:^|\s|\d)(CR|DR|Cr|Dr|cr|dr|C|D)\.?\s*$/.exec(s);
  if (crdrM) {
    crdr = crdrM[1].toUpperCase().startsWith('C') ? 'CR' : 'DR';
    s = s.slice(0, s.length - crdrM[0].length + (/^\d/.test(crdrM[0]) ? 1 : 0));
  }
  s = s.trim();
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(SPACE_CHARS, '');
  if (/^[\-−–]/.test(s)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    plus = true;
    s = s.slice(1);
  }
  if (/[\-−–]$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  } else if (s.endsWith('+')) {
    plus = true;
    s = s.slice(0, -1);
  }
  if (/^[\-−–]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }

  const m = /^(.*?)[.,](\d{2})$/.exec(s);
  if (!m) return null;
  const intPart = m[1].replace(/[,.']/g, '');
  if (!/^\d+$/.test(intPart)) return null;
  const scale = 100;
  const minor = Number(intPart) * scale + Number(m[2]);
  if (!Number.isFinite(minor)) return null;
  return { minor, scale, negative, plus, crdr, raw: String(raw).trim() };
}

/** Signed value in minor units from a parsed amount, ignoring CR/DR. */
export function signedMinor(a) {
  return a.negative ? -a.minor : a.minor;
}

export function formatMinor(minor, scale = 100, { decimal = '.', group = '' } = {}) {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const digits = scale === 1000 ? 3 : 2;
  const int = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(digits, '0');
  let intStr = String(int);
  if (group) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return (neg ? '-' : '') + intStr + decimal + frac;
}

export function detectCurrency(text) {
  const counts = new Map();
  const add = (code, n = 1) => counts.set(code, (counts.get(code) || 0) + n);
  const rules = [
    [/€|\bEUR\b/g, 'EUR'],
    [/£|\bGBP\b/g, 'GBP'],
    [/₽|\bруб\.?|\bRUB\b|\bRUR\b/gi, 'RUB'],
    [/₹|\bINR\b|\bRs\.?\s/g, 'INR'],
    [/₴|\bUAH\b|\bгрн\b/g, 'UAH'],
    [/₸|\bKZT\b|\bтенге\b/gi, 'KZT'],
    [/\bCHF\b/g, 'CHF'],
    [/zł|\bPLN\b/g, 'PLN'],
    [/\bCAD\b|C\$/g, 'CAD'],
    [/\bAUD\b|A\$/g, 'AUD'],
    [/\bSGD\b|S\$/g, 'SGD'],
    [/\bBYN\b/g, 'BYN'],
    [/\bUSD\b|US\$/g, 'USD'],
    [/\$/g, 'USD'],
  ];
  for (const [re, code] of rules) {
    const m = text.match(re);
    if (m) add(code, m.length);
  }
  let best = '';
  let n = 0;
  for (const [code, c] of counts) {
    // A bare "$" also appears next to CAD/AUD/SGD; prefer the explicit code.
    const weight = code === 'USD' ? c * 0.6 : c;
    if (weight > n) {
      n = weight;
      best = code;
    }
  }
  return best;
}
