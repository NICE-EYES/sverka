import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, looksLikeMoney, splitTrailingAmounts, formatMinor } from '../src/core/amount.js';
import { matchDateAtStart, resolveOrder, inferYear } from '../src/core/date.js';

test('amount formats', () => {
  const cases = [
    ['1,234.56', 123456, false],
    ['1.234,56', 123456, false],
    ['1 234,56', 123456, false],
    ['1 234,56', 123456, false],
    ["1'234.56", 123456, false],
    ['(1,234.56)', 123456, true],
    ['1,234.56-', 123456, true],
    ['-1234,56', 123456, true],
    ['−1 234,56', 123456, true],
    ['$1,234.56', 123456, false],
    ['-$12.50', 1250, true],
    ['1 234,56 ₽', 123456, false],
    ['EUR 12,50', 1250, false],
    ['0.99', 99, false],
  ];
  for (const [raw, minor, neg] of cases) {
    const a = parseAmount(raw);
    assert.ok(a, raw);
    assert.equal(a.minor, minor, raw);
    assert.equal(a.negative, neg, raw);
  }
  assert.equal(parseAmount('+5 000,00').plus, true);
  assert.equal(parseAmount('500.00 CR').crdr, 'CR');
  assert.equal(parseAmount('45.00 Dr').crdr, 'DR');
  for (const bad of ['12345', 'ABC', '2026-03-12', '12.03.2026', '1,234']) assert.equal(looksLikeMoney(bad), false, bad);
});

test('split trailing amounts', () => {
  assert.deepEqual(splitTrailingAmounts('COFFEE SHOP 12.50 1,234.56'), { head: 'COFFEE SHOP', tails: ['12.50', '1,234.56'] });
  assert.deepEqual(splitTrailingAmounts('PAYMENT THANK YOU 500.00 CR'), { head: 'PAYMENT THANK YOU', tails: ['500.00 CR'] });
  assert.equal(splitTrailingAmounts('NO AMOUNT HERE'), null);
});

test('format minor', () => {
  assert.equal(formatMinor(-123456), '-1234.56');
  assert.equal(formatMinor(123456, 100, { decimal: ',', group: ' ' }), '1 234,56');
  assert.equal(formatMinor(5), '0.05');
});

test('dates', () => {
  assert.deepEqual(pick(matchDateAtStart('12/03/2026 COFFEE')), { a: 12, b: 3, y: 2026, rest: 'COFFEE' });
  assert.deepEqual(pick(matchDateAtStart('03.12 Rest')), { a: 3, b: 12, y: null, rest: 'Rest' });
  const t = matchDateAtStart('12 марта 2026 г. Кафе');
  assert.equal(t.m, 3);
  assert.equal(t.d, 12);
  assert.equal(t.y, 2026);
  assert.equal(t.rest, 'Кафе');
  const u = matchDateAtStart('Mar 5, 2026 Payment');
  assert.equal(u.m, 3);
  assert.equal(u.d, 5);
  assert.equal(matchDateAtStart('2026-03-12').m, 3);
  assert.equal(matchDateAtStart('12MAR26 X').y, 2026);
  assert.equal(matchDateAtStart('12.50'), null);
  assert.equal(matchDateAtStart('ACME 12/03'), null);
});

test('day/month order', () => {
  assert.equal(resolveOrder([{ a: 25, b: 3 }]), 'dmy');
  assert.equal(resolveOrder([{ a: 3, b: 25 }]), 'mdy');
  // ambiguous but chronological as MDY
  assert.equal(resolveOrder([{ a: 3, b: 1 }, { a: 3, b: 5 }, { a: 4, b: 2 }], 'dmy'), 'mdy');
});

test('year inference across new year', () => {
  const end = { y: 2026, m: 1, d: 9 };
  assert.equal(inferYear({ y: null, m: 12, d: 20 }, end).y, 2025);
  assert.equal(inferYear({ y: null, m: 1, d: 5 }, end).y, 2026);
});

function pick(d) {
  return { a: d.a, b: d.b, y: d.y, rest: d.rest };
}
