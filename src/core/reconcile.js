// Arithmetic checks that prove (or disprove) that the extracted rows are complete
// and correct. All money values are integers in minor units (cents).
//
// Row fields used: effect (change of the printed statement balance), balance
// (printed running balance or null), debit/credit (absolute, optional).

export function reconcile(st) {
  for (const r of st.transactions) if (r.excluded) r.balanceOk = null;
  const rows = st.transactions.filter((r) => !r.excluded);
  const checks = [];

  // 1. Running balance, row by row. Re-anchor after each printed balance so a
  //    single bad row is reported once instead of breaking every row after it.
  let prev = st.opening ? st.opening.minor : null;
  let withBalance = 0;
  let okRows = 0;
  let firstBad = -1;
  rows.forEach((r, i) => {
    r.balanceOk = null;
    if (prev != null) prev += r.effect;
    if (r.balance != null) {
      withBalance++;
      if (prev == null) {
        r.balanceOk = null; // nothing to compare the first row with
      } else if (prev === r.balance) {
        r.balanceOk = true;
        okRows++;
      } else {
        r.balanceOk = false;
        r.balanceExpected = prev;
        r.balanceIndex = i;
        if (firstBad < 0) firstBad = i;
      }
      prev = r.balance;
    }
  });
  const comparable = rows.filter((r) => r.balanceOk !== null).length;
  if (withBalance > 0) {
    checks.push({
      id: 'running',
      status: comparable === 0 ? 'na' : okRows === comparable ? 'ok' : 'fail',
      ok: okRows,
      total: comparable,
      firstBad,
      firstBadId: firstBad >= 0 ? rows[firstBad].id : null,
      badIds: rows.filter((r) => r.balanceOk === false).map((r) => r.id),
    });
  }

  // 2. Statement period: opening + sum(rows) = closing.
  const sum = rows.reduce((s, r) => s + r.effect, 0);
  if (st.opening && st.closing) {
    const expected = st.opening.minor + sum;
    checks.push({
      id: 'period',
      status: expected === st.closing.minor ? 'ok' : 'fail',
      opening: st.opening.minor,
      closing: st.closing.minor,
      sum,
      expected,
      diff: st.closing.minor - expected,
      strong: !!(st.opening.explicit || st.closing.explicit),
    });
  }

  // 3. Printed totals (Total debits / Total credits), if the statement has them.
  if (st.totals) {
    const debits = rows.reduce((s, r) => s + (r.effect < 0 ? -r.effect : 0), 0);
    const credits = rows.reduce((s, r) => s + (r.effect > 0 ? r.effect : 0), 0);
    const liab = st.accountType === 'liability';
    // For a card, "debits" printed on the statement are charges (positive effect).
    const out = liab ? credits : debits;
    const inn = liab ? debits : credits;
    if (st.totals.debit != null) {
      checks.push({ id: 'totalDebit', status: out === st.totals.debit ? 'ok' : 'fail', expected: st.totals.debit, actual: out, diff: st.totals.debit - out });
    }
    if (st.totals.credit != null) {
      checks.push({ id: 'totalCredit', status: inn === st.totals.credit ? 'ok' : 'fail', expected: st.totals.credit, actual: inn, diff: st.totals.credit - inn });
    }
  }

  const unknownSigns = rows.filter((r) => r.flags && r.flags.signUnknown).length;
  const failing = checks.filter((c) => c.status === 'fail');
  const passing = checks.filter((c) => c.status === 'ok');
  const strongPass =
    passing.some((c) => c.id === 'period' && c.strong) ||
    passing.some((c) => c.id === 'running' && c.total >= Math.max(1, Math.ceil(rows.length * 0.6)));

  let status;
  if (!rows.length) status = 'empty';
  else if (failing.length) status = 'mismatch';
  else if (strongPass && unknownSigns === 0) status = 'verified';
  else status = 'unverified';

  st.checks = checks;
  st.status = status;
  st.sum = sum;
  return st;
}
