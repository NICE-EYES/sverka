import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, parseFile, cashflow, norm } from './helpers.mjs';

const names = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

for (const name of names) {
  test(`fixture ${name}`, async () => {
    const truth = JSON.parse(fs.readFileSync(path.join(FIXTURES, name + '.json'), 'utf8'));
    const st = await parseFile(path.join(FIXTURES, name + '.pdf'));

    assert.equal(st.transactions.length, truth.transactions.length, 'row count');
    truth.transactions.forEach((t, i) => {
      const got = st.transactions[i];
      assert.equal(got.date, t.date, `row ${i + 1} date`);
      if (truth.expectMismatchRow !== i) assert.equal(cashflow(st, got), t.amount, `row ${i + 1} amount`);
      assert.ok(norm(got.description).includes(norm(t.description)), `row ${i + 1} description: "${got.description}" vs "${t.description}"`);
    });
    assert.equal(st.opening.minor, truth.opening, 'opening balance');
    assert.equal(st.closing.minor, truth.closing, 'closing balance');
    if (truth.accountType) assert.equal(st.accountType, truth.accountType);

    if (truth.expectMismatchRow != null) {
      assert.equal(st.status, 'mismatch');
      const running = st.checks.find((c) => c.id === 'running');
      assert.equal(running.firstBad, truth.expectMismatchRow, 'first broken row');
    } else {
      assert.equal(st.status, 'verified', JSON.stringify(st.checks));
    }
  });
}
