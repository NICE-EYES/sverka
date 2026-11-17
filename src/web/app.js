import { extractPages, PasswordRequired } from '../core/pdf.js';
import { parseStatement } from '../core/parse.js';
import { reconcile } from '../core/reconcile.js';
import { parseAmount } from '../core/amount.js';
import { matchDateAtStart, isValidYMD, isoDate } from '../core/date.js';
import { toCSV, toTSV, toXLSX, toOFX, toQIF, toBeancount, toJSON, cashflow } from '../export/formats.js';
import { STRINGS } from './i18n.js';
import { SAMPLES } from './samples.js';

const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ------------------------------------------------------------------ state
const state = {
  lang: initialLang(),
  files: [], // {id, name, bytes, pages, status, error, st, opts, sample, showSrc:Set}
  format: 'xlsx',
};
let nextId = 1;
const $ = (sel) => document.querySelector(sel);
const t = (key, ...args) => {
  const v = STRINGS[state.lang][key];
  return typeof v === 'function' ? v(...args) : v;
};

function initialLang() {
  try {
    const saved = localStorage.getItem('sverka.lang');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch (e) {
    /* storage unavailable */
  }
  const nav = (navigator.language || 'en').toLowerCase();
  return /^(ru|uk|be|kk)/.test(nav) ? 'ru' : 'en';
}

// ------------------------------------------------------------------ formatting
function money(minor, { sign = false } = {}) {
  if (minor == null) return '';
  const nf = new Intl.NumberFormat(state.lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = nf.format(Math.abs(minor) / 100);
  if (minor < 0) return '−' + s;
  return sign && minor > 0 ? '+' + s : s;
}
function dateStr(iso) {
  if (!iso) return '';
  if (state.lang === 'ru') {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  return iso;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ------------------------------------------------------------------ pdf.js
function pdfjs() {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('pdf.js did not load. Check the internet connection and reload the page.');
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return lib;
}

// ------------------------------------------------------------------ files
async function addFiles(fileList, { sample = false } = {}) {
  if (!sample) state.files = state.files.filter((f) => !f.sample);
  const entries = [];
  for (const file of fileList) {
    const entry = { id: nextId++, name: file.name, bytes: null, pages: null, status: 'reading', st: null, opts: {}, sample, showSrc: new Set() };
    state.files.push(entry);
    entries.push({ entry, file });
  }
  render();
  for (const { entry, file } of entries) {
    try {
      entry.bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(await file.arrayBuffer());
      await loadEntry(entry);
    } catch (e) {
      entry.status = 'error';
      entry.error = e && e.message ? e.message : String(e);
    }
    render();
  }
}

async function loadEntry(entry, password) {
  try {
    const res = await extractPages(pdfjs(), entry.bytes.slice(), { password });
    entry.pages = res.pages;
    entry.scanned = res.scanned;
    entry.password = password;
    parseEntry(entry);
  } catch (e) {
    if (e instanceof PasswordRequired) {
      entry.status = 'password';
      entry.pwWrong = e.incorrect;
      return;
    }
    throw e;
  }
}

function parseEntry(entry) {
  const st = parseStatement(entry.pages, entry.opts);
  st.fileName = entry.name;
  entry.st = st;
  if (!st.transactions.length) entry.status = entry.scanned ? 'scanned' : 'norows';
  else entry.status = 'ok';
}

function loadSample() {
  const s = SAMPLES[state.lang] || SAMPLES.en;
  const bytes = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
  state.files = state.files.filter((f) => !f.sample);
  return addFiles([{ name: s.name, bytes, arrayBuffer: async () => bytes.buffer }], { sample: true });
}

// ------------------------------------------------------------------ rendering
function applyStatic() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  const lb = $('#lang-btn');
  lb.textContent = t('langSwitch');
  lb.setAttribute('aria-label', t('langLabel'));
  renderFormats();
}

function render() {
  const okFiles = state.files.filter((f) => f.status === 'ok');
  $('#sample-banner').hidden = !state.files.some((f) => f.sample);
  $('#clear-btn').hidden = !state.files.some((f) => !f.sample);
  $('#statements').innerHTML = state.files.map(renderEntry).join('');
  renderChain(okFiles);
  renderTrayScope();
}

function renderEntry(f) {
  const head = (stampHtml = '') => `
    <header class="stmt-head">
      <div class="stmt-title"><h2>${esc(f.name)}</h2>${f.st && f.status === 'ok' ? `<p class="meta">${esc(metaLine(f.st))}</p>` : ''}</div>
      <div style="display:flex;gap:6px;align-items:start">${stampHtml}<button class="rowbtn" data-act="remove" data-file="${f.id}" title="${esc(t('remove'))}" aria-label="${esc(t('remove'))}">✕</button></div>
    </header>`;
  if (f.status === 'reading') return `<article class="stmt">${head()}<div class="stmt-body"><p class="msg">${esc(t('reading'))}</p></div></article>`;
  if (f.status === 'password')
    return `<article class="stmt">${head()}<div class="stmt-body">
      <p class="msg ${f.pwWrong ? 'err' : ''}">${esc(f.pwWrong ? t('passwordWrong') : t('password'))}</p>
      <form class="pw" data-file="${f.id}" data-act="password">
        <input type="password" id="pw-${f.id}" placeholder="${esc(t('passwordPlaceholder'))}" autocomplete="off" aria-label="${esc(t('passwordPlaceholder'))}">
        <button class="btn btn-primary" type="submit">${esc(t('open'))}</button>
      </form></div></article>`;
  if (f.status === 'error') return `<article class="stmt">${head()}<div class="stmt-body"><p class="msg err">${esc(t('error'))}: ${esc(f.error)}</p></div></article>`;
  if (f.status === 'scanned') return `<article class="stmt">${head()}<div class="stmt-body"><p class="msg err">${esc(t('scanned'))}</p></div></article>`;
  if (f.status === 'norows') return `<article class="stmt">${head()}<div class="stmt-body"><p class="msg err">${esc(t('noRows'))}</p>${optsHtml(f)}</div></article>`;

  const st = f.st;
  const stampCls = st.status === 'verified' ? 'stamp-ok' : st.status === 'mismatch' ? 'stamp-bad' : 'stamp-none';
  const stamp = `<div class="stamp ${stampCls}">${esc(t(st.status))}</div>`;
  const lead = st.status === 'verified' ? t('verifiedLead') : st.status === 'mismatch' ? t('mismatchLead') : t('unverifiedLead');
  return `<article class="stmt" id="stmt-${f.id}">
    ${head(stamp)}
    <div class="stmt-body">
      <p class="lead">${esc(lead)}</p>
      <ul class="checks">${checksHtml(st)}</ul>
      ${fixHtml(f)}
      ${optsHtml(f)}
      <p class="edit-hint">${esc(t('editHint'))}</p>
    </div>
    <div class="table-wrap">${tableHtml(f)}</div>
  </article>`;
}

function metaLine(st) {
  const parts = [];
  if (st.period) parts.push(`${dateStr(st.period.from)} — ${dateStr(st.period.to)}`);
  parts.push(t('rows', st.transactions.filter((x) => !x.excluded).length));
  parts.push(t('pages', st.pages));
  if (st.currency) parts.push(st.currency);
  return parts.join(' · ');
}

function checksHtml(st) {
  const items = [];
  const liab = st.accountType === 'liability';
  // Balances in the check sentences are shown as printed on the statement.
  for (const c of st.checks) {
    if (c.id === 'period') {
      const note = !c.strong ? ` (${t('openingInferred')})` : '';
      if (c.status === 'ok') items.push(['ok', t('chkPeriodOk', money(c.opening), money(c.sum, { sign: true }), money(c.closing)) + note]);
      else items.push(['fail', t('chkPeriodFail', money(c.opening), money(c.sum, { sign: true }), money(c.expected), money(c.closing), money(c.diff, { sign: true })) + note]);
    } else if (c.id === 'running' && c.status !== 'na') {
      if (c.status === 'ok') items.push(['ok', t('chkRunningOk', c.total)]);
      else items.push(['fail', t('chkRunningFail', c.total - c.ok, c.total, c.firstBadId)]);
    } else if (c.id === 'totalDebit') {
      items.push(c.status === 'ok' ? ['ok', t('chkTotalDebitOk', money(c.expected))] : ['fail', t('chkTotalFail', t('totalDebit'), money(c.expected), money(c.actual))]);
    } else if (c.id === 'totalCredit') {
      items.push(c.status === 'ok' ? ['ok', t('chkTotalCreditOk', money(c.expected))] : ['fail', t('chkTotalFail', t('totalCredit'), money(c.expected), money(c.actual))]);
    }
  }
  if (liab) items.push(['note', t('liabilityHint')]);
  return items.map(([cls, text]) => `<li class="chk ${cls}"><span class="mark">${cls === 'ok' ? '✓' : cls === 'fail' ? '✕' : 'i'}</span><span>${esc(text)}</span></li>`).join('');
}

function fixHtml(f) {
  const st = f.st;
  const run = st.checks.find((c) => c.id === 'running' && c.status === 'fail');
  if (!run) return '';
  const row = st.transactions.find((x) => x.id === run.firstBadId);
  if (!row) return '';
  const diff = row.balance - row.balanceExpected; // what is missing to reach the printed balance
  const liab = st.accountType === 'liability';
  const curCash = cashflow(st, row);
  const fixedCash = liab ? -(row.effect + diff) : row.effect + diff;
  const missingCash = liab ? -diff : diff;
  return `<div class="fix" role="group">
    <div><b>№ ${row.id}</b> · ${esc(dateStr(row.date))} · ${esc(row.description)} · ${esc(money(curCash))}<br>${esc(t('rowBad', money(row.balanceExpected)))}; ${esc(t('colBalance').toLowerCase())}: ${esc(money(row.balance))}</div>
    <div class="src">${esc(t('source'))} (${esc(t('pageN', row.page))}): ${esc(row.source)}</div>
    <div>${esc(t('fixHint'))}</div>
    <div class="fix-actions">
      <button class="btn btn-small" data-act="fix-amount" data-file="${f.id}" data-row="${row.id}" data-diff="${diff}">${esc(t('fixAmount', money(fixedCash)))}</button>
      <button class="btn btn-small" data-act="insert-missing" data-file="${f.id}" data-row="${row.id}" data-diff="${diff}">${esc(t('insertMissing', money(missingCash, { sign: true })))}</button>
    </div>
  </div>`;
}

function optsHtml(f) {
  const st = f.st;
  const type = (st && st.accountType) || f.opts.accountType || 'asset';
  const order = (st && st.dateOrder) || f.opts.dateOrder || 'dmy';
  const seg = (name, val, options) =>
    `<span class="seg" role="group">${options
      .map(([v, label]) => `<button type="button" data-act="opt" data-file="${f.id}" data-opt="${name}" data-val="${v}" aria-pressed="${v === val}">${esc(label)}</button>`)
      .join('')}</span>`;
  return `<div class="opts">
    <span>${esc(t('accountKind'))}${seg('accountType', type, [['asset', t('asset')], ['liability', t('liability')]])}</span>
    <span>${esc(t('dateOrder'))}${seg('dateOrder', order, [['dmy', t('dmy')], ['mdy', t('mdy')]])}</span>
  </div>`;
}

function tableHtml(f) {
  const st = f.st;
  const rows = st.transactions
    .map((r) => {
      const cash = cashflow(st, r);
      const cls = [r.excluded ? 'excluded' : '', r.balanceOk === false ? 'bad' : ''].join(' ');
      const titles = [];
      if (r.flags.dateInherited) titles.push(t('flagInherited'));
      if (r.flags.yearInferred) titles.push(t('flagYear'));
      const amtTitle = r.flags.signUnknown ? t('flagSignUnknown') : r.signSource === 'balance' ? t('flagSign') : '';
      const dot =
        r.balanceOk === true
          ? `<span class="dot ok" title="${esc(t('rowOk'))}">✓</span>`
          : r.balanceOk === false
            ? `<span class="dot bad" title="${esc(t('rowBad', money(r.balanceExpected)))}">!</span>`
            : `<span class="dot na">·</span>`;
      const main = `<tr class="${cls}" data-row="${r.id}">
        <td class="n" data-act="src" data-file="${f.id}" data-row="${r.id}" title="${esc(t('source'))}">${r.id}</td>
        <td class="date${r.flags.dateInherited ? ' inherited' : ''}" title="${esc(titles.join('; '))}"><span class="v" contenteditable="true" spellcheck="false" data-edit="date" data-file="${f.id}" data-row="${r.id}">${esc(dateStr(r.date))}</span></td>
        <td class="desc"><span class="v" contenteditable="true" data-edit="desc" data-file="${f.id}" data-row="${r.id}">${esc(r.description)}</span></td>
        <td class="num amt ${cash < 0 ? 'neg' : cash > 0 ? 'pos' : ''}${amtTitle ? ' warn' : ''}" title="${esc(amtTitle)}"><span class="v" contenteditable="true" spellcheck="false" data-edit="amount" data-file="${f.id}" data-row="${r.id}">${esc(money(cash))}</span></td>
        <td class="num bal">${esc(money(r.balance))}</td>
        <td class="chkc">${dot}</td>
        <td class="chkc"><button class="rowbtn" data-act="toggle-row" data-file="${f.id}" data-row="${r.id}" title="${esc(r.excluded ? t('includeRow') : t('excludeRow'))}" aria-label="${esc(r.excluded ? t('includeRow') : t('excludeRow'))}">${r.excluded ? '↺' : '✕'}</button></td>
      </tr>`;
      const src = f.showSrc.has(r.id) ? `<tr class="src-row"><td></td><td colspan="6">${esc(t('pageN', r.page))}: ${esc(r.source)}</td></tr>` : '';
      return main + src;
    })
    .join('');
  return `<table>
    <thead><tr><th>${esc(t('colN'))}</th><th>${esc(t('colDate'))}</th><th>${esc(t('colDesc'))}</th><th class="num">${esc(t('colAmount'))}</th><th class="num">${esc(t('colBalance'))}</th><th>${esc(t('colCheck'))}</th><th><span class="sr-only">—</span></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderChain(okFiles) {
  const out = [];
  const sts = okFiles
    .filter((f) => !f.sample && f.st.period)
    .map((f) => f.st)
    .sort((a, b) => (a.period.from < b.period.from ? -1 : 1));
  for (let i = 1; i < sts.length; i++) {
    const a = sts[i - 1];
    const b = sts[i];
    if (b.period.from < a.period.to) {
      out.push(`<p class="chk fail"><span class="mark">!</span><span>${esc(t('chainOverlap', a.fileName, b.fileName))}</span></p>`);
      continue;
    }
    if (!a.closing || !b.opening) continue;
    if (a.closing.minor === b.opening.minor) out.push(`<p class="chk ok"><span class="mark">✓</span><span>${esc(t('chainOk', a.fileName, b.fileName))}</span></p>`);
    else out.push(`<p class="chk fail"><span class="mark">✕</span><span>${esc(t('chainFail', a.fileName, b.fileName, money(a.closing.minor), money(b.opening.minor)))}</span></p>`);
  }
  $('#chain').innerHTML = out.join('');
}

const FORMATS = ['xlsx', 'excelComma', 'excelDot', 'generic', 'ynab', 'quickbooks', 'xero', 'ofx', 'qif', 'beancount', 'json'];
function renderFormats() {
  $('#formats').innerHTML =
    `<legend class="sr-only">${esc(t('exportTitle'))}</legend>` +
    FORMATS.map((k) => {
      const [name, hint] = t('fmt')[k];
      return `<label class="fmt"><input type="radio" name="fmt" id="fmt-${k}" value="${k}" ${state.format === k ? 'checked' : ''}><b>${esc(name)}</b><small>${esc(hint)}</small></label>`;
    }).join('');
}

function renderTrayScope() {
  const sts = exportStatements();
  const n = sts.reduce((s, st) => s + st.transactions.filter((x) => !x.excluded).length, 0);
  $('#scope').textContent = t('exportScope', n, sts.length);
  const warn = sts.some((st) => st.status === 'mismatch');
  $('#export-warn').hidden = !warn;
  $('#export-warn').textContent = t('exportWarn');
  $('#dl-btn').disabled = n === 0;
  $('#copy-btn').disabled = n === 0;
}

function exportStatements() {
  return state.files.filter((f) => f.status === 'ok' && f.st).map((f) => f.st);
}

// ------------------------------------------------------------------ export
function buildExport(fmt) {
  const sts = exportStatements();
  const base = sts.length === 1 ? sts[0].fileName.replace(/\.pdf$/i, '') : 'statements';
  const name = (ext) => `${base}.${ext}`;
  switch (fmt) {
    case 'xlsx':
      return {
        filename: name('xlsx'),
        data: toXLSX(sts, xlsxLabels()),
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        text: toTSV(sts, { decimal: state.lang === 'ru' ? ',' : '.' }),
      };
    case 'excelComma':
    case 'excelDot':
    case 'generic':
    case 'ynab':
    case 'quickbooks':
    case 'xero': {
      const csv = toCSV(sts, fmt);
      return { filename: name(fmt === 'generic' || fmt.startsWith('excel') ? 'csv' : `${fmt}.csv`), data: csv, mime: 'text/csv', text: csv.replace(/^﻿/, '') };
    }
    case 'ofx': {
      const s = toOFX(sts);
      return { filename: name('ofx'), data: s, mime: 'application/x-ofx', text: s };
    }
    case 'qif': {
      const s = toQIF(sts);
      return { filename: name('qif'), data: s, mime: 'application/qif', text: s };
    }
    case 'beancount': {
      const s = toBeancount(sts);
      return { filename: name('beancount'), data: s, mime: 'text/plain', text: s };
    }
    default: {
      const s = toJSON(sts);
      return { filename: name('json'), data: s, mime: 'application/json', text: s };
    }
  }
}

function xlsxLabels() {
  return state.lang === 'ru'
    ? { sheet: 'Операции', summary: 'Сверка', date: 'Дата', valueDate: 'Дата валютирования', description: 'Описание', amount: 'Сумма', balance: 'Остаток', check: 'Сверка', file: 'Файл', page: 'Стр.', opening: 'Начальный остаток', closing: 'Конечный остаток', sum: 'Сумма операций', status: 'Статус', rows: 'Строк' }
    : {};
}

function trayMsg(text, err = false) {
  const el = $('#tray-msg');
  el.textContent = text || '';
  el.classList.toggle('err', !!err);
}

function onDownload() {
  const exp = buildExport(state.format);
  $('#copy-area').hidden = true;
  const blob = new Blob([exp.data], { type: exp.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exp.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  trayMsg(t('saved'));
}

function onCopy() {
  const exp = buildExport(state.format);
  const area = $('#copy-area');
  const showArea = () => {
    area.hidden = false;
    area.value = exp.text;
    area.focus();
    area.select();
  };
  try {
    navigator.clipboard
      .writeText(exp.text)
      .then(() => {
        area.hidden = true;
        trayMsg(t('copied'));
      })
      .catch(() => {
        showArea();
        trayMsg(t('copyFailed'), true);
      });
  } catch (e) {
    showArea();
    trayMsg(t('copyFailed'), true);
  }
}

// ------------------------------------------------------------------ editing
function findRow(fileId, rowId) {
  const f = state.files.find((x) => x.id === Number(fileId));
  if (!f || !f.st) return {};
  const r = f.st.transactions.find((x) => x.id === Number(rowId));
  return { f, r };
}

function commitEdit(el) {
  const { f, r } = findRow(el.dataset.file, el.dataset.row);
  if (!r) return;
  const text = el.textContent.trim();
  const kind = el.dataset.edit;
  if (kind === 'desc') {
    if (text !== r.description) r.description = text;
  } else if (kind === 'date') {
    const d = matchDateAtStart(text);
    let ymd = null;
    if (d) {
      if (d.kind === 'iso' || d.kind === 'text') ymd = { y: d.y, m: d.m, d: d.d };
      else ymd = state.lang === 'ru' || f.st.dateOrder === 'dmy' ? { y: d.y, m: d.b, d: d.a } : { y: d.y, m: d.a, d: d.b };
      if (!ymd.y) ymd.y = Number(r.date.slice(0, 4));
    }
    if (ymd && isValidYMD(ymd)) r.date = isoDate(ymd);
  } else if (kind === 'amount') {
    const cash = parseEditedAmount(text);
    if (cash != null) {
      r.effect = f.st.accountType === 'liability' ? -cash : cash;
      r.flags.signUnknown = false;
      r.signSource = 'manual';
    }
  }
  reconcile(f.st);
  render();
}

function parseEditedAmount(text) {
  const s = text.replace(/[−–]/g, '-').trim();
  if (/^[+-]?\d+$/.test(s.replace(/[\s  ]/g, ''))) return Number(s.replace(/[\s  +]/g, '')) * 100;
  const a = parseAmount(s);
  if (!a) return null;
  return a.negative ? -a.minor : a.minor;
}

// ------------------------------------------------------------------ events
function bind() {
  const input = $('#file-input');
  input.addEventListener('change', () => {
    if (input.files.length) addFiles([...input.files]);
    input.value = '';
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        drop.classList.add('over');
      }
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (ev === 'dragleave' && e.relatedTarget) return;
      drop.classList.remove('over');
    })
  );
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (files.length) addFiles(files);
  });

  $('#sample-btn').addEventListener('click', () => loadSample());
  $('#clear-btn').addEventListener('click', () => {
    state.files = [];
    render();
  });
  $('#lang-btn').addEventListener('click', () => {
    state.lang = state.lang === 'ru' ? 'en' : 'ru';
    try {
      localStorage.setItem('sverka.lang', state.lang);
    } catch (e) {
      /* ignore */
    }
    applyStatic();
    if (state.files.length && state.files.every((f) => f.sample)) loadSample();
    else render();
  });
  $('#formats').addEventListener('change', (e) => {
    if (e.target.name === 'fmt') {
      state.format = e.target.value;
      trayMsg('');
      $('#copy-area').hidden = true;
    }
  });
  $('#dl-btn').addEventListener('click', onDownload);
  $('#copy-btn').addEventListener('click', onCopy);

  const list = $('#statements');
  list.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'remove') {
      state.files = state.files.filter((f) => f.id !== Number(el.dataset.file));
      render();
    } else if (act === 'opt') {
      const f = state.files.find((x) => x.id === Number(el.dataset.file));
      if (!f || !f.pages) return;
      f.opts = { ...f.opts, [el.dataset.opt]: el.dataset.val };
      parseEntry(f);
      render();
    } else if (act === 'toggle-row') {
      const { f, r } = findRow(el.dataset.file, el.dataset.row);
      if (!r) return;
      r.excluded = !r.excluded;
      reconcile(f.st);
      render();
    } else if (act === 'src') {
      const f = state.files.find((x) => x.id === Number(el.dataset.file));
      const id = Number(el.dataset.row);
      if (f.showSrc.has(id)) f.showSrc.delete(id);
      else f.showSrc.add(id);
      render();
    } else if (act === 'fix-amount') {
      const { f, r } = findRow(el.dataset.file, el.dataset.row);
      if (!r) return;
      r.effect += Number(el.dataset.diff);
      r.signSource = 'manual';
      reconcile(f.st);
      render();
    } else if (act === 'insert-missing') {
      const { f, r } = findRow(el.dataset.file, el.dataset.row);
      if (!r) return;
      const txs = f.st.transactions;
      const idx = txs.indexOf(r);
      const newId = Math.max(...txs.map((x) => x.id)) + 1;
      txs.splice(idx, 0, {
        id: newId,
        date: r.date,
        description: t('missingRow'),
        effect: Number(el.dataset.diff),
        balance: null,
        page: r.page,
        flags: {},
        signSource: 'manual',
        source: '',
      });
      reconcile(f.st);
      render();
    }
  });
  list.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-act="password"]');
    if (!form) return;
    e.preventDefault();
    const f = state.files.find((x) => x.id === Number(form.dataset.file));
    const pw = form.querySelector('input').value;
    if (!f || !pw) return;
    f.status = 'reading';
    render();
    loadEntry(f, pw)
      .catch((err) => {
        f.status = 'error';
        f.error = err.message;
      })
      .then(render);
  });
  list.addEventListener('keydown', (e) => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    } else if (e.key === 'Escape') {
      el.dataset.cancel = '1';
      el.blur();
    }
  });
  list.addEventListener('focusout', (e) => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    if (el.dataset.cancel) {
      render();
      return;
    }
    commitEdit(el);
  });
  list.addEventListener('paste', (e) => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  });
}

// ------------------------------------------------------------------ boot
applyStatic();
bind();
render();
loadSample();
