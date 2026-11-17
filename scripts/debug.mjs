// Usage: node scripts/debug.mjs file.pdf  — prints what the parser sees.
import { parseFile, cashflow } from '../test/helpers.mjs';
import { formatMinor } from '../src/core/amount.js';

const file = process.argv[2];
const st = await parseFile(file);
console.log('status:', st.status, '| type:', st.accountType, '| currency:', st.currency, '| order:', st.dateOrder, '| header:', st.headerFound);
console.log('columns:', JSON.stringify(st.columns));
console.log('opening:', st.opening, 'closing:', st.closing, 'totals:', st.totals);
console.log('checks:', JSON.stringify(st.checks));
console.log('warnings:', st.warnings);
for (const t of st.transactions) {
  const f = Object.entries(t.flags).filter(([, v]) => v).map(([k]) => k).join(',');
  console.log(
    String(t.id).padStart(3),
    t.date,
    formatMinor(cashflow(st, t)).padStart(11),
    (t.balance == null ? '' : formatMinor(t.balance)).padStart(11),
    t.balanceOk === false ? 'BAD' : t.balanceOk ? 'ok ' : '   ',
    (t.signSource || '').padEnd(14),
    t.description.slice(0, 60),
    f
  );
}
