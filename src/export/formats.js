// Export formats. Input: an array of parsed statements (from parseStatement),
// each with an extra `fileName`. Amounts in exports are cash flow from the
// account holder's point of view: money out is negative.
import { formatMinor } from '../core/amount.js';
import { buildXlsx } from './xlsx.js';

export function cashflow(st, t) {
  return st.accountType === 'liability' ? -t.effect : t.effect;
}

/** Flatten statements into export rows, sorted by statement order then row order. */
export function rowsOf(statements) {
  const rows = [];
  for (const st of statements) {
    for (const t of st.transactions) {
      if (t.excluded) continue;
      rows.push({
        date: t.date,
        valueDate: t.valueDate || '',
        description: t.description,
        amount: cashflow(st, t),
        balance: t.balance,
        check: t.balanceOk === false ? 'MISMATCH' : t.balanceOk ? 'OK' : '',
        file: st.fileName || '',
        page: t.page,
        currency: st.currency || '',
      });
    }
  }
  return rows;
}

function fmtDate(iso, f) {
  const [y, m, d] = iso.split('-');
  if (f === 'DD.MM.YYYY') return `${d}.${m}.${y}`;
  if (f === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (f === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  return iso;
}

function csvCell(v, delim) {
  const s = v == null ? '' : String(v);
  if (s.includes(delim) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  // Neutralise spreadsheet formula injection from descriptions.
  if (/^[=+\-@]/.test(s) && !/^[+\-]?\d/.test(s)) return "'" + s;
  return s;
}

export const CSV_PRESETS = {
  generic: { delimiter: ',', decimal: '.', date: 'YYYY-MM-DD', bom: true, layout: 'full' },
  excelComma: { delimiter: ';', decimal: ',', date: 'DD.MM.YYYY', bom: true, layout: 'full' },
  excelDot: { delimiter: ',', decimal: '.', date: 'MM/DD/YYYY', bom: true, layout: 'full' },
  ynab: { delimiter: ',', decimal: '.', date: 'MM/DD/YYYY', bom: false, layout: 'ynab' },
  quickbooks: { delimiter: ',', decimal: '.', date: 'MM/DD/YYYY', bom: false, layout: 'threeCol' },
  xero: { delimiter: ',', decimal: '.', date: 'DD/MM/YYYY', bom: false, layout: 'xero' },
};

export function toCSV(statements, presetName = 'generic') {
  const p = CSV_PRESETS[presetName] || CSV_PRESETS.generic;
  const rows = rowsOf(statements);
  const money = (minor) => (minor == null ? '' : formatMinor(minor, 100, { decimal: p.decimal }));
  let header;
  let body;
  if (p.layout === 'ynab') {
    header = ['Date', 'Payee', 'Memo', 'Outflow', 'Inflow'];
    body = rows.map((r) => [fmtDate(r.date, p.date), r.description, '', r.amount < 0 ? money(-r.amount) : '', r.amount > 0 ? money(r.amount) : '']);
  } else if (p.layout === 'threeCol') {
    header = ['Date', 'Description', 'Amount'];
    body = rows.map((r) => [fmtDate(r.date, p.date), r.description, money(r.amount)]);
  } else if (p.layout === 'xero') {
    header = ['*Date', '*Amount', 'Payee', 'Description', 'Reference'];
    body = rows.map((r) => [fmtDate(r.date, p.date), money(r.amount), '', r.description, '']);
  } else {
    header = ['Date', 'Value date', 'Description', 'Amount', 'Balance', 'Currency', 'Check', 'File', 'Page'];
    body = rows.map((r) => [
      fmtDate(r.date, p.date),
      r.valueDate ? fmtDate(r.valueDate, p.date) : '',
      r.description,
      money(r.amount),
      money(r.balance),
      r.currency,
      r.check,
      r.file,
      r.page,
    ]);
  }
  const text = [header, ...body].map((row) => row.map((c) => csvCell(c, p.delimiter)).join(p.delimiter)).join('\r\n') + '\r\n';
  return (p.bom ? '﻿' : '') + text;
}

/** Tab-separated text for pasting into Excel / Google Sheets. */
export function toTSV(statements, { decimal = '.' } = {}) {
  const rows = rowsOf(statements);
  const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
  const lines = [['Date', 'Description', 'Amount', 'Balance'].join('\t')];
  for (const r of rows) {
    lines.push([r.date, clean(r.description), formatMinor(r.amount, 100, { decimal }), r.balance == null ? '' : formatMinor(r.balance, 100, { decimal })].join('\t'));
  }
  return lines.join('\n');
}

export function toXLSX(statements, labels = {}) {
  const L = {
    sheet: 'Transactions',
    summary: 'Summary',
    date: 'Date',
    valueDate: 'Value date',
    description: 'Description',
    amount: 'Amount',
    balance: 'Balance',
    check: 'Check',
    file: 'File',
    page: 'Page',
    opening: 'Opening balance',
    closing: 'Closing balance',
    sum: 'Sum of rows',
    status: 'Status',
    rows: 'Rows',
    ...labels,
  };
  const rows = rowsOf(statements);
  const major = (m) => (m == null ? null : m / 100);
  const tx = {
    name: L.sheet,
    columns: [
      { header: L.date, type: 'date', width: 12 },
      { header: L.valueDate, type: 'date', width: 12 },
      { header: L.description, type: 'string', width: 50 },
      { header: L.amount, type: 'money', width: 14 },
      { header: L.balance, type: 'money', width: 14 },
      { header: L.check, type: 'string', width: 10 },
      { header: L.file, type: 'string', width: 24 },
      { header: L.page, type: 'number', width: 6 },
    ],
    rows: rows.map((r) => [r.date, r.valueDate || null, r.description, major(r.amount), major(r.balance), r.check, r.file, r.page]),
  };
  const summary = {
    name: L.summary,
    columns: [
      { header: L.file, type: 'string', width: 30 },
      { header: L.rows, type: 'number', width: 8 },
      { header: L.opening, type: 'money', width: 16 },
      { header: L.sum, type: 'money', width: 16 },
      { header: L.closing, type: 'money', width: 16 },
      { header: L.status, type: 'string', width: 14 },
    ],
    rows: statements.map((st) => [
      st.fileName || '',
      st.transactions.length,
      st.opening ? major(st.opening.minor) : null,
      major(st.sum ?? 0),
      st.closing ? major(st.closing.minor) : null,
      st.status,
    ]),
  };
  return buildXlsx([tx, summary]);
}

// ---------------- OFX (SGML 1.02, widely accepted by GnuCash, Actual, Firefly, Moneydance) ----
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function toOFX(statements, { accountId = 'SVERKA' } = {}) {
  const liab = statements.some((s) => s.accountType === 'liability');
  const rows = rowsOf(statements);
  const cur = (statements.find((s) => s.currency) || {}).currency || 'USD';
  const d8 = (iso) => iso.replace(/-/g, '');
  const dates = rows.map((r) => r.date).sort();
  const last = statements[statements.length - 1];
  const ledger = last && last.closing ? (liab ? -last.closing.minor : last.closing.minor) : null;
  const seen = new Map();
  const trn = rows
    .map((r) => {
      const base = `${r.date}|${r.amount}|${r.description}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return (
        `<STMTTRN><TRNTYPE>${r.amount < 0 ? 'DEBIT' : 'CREDIT'}</TRNTYPE><DTPOSTED>${d8(r.date)}</DTPOSTED>` +
        `<TRNAMT>${formatMinor(r.amount)}</TRNAMT><FITID>${hash(base)}${n}</FITID>` +
        `<NAME>${xmlEsc(r.description.slice(0, 32))}</NAME><MEMO>${xmlEsc(r.description.slice(0, 255))}</MEMO></STMTTRN>`
      );
    })
    .join('\n');
  const acct = liab
    ? `<CCACCTFROM><ACCTID>${accountId}</ACCTID></CCACCTFROM>`
    : `<BANKACCTFROM><BANKID>000000000</BANKID><ACCTID>${accountId}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>`;
  const body =
    `<CURDEF>${cur}</CURDEF>${acct}<BANKTRANLIST><DTSTART>${dates.length ? d8(dates[0]) : ''}</DTSTART><DTEND>${dates.length ? d8(dates[dates.length - 1]) : ''}</DTEND>\n${trn}\n</BANKTRANLIST>` +
    (ledger != null ? `<LEDGERBAL><BALAMT>${formatMinor(ledger)}</BALAMT><DTASOF>${d8(dates[dates.length - 1] || '19700101')}</DTASOF></LEDGERBAL>` : '');
  const msg = liab
    ? `<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><CCSTMTRS>${body}</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>`
    : `<BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><STMTRS>${body}</STMTRS></STMTTRNRS></BANKMSGSRSV1>`;
  return (
    'OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:UTF-8\r\nCHARSET:NONE\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n\r\n' +
    `<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>${d8(dates[dates.length - 1] || '19700101')}</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>\n` +
    msg +
    '</OFX>\r\n'
  );
}

// ---------------- QIF ----------------
export function toQIF(statements) {
  const liab = statements.some((s) => s.accountType === 'liability');
  const rows = rowsOf(statements);
  const out = [liab ? '!Type:CCard' : '!Type:Bank'];
  for (const r of rows) {
    out.push('D' + fmtDate(r.date, 'MM/DD/YYYY'), 'T' + formatMinor(r.amount), 'P' + r.description.replace(/\n/g, ' '), '^');
  }
  return out.join('\n') + '\n';
}

// ---------------- Beancount (with balance assertions from the statement) ----------------
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function toBeancount(statements, { account } = {}) {
  const liab = statements.some((s) => s.accountType === 'liability');
  const acct = account || (liab ? 'Liabilities:CreditCard' : 'Assets:Bank:Checking');
  const cur = ((statements.find((s) => s.currency) || {}).currency || 'USD').toUpperCase();
  const rows = rowsOf(statements);
  const all = rows.map((r) => r.date).sort();
  const first = all[0] || '2000-01-01';
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const bal = (st, minor) => (st.accountType === 'liability' ? -minor : minor);
  const out = [
    `; Generated by Sverka — rows verified against the statement where marked.`,
    `option "operating_currency" "${cur}"`,
    '',
    `${addDays(first, -2)} open ${acct} ${cur}`,
    `${addDays(first, -2)} open Expenses:Uncategorized ${cur}`,
    `${addDays(first, -2)} open Income:Uncategorized ${cur}`,
    `${addDays(first, -2)} open Equity:Opening-Balances ${cur}`,
    '',
  ];
  statements.forEach((st, si) => {
    const txs = st.transactions.filter((t) => !t.excluded);
    if (!txs.length) return;
    const from = txs.map((t) => t.date).sort()[0];
    const to = txs.map((t) => t.date).sort().pop();
    if (st.opening) {
      if (si === 0) out.push(`${addDays(from, -1)} pad ${acct} Equity:Opening-Balances`);
      out.push(`${from} balance ${acct} ${formatMinor(bal(st, st.opening.minor))} ${cur}`, '');
    }
    for (const t of txs) {
      const amt = cashflow(st, t);
      const other = amt < 0 ? 'Expenses:Uncategorized' : 'Income:Uncategorized';
      out.push(`${t.date} * ${q(t.description)}`, `  ${acct}  ${formatMinor(amt)} ${cur}`, `  ${other}`, '');
    }
    if (st.closing) out.push(`${addDays(to, 1)} balance ${acct} ${formatMinor(bal(st, st.closing.minor))} ${cur}`, '');
  });
  return out.join('\n');
}

export function toJSON(statements) {
  return JSON.stringify(
    statements.map((st) => ({
      file: st.fileName,
      status: st.status,
      accountType: st.accountType,
      currency: st.currency,
      opening: st.opening ? st.opening.minor / 100 : null,
      closing: st.closing ? st.closing.minor / 100 : null,
      checks: st.checks,
      transactions: st.transactions
        .filter((t) => !t.excluded)
        .map((t) => ({
          date: t.date,
          valueDate: t.valueDate || null,
          description: t.description,
          amount: cashflow(st, t) / 100,
          balance: t.balance == null ? null : t.balance / 100,
          balanceCheck: t.balanceOk,
          page: t.page,
        })),
    })),
    null,
    2
  );
}
