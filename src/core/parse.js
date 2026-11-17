import { buildLines, cluster1d, median } from './layout.js';
import { looksLikeMoney, parseAmount, splitTrailingAmounts, detectCurrency } from './amount.js';
import { matchDateAtStart, resolveOrder, toYMD, inferYear, isoDate, isValidYMD, scanFullDates, cmpYMD } from './date.js';
import {
  headerRoleOf,
  OPENING_RE,
  CLOSING_RE,
  TOTAL_RE,
  TOTAL_DEBIT_RE,
  TOTAL_CREDIT_RE,
  SECTION_CREDIT_RE,
  SECTION_DEBIT_RE,
  LIABILITY_RE,
} from './keywords.js';
import { reconcile } from './reconcile.js';

const AMOUNT_ROLES = new Set(['debit', 'credit', 'amount', 'balance']);

/**
 * Parse one statement.
 * @param {Array<{width:number,height:number,items:Array<{str:string,x:number,y:number,w:number,h:number}>}>} pages
 * @param {{accountType?:'asset'|'liability', dateOrder?:'dmy'|'mdy'}} opts
 */
export function parseStatement(pages, opts = {}) {
  const lines = buildLines(pages);
  const fullText = lines.map((l) => l.text).join('\n');
  const warnings = [];
  const sizeMed = median(lines.map((l) => l.size)) || 9;

  if (!lines.length || fullText.replace(/\s/g, '').length < 20) {
    return finish({ transactions: [], warnings: ['noText'], lines, pages: pages.length });
  }

  const accountType = opts.accountType || (LIABILITY_RE.test(fullText) ? 'liability' : 'asset');

  // ---- 1. Per-line analysis: dates and money chunks -------------------------------
  const info = lines.map(analyzeLine);

  // ---- 2. Day/month order and statement year -----------------------------------------
  const commaDec = info.reduce((n, l) => n + l.money.filter((m) => /,\d{2}\b/.test(m.chunk.text)).length, 0);
  const dotDec = info.reduce((n, l) => n + l.money.filter((m) => /\.\d{2}\b/.test(m.chunk.text)).length, 0);
  const cyr = /[А-Яа-яЁё]/.test(fullText);
  const hint = opts.dateOrder || (commaDec > dotDec || cyr ? 'dmy' : /\$/.test(fullText) && !/€|£/.test(fullText) ? 'mdy' : 'dmy');
  const numericDates = info.filter((l) => l.date && l.money.length && l.date.kind === 'num').map((l) => l.date);
  const dateOrder = opts.dateOrder || resolveOrder(numericDates, hint);

  const fullDates = scanFullDates(fullText, dateOrder);
  for (const l of info) {
    if (l.date && l.money.length) {
      const ymd = toYMD(l.date, dateOrder);
      if (ymd.y && isValidYMD(ymd)) fullDates.push(ymd);
    }
  }
  const endDate = fullDates.length ? fullDates.reduce((a, b) => (cmpYMD(a, b) >= 0 ? a : b)) : null;

  const resolveDate = (d) => {
    if (!d) return null;
    let ymd = toYMD(d, dateOrder);
    ymd = inferYear(ymd, endDate);
    if (!isValidYMD(ymd)) return null;
    return ymd;
  };

  const isKeywordLine = (l) => kw(OPENING_RE, l) || kw(CLOSING_RE, l) || kw(TOTAL_RE, l);

  // ---- 3. Candidate transaction lines and the description column --------------------
  const cand = info.filter((l) => l.date && l.money.length && !isKeywordLine(l) && resolveDate(l.date));
  if (!cand.length) {
    warnings.push('noRows');
    return finish({ transactions: [], warnings, lines, pages: pages.length, accountType, currency: detectCurrency(fullText) });
  }
  const descStarts = cand.map((l) => (l.texts[0] ? l.texts[0].x0 : null)).filter((x) => x != null);
  const descX0 = descStarts.length ? median(descStarts) : median(cand.map((l) => l.dateX1)) + sizeMed;
  const descEnds = cand.flatMap((l) => l.texts.filter((t) => !t.estimated).map((t) => t.x1)).sort((a, b) => a - b);
  const descEndP90 = descEnds.length ? descEnds[Math.floor(descEnds.length * 0.9)] : descX0;

  // ---- 4. Header line ------------------------------------------------------------------
  const header = findHeader(lines, info, cand[0]);

  // ---- 5. Amount columns: cluster right edges of money chunks ---------------------------
  const tol = Math.max(4, 0.9 * sizeMed);
  const moneyPts = [];
  for (const l of cand) for (const m of l.money) if (!m.estimated) moneyPts.push({ x1: m.chunk.x1, x0: m.chunk.x0 });
  for (const l of cand) for (const m of l.money) if (m.estimated) moneyPts.push({ x1: m.chunk.x1, x0: m.chunk.x0, est: true });
  let clusters = cluster1d(moneyPts.map((p) => p.x1), tol);
  const centerClusters = cluster1d(moneyPts.map((p) => (p.x0 + p.x1) / 2), tol * 1.5);
  if (centerClusters.length < clusters.length) clusters = centerClusters.map((c) => ({ ...c, byCenter: true }));
  const N = cand.length;
  let columns = clusters
    .map((c) => {
      const pts = c.members.map((i) => moneyPts[i]);
      return {
        x0: Math.min(...pts.map((p) => p.x0)),
        x1: Math.max(...pts.map((p) => p.x1)),
        center: c.center,
        byCenter: !!c.byCenter,
        count: c.count,
      };
    })
    .filter((col) => {
      if (col.count >= Math.max(1, 0.15 * N)) return true;
      if (header && header.cols.some((h) => AMOUNT_ROLES.has(h.role) && overlap(h, col, 20))) return true;
      return col.x0 > descEndP90 - 1;
    })
    .sort((a, b) => a.center - b.center);

  if (!columns.length) {
    warnings.push('noColumns');
    return finish({ transactions: [], warnings, lines, pages: pages.length, accountType, currency: detectCurrency(fullText) });
  }

  const colOf = (chunk, estimated) => {
    const key = columns[0].byCenter ? (chunk.x0 + chunk.x1) / 2 : chunk.x1;
    let best = -1;
    let bestD = Infinity;
    columns.forEach((c, i) => {
      const lo = (c.byCenter ? c.center : c.x1) - (c.byCenter ? (c.x1 - c.x0) / 2 : 0);
      const d = c.byCenter ? Math.abs(key - c.center) : Math.abs(key - c.x1);
      const inside = key >= lo - tol && key <= c.x1 + tol;
      if ((inside || d <= (estimated ? tol * 4 : tol * 1.5)) && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };

  // ---- 6. Column roles: header first, then try hypotheses and keep the one that reconciles
  const headerRoles = columns.map((col) => {
    if (!header) return null;
    let best = null;
    let bestD = Infinity;
    for (const h of header.cols) {
      if (!AMOUNT_ROLES.has(h.role)) continue;
      const d = Math.abs((h.x0 + h.x1) / 2 - (col.x0 + col.x1) / 2);
      const near = overlap(h, col, 25) || d < 60;
      if (near && d < bestD) {
        best = h.role;
        bestD = d;
      }
    }
    return best;
  });

  const hyps = hypotheses(columns.length).filter((h) =>
    h.every((role, i) => !headerRoles[i] || role === headerRoles[i] || role === 'ignore')
  );
  if (!hyps.length) hyps.push(...hypotheses(columns.length));
  if (headerRoles.every(Boolean) && new Set(headerRoles).size === headerRoles.length) hyps.unshift(headerRoles);

  let best = null;
  for (const roles of uniqueHyps(hyps)) {
    const st = buildRows(roles);
    reconcile(st);
    const score = scoreOf(st, roles);
    if (!best || score > best.score) best = { st, score, roles };
  }
  const st = best.st;
  st.warnings.push(...warnings);
  return finish(st);

  // ===================================================================================
  function buildRows(roles) {
    const roleOfCol = (i) => (i >= 0 ? roles[i] : null);
    const hasBalanceCol = roles.includes('balance');
    const txs = [];
    let opening = null;
    let closing = null;
    const totals = {};
    let section = 0; // +1 credit section, -1 debit section
    let inTable = !header;
    let last = null; // last transaction
    let lastLineY = null;
    let lastPage = -1;
    let pending = null;

    // A section heading is followed closely by a table header or a transaction row.
    const nearTable = (i) => {
      for (let k = i + 1; k <= i + 3 && k < info.length; k++) {
        if (info[k].line.page !== info[i].line.page) return false;
        if (header && (header.lineIdx.has(k) || headerSignature(info[k].line) === header.signature)) return true;
        if (info[k].date && info[k].money.length) return true;
      }
      return false;
    };

    const amountsOf = (l) => {
      const vals = {};
      for (const m of l.money) {
        const role = roleOfCol(colOf(m.chunk, m.estimated));
        if (!role || role === 'ignore') continue;
        const a = parseAmount(m.chunk.text);
        if (!a) continue;
        if (vals[role]) continue; // keep the first per role
        vals[role] = a;
      }
      return vals;
    };

    const textOf = (l) =>
      l.texts
        .filter((t) => t.x0 < (columns[0].x0 - 2) || t.x0 > columns[columns.length - 1].x1 + 2 || !l.money.length)
        .map((t) => t.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    const startTx = (l, ymd, vals, inherited) => {
      const tx = {
        date: isoDate(ymd),
        valueDate: l.valueDate ? (resolveDate(l.valueDate) ? isoDate(resolveDate(l.valueDate)) : null) : null,
        description: textOf(l),
        page: l.line.page + 1,
        vals,
        section,
        flags: { dateInherited: !!inherited, yearInferred: !!ymd.yearInferred || !!ymd.yearGuessed },
        lines: [l.line.text],
      };
      txs.push(tx);
      last = tx;
      return tx;
    };

    for (let i = 0; i < info.length; i++) {
      const l = info[i];
      const text = l.line.text;
      if (l.line.page !== lastPage) {
        last = null;
        pending = null;
        lastPage = l.line.page;
        lastLineY = null;
        if (header) inTable = false;
      }

      if (header && header.lineIdx.has(i)) {
        inTable = true;
        lastLineY = l.line.y;
        continue;
      }
      if (header && header.signature && headerSignature(l.line) === header.signature) {
        inTable = true;
        lastLineY = l.line.y;
        continue;
      }

      const isOpen = kw(OPENING_RE, l);
      const isClose = kw(CLOSING_RE, l);
      if ((isOpen || isClose) && l.money.length) {
        const vals = amountsOf(l);
        const a = vals.balance || l.money.map((m) => parseAmount(m.chunk.text)).filter(Boolean).pop();
        if (a) {
          const v = balanceValue(a, accountType);
          if (isOpen && !isClose && !opening) opening = { minor: v, explicit: true, page: l.line.page + 1 };
          if (isClose && !isOpen) closing = { minor: v, explicit: true, page: l.line.page + 1 };
          if (isOpen && isClose) {
            // e.g. "Opening balance ... Closing balance ..." on one line
            const all = l.money.map((m) => parseAmount(m.chunk.text)).filter(Boolean);
            if (all.length >= 2) {
              if (!opening) opening = { minor: balanceValue(all[0], accountType), explicit: true, page: l.line.page + 1 };
              closing = { minor: balanceValue(all[all.length - 1], accountType), explicit: true, page: l.line.page + 1 };
            }
          }
        }
        last = null;
        pending = null;
        continue;
      }
      if (kw(TOTAL_RE, l)) {
        const a = l.money.map((m) => parseAmount(m.chunk.text)).filter(Boolean);
        if (a.length) {
          if (TOTAL_DEBIT_RE.test(text) && !TOTAL_CREDIT_RE.test(text)) totals.debit = a[a.length - 1].minor;
          else if (TOTAL_CREDIT_RE.test(text) && !TOTAL_DEBIT_RE.test(text)) totals.credit = a[a.length - 1].minor;
        }
        last = null;
        pending = null;
        continue;
      }

      const ymd = l.date ? resolveDate(l.date) : null;
      const vals = l.money.length ? amountsOf(l) : {};
      const hasVals = Object.keys(vals).some((k) => k !== 'balance') || (hasBalanceCol && vals.balance && Object.keys(vals).length > 1);
      const gapOk = lastLineY != null && l.line.y - lastLineY <= Math.max(2.2 * l.line.size, 2.2 * sizeMed);

      if (ymd && hasVals) {
        inTable = true;
        pending = null;
        startTx(l, ymd, vals, false);
        lastLineY = l.line.y;
        continue;
      }
      if (ymd && !l.money.length && inTable && textOf(l)) {
        // Date + description, amounts follow on a later line.
        pending = startTx(l, ymd, {}, false);
        pending.pending = true;
        lastLineY = l.line.y;
        continue;
      }
      if (!ymd && hasVals && pending && gapOk) {
        pending.vals = vals;
        pending.pending = false;
        const t = textOf(l);
        if (t) pending.description = (pending.description + ' ' + t).trim();
        pending.lines.push(text);
        pending = null;
        lastLineY = l.line.y;
        continue;
      }
      if (!ymd && hasVals && last && inTable && gapOk && textOf(l)) {
        // Same-day row printed without its date.
        const prevYmd = parseISO(last.date);
        startTx(l, prevYmd, vals, true);
        lastLineY = l.line.y;
        continue;
      }
      if (!l.money.length && !l.date) {
        const first = l.line.chunks[0];
        const startsLeft = first.x0 < descX0 - 1.5 * sizeMed;
        const words = text.split(/\s+/).length;
        if (startsLeft && words <= 8 && (SECTION_CREDIT_RE.test(text) || SECTION_DEBIT_RE.test(text)) && nearTable(i)) {
          section = sectionSign(text, accountType);
          last = null;
          pending = null;
          lastLineY = l.line.y;
          continue;
        }
        const target = pending || last;
        if (target && gapOk && first.x0 >= descX0 - 2 * sizeMed && first.x0 < columns[0].x0 - 2) {
          target.description = (target.description + ' ' + text).replace(/\s+/g, ' ').trim();
          target.lines.push(text);
          lastLineY = l.line.y;
          continue;
        }
        if (l.line.y - (lastLineY ?? -1e9) > 2.2 * sizeMed) {
          last = null;
          if (pending && !pending.vals.amount) pending = null;
        }
        continue;
      }
    }

    // Drop rows that never received amounts.
    const rows = txs.filter((t) => Object.keys(t.vals).some((k) => k !== 'balance'));

    // ---- Effects and signs ----
    const amountRows = rows.filter((r) => r.vals.amount);
    const anyMinus = amountRows.some((r) => r.vals.amount.negative);
    const anyPlus = amountRows.some((r) => r.vals.amount.plus);
    const plusConvention = anyPlus && !anyMinus;

    for (const r of rows) {
      const v = r.vals;
      r.balance = v.balance ? balanceValue(v.balance, accountType) : null;
      r.flags.signUnknown = false;
      if (v.debit || v.credit) {
        const d = v.debit ? v.debit.minor : 0;
        const c = v.credit ? v.credit.minor : 0;
        // In card statements the debit column holds charges (increase what is owed).
        r.effect = accountType === 'liability' ? d - c : c - d;
        r.signSource = 'column';
      } else if (v.amount) {
        const a = v.amount;
        if (a.crdr) {
          const isCredit = a.crdr === 'CR';
          r.effect = accountType === 'liability' ? (isCredit ? -a.minor : a.minor) : isCredit ? a.minor : -a.minor;
          r.signSource = 'crdr';
        } else if (a.negative) {
          r.effect = -a.minor;
          r.signSource = 'sign';
        } else if (a.plus) {
          r.effect = a.minor;
          r.signSource = 'sign';
        } else if (plusConvention) {
          r.effect = accountType === 'liability' ? a.minor : -a.minor;
          r.signSource = 'plusConvention';
        } else if (r.section) {
          r.effect = r.section * a.minor;
          r.signSource = 'section';
        } else if (accountType === 'liability') {
          r.effect = a.minor;
          r.signSource = 'default';
        } else {
          r.effect = -a.minor;
          r.signSource = 'unknown';
          r.flags.signUnknown = true;
        }
      } else {
        r.effect = 0;
      }
    }

    // Use the printed running balance to settle unknown signs (and to catch wrong ones).
    if (hasBalanceCol) settleSignsWithBalance(rows, opening);

    // Opening/closing inferred from running balance when not printed.
    const firstBal = rows.findIndex((r) => r.balance != null);
    if (!opening && firstBal >= 0) {
      const before = rows.slice(0, firstBal + 1).reduce((s, r) => s + r.effect, 0);
      opening = { minor: rows[firstBal].balance - before, explicit: false };
    }
    let lastBal = -1;
    for (let k = rows.length - 1; k >= 0; k--) if (rows[k].balance != null) { lastBal = k; break; }
    if (!closing && lastBal >= 0) {
      const after = rows.slice(lastBal + 1).reduce((s, r) => s + r.effect, 0);
      closing = { minor: rows[lastBal].balance + after, explicit: false };
    }

    // No balance column: if opening and closing are known, solve remaining unknown signs.
    if (!hasBalanceCol && opening && closing) {
      const unknown = rows.filter((r) => r.flags.signUnknown);
      if (unknown.length && unknown.length <= 18) {
        const known = rows.filter((r) => !r.flags.signUnknown).reduce((s, r) => s + r.effect, 0);
        const target = closing.minor - opening.minor - known;
        const sol = solveSigns(unknown.map((r) => Math.abs(r.effect)), target);
        if (sol) {
          unknown.forEach((r, k) => {
            r.effect = sol[k] * Math.abs(r.effect);
            r.flags.signUnknown = false;
            r.signSource = 'period';
          });
        }
      }
    }

    const transactions = rows.map((r, idx) => ({
      id: idx + 1,
      date: r.date,
      valueDate: r.valueDate,
      description: r.description,
      effect: r.effect,
      balance: r.balance,
      page: r.page,
      flags: r.flags,
      signSource: r.signSource,
      source: r.lines.join('\n'),
    }));

    const dates = transactions.map((t) => t.date).sort();
    return {
      transactions,
      opening,
      closing,
      totals: totals.debit != null || totals.credit != null ? totals : null,
      accountType,
      currency: detectCurrency(fullText),
      dateOrder,
      period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      columns: columns.map((c, i) => ({ role: roles[i], x0: c.x0, x1: c.x1, count: c.count })),
      headerFound: !!header,
      warnings: [],
      pages: pages.length,
      lines,
    };
  }
}

// =====================================================================================

function analyzeLine(line) {
  const chunks = line.chunks.map((c) => ({ ...c }));
  let date = null;
  let valueDate = null;
  let dateX1 = null;
  const maxIdx = Math.min(2, chunks.length);
  for (let i = 0; i < maxIdx; i++) {
    if (i === 1 && !/^[#№]?\d{1,6}$/.test(chunks[0].text)) break; // only skip a row number
    const d = matchDateAtStart(chunks[i].text);
    if (!d) continue;
    if (d.kind === 'num' && d.y == null && looksLikeMoney(chunks[i].text) && chunks.length <= 1) continue;
    date = d;
    dateX1 = chunks[i].x0 + (chunks[i].x1 - chunks[i].x0) * (d.raw.length / Math.max(1, chunks[i].text.length));
    let rest = d.rest.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, '');
    const d2 = rest ? matchDateAtStart(rest) : null;
    if (d2 && (d2.rest === '' || /^\S/.test(d2.rest))) {
      valueDate = d2;
      rest = d2.rest;
    }
    const restX0 = chunks[i].x1 - (chunks[i].x1 - chunks[i].x0) * (rest.length / Math.max(1, chunks[i].text.length));
    chunks[i] = { ...chunks[i], text: rest, x0: rest ? restX0 : chunks[i].x1 };
    if (!valueDate && chunks[i + 1]) {
      const d3 = matchDateAtStart(chunks[i + 1].text);
      if (d3 && !d3.rest) {
        valueDate = d3;
        chunks[i + 1] = { ...chunks[i + 1], text: '' };
      }
    }
    break;
  }

  const money = [];
  const texts = [];
  for (const c of chunks) {
    if (!c.text) continue;
    if (date && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(c.text)) continue; // time of day
    if (looksLikeMoney(c.text)) money.push({ chunk: c, estimated: false });
    else texts.push(c);
  }
  // Amounts glued to the description ("COFFEE SHOP 12.50"): split them off the last text chunk.
  const lastText = texts[texts.length - 1];
  const lastChunk = chunks.filter((c) => c.text).pop();
  if (lastText && lastChunk === lastText && /[^\d\s.,\-()+]/.test(lastText.text)) {
    const sp = splitTrailingAmounts(lastText.text);
    if (sp) {
      const total = lastText.text.length;
      const cw = (lastText.x1 - lastText.x0) / Math.max(1, total);
      let pos = lastText.text.length;
      const tailChunks = [];
      for (let k = sp.tails.length - 1; k >= 0; k--) {
        const idx = lastText.text.lastIndexOf(sp.tails[k], pos);
        const start = idx >= 0 ? idx : pos - sp.tails[k].length;
        tailChunks.unshift({ text: sp.tails[k], x0: lastText.x0 + start * cw, x1: lastText.x0 + (start + sp.tails[k].length) * cw });
        pos = start;
      }
      lastText.text = sp.head;
      lastText.x1 = lastText.x0 + sp.head.length * cw;
      lastText.estimated = true;
      for (const t of tailChunks) money.push({ chunk: t, estimated: true });
    }
  }
  return { line, date, valueDate, dateX1, money, texts };
}

// Keyword test that ignores keywords buried inside a transaction description
// (a shop called "TOTAL WINE" is not a total line).
function kw(re, l) {
  if (!l.date) return re.test(l.line.text);
  const desc = l.texts.map((t) => t.text).join(' ');
  const m = re.exec(desc);
  return !!m && m.index <= 3;
}

function findHeader(lines, info, firstCand) {
  const firstIdx = info.indexOf(firstCand);
  const scan = (from, to) => {
    for (let i = from; i < to; i++) {
      const l = lines[i];
      if (info[i].money.length || info[i].date) continue;
      const rolesOf = (ln) => new Set(ln.chunks.map((c) => headerRoleOf(c.text)).filter(Boolean));
      let cols = l.chunks.map((c) => ({ role: headerRoleOf(c.text), x0: c.x0, x1: c.x1, text: c.text })).filter((c) => c.role);
      const roles = new Set(cols.map((c) => c.role));
      let idx = new Set([i]);
      // Two-line headers ("Money" / "out"): merge with the next line if close
      // and neither line is a complete header on its own.
      const next = lines[i + 1];
      if (
        roles.size < 2 &&
        next &&
        next.page === l.page &&
        next.y - l.y < 1.8 * l.size &&
        !info[i + 1].money.length &&
        !info[i + 1].date &&
        rolesOf(next).size < 2
      ) {
        const merged = mergeHeaderLines(l, lines[i + 1]);
        const mc = merged.map((c) => ({ role: headerRoleOf(c.text), x0: c.x0, x1: c.x1, text: c.text })).filter((c) => c.role);
        if (new Set(mc.map((c) => c.role)).size >= 2) {
          cols = mc;
          idx = new Set([i, i + 1]);
        }
      }
      const rs = new Set(cols.map((c) => c.role));
      const hasAmountRole = [...rs].some((r) => AMOUNT_ROLES.has(r));
      if (rs.size >= 2 && hasAmountRole && cols.length >= 2) {
        return { cols, lineIdx: idx, signature: headerSignature(l) };
      }
    }
    return null;
  };
  return scan(Math.max(0, firstIdx - 40), firstIdx + 1) || scan(0, Math.min(lines.length, firstIdx + 200));
}

function mergeHeaderLines(a, b) {
  const out = a.chunks.map((c) => ({ ...c }));
  for (const c of b.chunks) {
    const o = out.find((x) => overlap(x, c, 4));
    if (o) {
      o.text = o.text + ' ' + c.text;
      o.x0 = Math.min(o.x0, c.x0);
      o.x1 = Math.max(o.x1, c.x1);
    } else out.push({ ...c });
  }
  return out.sort((x, y) => x.x0 - y.x0);
}

function headerSignature(line) {
  return line.chunks.map((c) => c.text.toLowerCase()).join('|');
}

function overlap(a, b, pad = 0) {
  return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1;
}

function hypotheses(k) {
  const H = [];
  if (k === 1) H.push(['amount']);
  if (k === 2) H.push(['amount', 'balance'], ['debit', 'credit'], ['credit', 'debit']);
  if (k === 3) H.push(['debit', 'credit', 'balance'], ['credit', 'debit', 'balance'], ['ignore', 'amount', 'balance'], ['amount', 'ignore', 'balance']);
  if (k >= 4) {
    const pad = (n) => Array(n).fill('ignore');
    H.push([...pad(k - 3), 'debit', 'credit', 'balance'], [...pad(k - 3), 'credit', 'debit', 'balance'], [...pad(k - 2), 'amount', 'balance']);
  }
  return H;
}

function uniqueHyps(hs) {
  const seen = new Set();
  return hs.filter((h) => {
    const k = h.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function scoreOf(st, roles) {
  let s = 0;
  for (const c of st.checks) {
    if (c.id === 'running') s += c.ok * 3 - (c.total - c.ok) * 3;
    if (c.id === 'period') s += c.status === 'ok' ? 12 : -6;
    if (c.id === 'totalDebit' || c.id === 'totalCredit') s += c.status === 'ok' ? 4 : -2;
  }
  s += st.transactions.length * 0.5;
  s -= st.transactions.filter((t) => t.flags.signUnknown).length * 0.5;
  // debit/credit columns: each row should fill exactly one of them
  if (roles.includes('debit') && roles.includes('credit')) {
    // already reflected in effects; small preference for the conventional order
    if (roles.indexOf('debit') < roles.indexOf('credit')) s += 0.25;
  }
  return s;
}

function balanceValue(a, accountType) {
  let v = a.negative ? -a.minor : a.minor;
  if (a.crdr) {
    // Asset: "DR" balance = overdrawn. Card: "CR" balance = you are in credit.
    if (accountType === 'liability') v = a.crdr === 'CR' ? -a.minor : a.minor;
    else v = a.crdr === 'DR' ? -a.minor : a.minor;
  }
  return v;
}

function sectionSign(text, accountType) {
  const credit = SECTION_CREDIT_RE.test(text);
  const debit = SECTION_DEBIT_RE.test(text);
  if (accountType === 'liability') {
    if (/payment|credit|refund|зачисл|погашен/i.test(text)) return -1;
    return debit || /purchase|fee|interest|charge|покупк/i.test(text) ? 1 : 0;
  }
  if (credit) return 1;
  if (debit) return -1;
  return 0;
}

function settleSignsWithBalance(rows, opening) {
  // Walk segments that end at a row with a printed balance.
  let prev = opening ? opening.minor : null;
  let seg = [];
  for (const r of rows) {
    seg.push(r);
    if (r.balance == null) continue;
    if (prev != null) {
      const delta = r.balance - prev;
      const flexible = seg.filter((x) => x.signSource !== 'column');
      const fixedSum = seg.filter((x) => x.signSource === 'column').reduce((s, x) => s + x.effect, 0);
      const cur = seg.reduce((s, x) => s + x.effect, 0);
      if (cur !== delta && flexible.length && flexible.length <= 14) {
        const sol = solveSigns(flexible.map((x) => Math.abs(x.effect)), delta - fixedSum);
        if (sol) {
          flexible.forEach((x, k) => {
            const nv = sol[k] * Math.abs(x.effect);
            if (nv !== x.effect) x.signSource = 'balance';
            x.effect = nv;
            x.flags.signUnknown = false;
          });
        }
      } else if (cur === delta) {
        for (const x of seg) if (x.flags.signUnknown) { x.flags.signUnknown = false; x.signSource = 'balance'; }
      }
    } else if (seg.length === 1 && r.flags.signUnknown) {
      // First row and no opening balance: cannot check yet; keep the guess.
    }
    prev = r.balance;
    seg = [];
  }
}

/** Find signs s_i in {+1,-1} with sum(s_i * a_i) = target. Unique solution or null. */
function solveSigns(abs, target) {
  const n = abs.length;
  if (n === 0) return target === 0 ? [] : null;
  const total = abs.reduce((s, x) => s + x, 0);
  // sum(+) - sum(-) = target  =>  sum(+) = (total + target) / 2
  const want = total + target;
  if (want % 2 !== 0 || want < 0) return null;
  const pos = want / 2;
  let found = null;
  let count = 0;
  const lim = 1 << n;
  for (let mask = 0; mask < lim; mask++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += abs[i];
    if (s === pos) {
      count++;
      if (!found) found = mask;
      if (count > 1) {
        // Ambiguous unless all solutions are equivalent (equal amounts swapped).
        break;
      }
    }
  }
  if (found == null) return null;
  if (count > 1) {
    // Accept if the ambiguity only swaps equal amounts.
    const sorted = [...abs].sort((a, b) => a - b);
    const hasDup = sorted.some((v, i) => i && v === sorted[i - 1]);
    if (!hasDup) return null;
  }
  return abs.map((_, i) => (found & (1 << i) ? 1 : -1));
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function finish(st) {
  st.transactions = st.transactions || [];
  st.warnings = st.warnings || [];
  if (!st.checks) reconcile(st);
  delete st.lines;
  return st;
}
