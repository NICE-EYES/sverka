// Generates synthetic bank statements in different layouts plus the ground truth
// for each one (test/fixtures/<name>.pdf + <name>.json). All data is invented.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('test/fixtures');
fs.mkdirSync(OUT, { recursive: true });
const SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

// ---------- deterministic data ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const MERCHANTS_EN = [
  'POS PURCHASE GREENLEAF GROCERY', 'CARD 4417 COFFEE CORNER', 'ONLINE TRANSFER TO SAVINGS', 'ACH DEBIT CITY WATER UTILITY',
  'DEBIT CARD FUEL STATION 21', 'BOOKSHOP ON MAIN ST', 'PHARMACY PLUS 0042', 'STREAMING SUBSCRIPTION', 'HARDWARE DEPOT',
  'RESTAURANT LA PIAZZA', 'PARKING GARAGE CENTRAL', 'MOBILE PHONE BILL', 'GYM MEMBERSHIP', 'INSURANCE PREMIUM',
];
const INCOME_EN = ['PAYROLL ACME TOOLS INC', 'TRANSFER FROM J SMITH', 'INTEREST PAYMENT', 'REFUND HARDWARE DEPOT'];
const MERCHANTS_RU = ['Супермаркеты. Продукты у дома', 'Кафе Ромашка', 'АЗС Северная', 'Аптека Здоровье', 'Перевод Ивану П.', 'Связь. Мобильный оператор', 'Книжный магазин', 'Такси'];
const INCOME_RU = ['Зарплата ООО Ромашка', 'Перевод от Анны С.', 'Возврат покупки'];
const MERCHANTS_DE = ['Kartenzahlung Bäckerei Sonnenschein', 'Lastschrift Stadtwerke Strom', 'Überweisung Miete März', 'Kartenzahlung Supermarkt Nord', 'Lastschrift Mobilfunk', 'Kartenzahlung Tankstelle'];
const INCOME_DE = ['Gehalt Muster GmbH', 'Gutschrift Erstattung', 'Überweisung von Max Mustermann'];

function makeRows({ seed, n, year, month, startDay = 1, incomeEvery = 6, merchants, income, multiline = 0, maxAmt = 25000 }) {
  const r = rng(seed);
  const rows = [];
  let day = startDay;
  for (let i = 0; i < n; i++) {
    if (r() < 0.55) day = Math.min(28, day + 1);
    const isIncome = i % incomeEvery === incomeEvery - 1;
    const desc = isIncome ? income[Math.floor(r() * income.length)] : merchants[Math.floor(r() * merchants.length)];
    let cents = isIncome ? Math.round(50000 + r() * 300000) : Math.round(150 + r() * maxAmt);
    if (i === 3) cents = 123456; // ensure thousands separators appear
    const extra = multiline && i % multiline === 1 ? ['REF ' + (100000 + Math.floor(r() * 899999)) + ' AUTH CODE ' + Math.floor(r() * 9999)] : [];
    rows.push({ y: year, m: month, d: day, desc, extra, amount: isIncome ? cents : -cents });
  }
  return rows;
}

const pad2 = (n) => String(n).padStart(2, '0');
function fmt(minor, { dec = '.', grp = ',', sign = false, plus = false } = {}) {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, grp);
  const s = int + dec + pad2(abs % 100);
  if (sign && neg) return '-' + s;
  if (plus && !neg) return '+' + s;
  return s;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (r) => `${r.y}-${pad2(r.m)}-${pad2(r.d)}`;

function save(name, doc, truth) {
  return new Promise((resolve) => {
    const file = path.join(OUT, name + '.pdf');
    const ws = fs.createWriteStream(file);
    doc.pipe(ws);
    doc.end();
    ws.on('finish', () => {
      fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(truth, null, 2));
      resolve();
    });
  });
}

function right(doc, text, xRight, y) {
  const w = doc.widthOfString(text);
  doc.text(text, xRight - w, y, { lineBreak: false });
}

function truthOf(rows, opening, extra = {}) {
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return {
    opening,
    closing: opening + sum,
    transactions: rows.map((r) => ({ date: iso(r), amount: r.amount, description: [r.desc, ...r.extra].join(' ') })),
    ...extra,
  };
}

// ---------- 1. US checking: Withdrawals | Deposits | Balance, MM/DD, 2 pages ----------
async function usChecking(name = 'us_checking', corrupt = false) {
  const rows = makeRows({ seed: 7, n: 46, year: 2026, month: 3, merchants: MERCHANTS_EN, income: INCOME_EN, multiline: 5 });
  const opening = 421055;
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  doc.font('Helvetica-Bold').fontSize(14).text('First Example Bank', 40, 40);
  doc.font('Helvetica').fontSize(9);
  doc.text('Everyday Checking   Account number: XXXXXX4417', 40, 62);
  doc.text('Statement period: March 1, 2026 through March 31, 2026', 40, 75);
  doc.text('Beginning balance on March 1, 2026', 40, 100);
  right(doc, '$' + fmt(opening), 560, 100);
  let y = 130;
  const headerRow = () => {
    doc.font('Helvetica-Bold');
    doc.text('Date', 40, y, { lineBreak: false });
    doc.text('Description', 90, y, { lineBreak: false });
    right(doc, 'Withdrawals', 410, y);
    right(doc, 'Deposits', 480, y);
    right(doc, 'Balance', 560, y);
    doc.font('Helvetica');
    y += 16;
  };
  headerRow();
  let bal = opening;
  let page = 1;
  rows.forEach((r, i) => {
    if (y > 700) {
      doc.text(`Page ${page} of 2`, 500, 750, { lineBreak: false });
      doc.addPage();
      page++;
      y = 50;
      headerRow();
    }
    bal += r.amount;
    const printed = corrupt && i === 17 ? r.amount - 1000 : r.amount;
    doc.text(`${pad2(r.m)}/${pad2(r.d)}`, 40, y, { lineBreak: false });
    doc.text(r.desc, 90, y, { lineBreak: false });
    if (printed < 0) right(doc, fmt(-printed), 410, y);
    else right(doc, fmt(printed), 480, y);
    right(doc, fmt(bal, { sign: true }), 560, y);
    y += 13;
    for (const e of r.extra) {
      doc.text(e, 90, y, { lineBreak: false });
      y += 11;
    }
    y += 2;
  });
  y += 10;
  doc.text('Ending balance on March 31, 2026', 40, y, { lineBreak: false });
  right(doc, '$' + fmt(bal, { sign: true }), 560, y);
  doc.text(`Page ${page} of 2`, 500, 750, { lineBreak: false });
  const truth = truthOf(rows, opening, corrupt ? { expectMismatchRow: 17 } : {});
  await save(name, doc, truth);
}

// ---------- 2. UK: Date | Description | Amount (signed) | Balance, "12 Mar 2026", b/f c/f ----------
async function ukSigned() {
  const rows = makeRows({ seed: 11, n: 40, year: 2026, month: 2, merchants: MERCHANTS_EN, income: INCOME_EN });
  const opening = 98765;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.font('Helvetica').fontSize(9);
  doc.font('Helvetica-Bold').fontSize(13).text('Example Building Society', 40, 40);
  doc.font('Helvetica').fontSize(9).text('Current account statement 1 February 2026 to 28 February 2026', 40, 60);
  let y = 95;
  let bal = opening;
  const header = () => {
    doc.font('Helvetica-Bold');
    doc.text('Date', 40, y, { lineBreak: false });
    doc.text('Description', 110, y, { lineBreak: false });
    right(doc, 'Amount', 450, y);
    right(doc, 'Balance', 545, y);
    doc.font('Helvetica');
    y += 15;
  };
  header();
  doc.text('01 Feb 2026', 40, y, { lineBreak: false });
  doc.text('BALANCE BROUGHT FORWARD', 110, y, { lineBreak: false });
  right(doc, fmt(bal, { sign: true }), 545, y);
  y += 13;
  rows.forEach((r, i) => {
    if (i === 24) {
      doc.text('28 Feb 2026', 40, y, { lineBreak: false });
      doc.text('BALANCE CARRIED FORWARD', 110, y, { lineBreak: false });
      right(doc, fmt(bal, { sign: true }), 545, y);
      doc.addPage();
      y = 50;
      header();
      doc.text('28 Feb 2026', 40, y, { lineBreak: false });
      doc.text('BALANCE BROUGHT FORWARD', 110, y, { lineBreak: false });
      right(doc, fmt(bal, { sign: true }), 545, y);
      y += 13;
    }
    bal += r.amount;
    doc.text(`${pad2(r.d)} ${MON[r.m - 1]} ${r.y}`, 40, y, { lineBreak: false });
    doc.text(r.desc, 110, y, { lineBreak: false });
    right(doc, fmt(r.amount, { sign: true }), 450, y);
    right(doc, fmt(bal, { sign: true }), 545, y);
    y += 13;
  });
  doc.text('28 Feb 2026', 40, y, { lineBreak: false });
  doc.text('CLOSING BALANCE', 110, y, { lineBreak: false });
  right(doc, fmt(bal, { sign: true }), 545, y);
  await save('uk_signed', doc, truthOf(rows, opening));
}

// ---------- 3. Germany: Buchungstag | Valuta | Verwendungszweck | Soll | Haben, no balance ----------
async function deSollHaben() {
  const rows = makeRows({ seed: 23, n: 22, year: 2026, month: 3, merchants: MERCHANTS_DE, income: INCOME_DE, multiline: 3, incomeEvery: 5 });
  const opening = 523410;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.font(SANS).fontSize(9);
  doc.fontSize(13).text('Beispielbank eG', 40, 40);
  doc.fontSize(9).text('Kontoauszug Nr. 3/2026   IBAN DE00 0000 0000 0000 0000 00', 40, 60);
  doc.text('Alter Kontostand vom 28.02.2026', 40, 85, { lineBreak: false });
  right(doc, fmt(opening, { dec: ',', grp: '.' }) + ' EUR', 555, 85);
  let y = 110;
  doc.text('Buchungstag', 40, y, { lineBreak: false });
  doc.text('Valuta', 105, y, { lineBreak: false });
  doc.text('Verwendungszweck', 160, y, { lineBreak: false });
  right(doc, 'Soll', 470, y);
  right(doc, 'Haben', 555, y);
  y += 16;
  for (const r of rows) {
    const d = `${pad2(r.d)}.${pad2(r.m)}.${r.y}`;
    doc.text(d, 40, y, { lineBreak: false });
    doc.text(d, 105, y, { lineBreak: false });
    doc.text(r.desc, 160, y, { lineBreak: false });
    if (r.amount < 0) right(doc, fmt(-r.amount, { dec: ',', grp: '.' }), 470, y);
    else right(doc, fmt(r.amount, { dec: ',', grp: '.' }), 555, y);
    y += 12;
    for (const e of r.extra) {
      doc.text(e, 160, y, { lineBreak: false });
      y += 11;
    }
    y += 3;
  }
  const closing = opening + rows.reduce((s, r) => s + r.amount, 0);
  y += 8;
  doc.text('Neuer Kontostand vom 31.03.2026', 40, y, { lineBreak: false });
  right(doc, fmt(closing, { dec: ',', grp: '.' }) + ' EUR', 555, y);
  await save('de_soll_haben', doc, truthOf(rows, opening));
}

// ---------- 4. Russia: Дата | Описание | Сумма (+income, unsigned expense) | Остаток ----------
async function ruCard() {
  const rows = makeRows({ seed: 31, n: 30, year: 2026, month: 4, merchants: MERCHANTS_RU, income: INCOME_RU, incomeEvery: 7, maxAmt: 450000 });
  const opening = 8500000;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.font(SANS).fontSize(9);
  doc.fontSize(13).text('Пример Банк', 40, 40);
  doc.fontSize(9).text('Выписка по счёту дебетовой карты за период 01.04.2026 — 30.04.2026', 40, 60);
  doc.text('Остаток на начало периода', 40, 85, { lineBreak: false });
  right(doc, fmt(opening, { dec: ',', grp: ' ' }) + ' ₽', 555, 85);
  let y = 112;
  doc.text('Дата операции', 40, y, { lineBreak: false });
  doc.text('Описание', 140, y, { lineBreak: false });
  right(doc, 'Сумма', 460, y);
  right(doc, 'Остаток', 555, y);
  y += 16;
  let bal = opening;
  rows.forEach((r) => {
    bal += r.amount;
    doc.text(`${pad2(r.d)}.${pad2(r.m)}.${r.y}`, 40, y, { lineBreak: false });
    doc.text(`${pad2(9 + (r.d % 12))}:${pad2((r.d * 7) % 60)}`, 95, y, { lineBreak: false });
    doc.text(r.desc, 140, y, { lineBreak: false });
    right(doc, r.amount > 0 ? fmt(r.amount, { dec: ',', grp: ' ', plus: true }) : fmt(-r.amount, { dec: ',', grp: ' ' }), 460, y);
    right(doc, fmt(bal, { dec: ',', grp: ' ', sign: true }), 555, y);
    y += 15;
  });
  y += 8;
  doc.text('Остаток на конец периода', 40, y, { lineBreak: false });
  right(doc, fmt(bal, { dec: ',', grp: ' ', sign: true }) + ' ₽', 555, y);
  await save('ru_card', doc, truthOf(rows, opening));
}

// ---------- 5. Credit card: single Amount column, payments marked CR ----------
async function cardCrDr() {
  const r = rng(41);
  const rows = [];
  let day = 2;
  for (let i = 0; i < 18; i++) {
    day = Math.min(28, day + (r() < 0.6 ? 1 : 0));
    const pay = i === 6 || i === 14;
    const cents = pay ? 50000 : Math.round(500 + r() * 15000);
    rows.push({ y: 2026, m: 5, d: day, desc: pay ? 'PAYMENT - THANK YOU' : MERCHANTS_EN[Math.floor(r() * MERCHANTS_EN.length)], extra: [], amount: pay ? cents : -cents });
  }
  const prevOwed = 125000;
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  doc.font('Helvetica').fontSize(9);
  doc.font('Helvetica-Bold').fontSize(13).text('Example Rewards Credit Card', 40, 40);
  doc.font('Helvetica').fontSize(9);
  doc.text('Statement closing date 05/31/2026     Payment due date 06/25/2026', 40, 60);
  doc.text('Previous Balance', 40, 85, { lineBreak: false });
  right(doc, '$' + fmt(prevOwed), 300, 85);
  const charges = rows.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  const payments = rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const newOwed = prevOwed + charges - payments;
  doc.text('New Balance', 40, 98, { lineBreak: false });
  right(doc, '$' + fmt(newOwed), 300, 98);
  doc.text('Minimum Payment Due', 40, 111, { lineBreak: false });
  right(doc, '$35.00', 300, 111);
  let y = 140;
  doc.font('Helvetica-Bold');
  doc.text('Trans Date', 40, y, { lineBreak: false });
  doc.text('Description', 120, y, { lineBreak: false });
  right(doc, 'Amount', 520, y);
  doc.font('Helvetica');
  y += 15;
  for (const x of rows) {
    doc.text(`${MON[x.m - 1]} ${pad2(x.d)}`, 40, y, { lineBreak: false });
    doc.text(x.desc, 120, y, { lineBreak: false });
    right(doc, x.amount > 0 ? fmt(x.amount) + ' CR' : fmt(-x.amount), 520, y);
    y += 13;
  }
  // Truth uses the cardholder's cash-flow view: charges negative, payments positive.
  await save('card_crdr', doc, {
    accountType: 'liability',
    opening: prevOwed,
    closing: newOwed,
    transactions: rows.map((x) => ({ date: iso(x), amount: x.amount, description: x.desc })),
  });
}

// ---------- 6. Monospace: each row is ONE text string padded with spaces ----------
async function monoLines() {
  const rows = makeRows({ seed: 53, n: 26, year: 2025, month: 12, startDay: 18, merchants: MERCHANTS_EN, income: INCOME_EN });
  // span the year boundary: last rows in January
  rows.forEach((x, i) => {
    if (i >= 18) {
      x.y = 2026;
      x.m = 1;
      x.d = Math.min(9, i - 17);
    }
  });
  const opening = 300000;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.font('Courier').fontSize(8.5);
  const W = (s, n) => (s.length > n ? s.slice(0, n) : s.padEnd(n));
  const R = (s, n) => s.padStart(n);
  let y = 50;
  const line = (s) => {
    doc.text(s, 40, y, { lineBreak: false });
    y += 11;
  };
  line('EXAMPLE CREDIT UNION                          STATEMENT 18/12/2025 - 09/01/2026');
  line('');
  line(W('OPENING BALANCE', 62) + R(fmt(opening), 14));
  line(W('DATE      DESCRIPTION', 40) + R('DEBIT', 12) + R('CREDIT', 12) + R('BALANCE', 14));
  let bal = opening;
  for (const x of rows) {
    bal += x.amount;
    const d = `${pad2(x.d)}/${pad2(x.m)}`;
    line(W(d + '     ' + x.desc, 40) + R(x.amount < 0 ? fmt(-x.amount) : '', 12) + R(x.amount > 0 ? fmt(x.amount) : '', 12) + R(fmt(bal, { sign: true }), 14));
  }
  line(W('CLOSING BALANCE', 62) + R(fmt(bal, { sign: true }), 14));
  await save('mono_lines', doc, truthOf(rows, opening));
}

// ---------- 7. US sections without running balance (Deposits / Withdrawals) ----------
async function usSections() {
  const r = rng(61);
  const deposits = [];
  const withdrawals = [];
  for (let i = 0; i < 4; i++) deposits.push({ y: 2026, m: 6, d: 3 + i * 7, desc: INCOME_EN[i % INCOME_EN.length], extra: [], amount: Math.round(80000 + r() * 200000) });
  for (let i = 0; i < 14; i++) withdrawals.push({ y: 2026, m: 6, d: 2 + i * 2, desc: MERCHANTS_EN[i % MERCHANTS_EN.length], extra: [], amount: -Math.round(300 + r() * 30000) });
  const opening = 712000;
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  doc.font('Helvetica').fontSize(9);
  doc.font('Helvetica-Bold').fontSize(13).text('Sample National Bank', 40, 40);
  doc.font('Helvetica').fontSize(9).text('June 1, 2026 through June 30, 2026', 40, 60);
  const totalDep = deposits.reduce((s, x) => s + x.amount, 0);
  const totalWd = withdrawals.reduce((s, x) => s - x.amount, 0);
  doc.text('CHECKING SUMMARY', 40, 85);
  doc.text('Beginning Balance', 40, 98, { lineBreak: false });
  right(doc, '$' + fmt(opening), 330, 98);
  doc.text('Deposits and Additions', 40, 111, { lineBreak: false });
  right(doc, fmt(totalDep), 330, 111);
  doc.text('Electronic Withdrawals', 40, 124, { lineBreak: false });
  right(doc, '-' + fmt(totalWd), 330, 124);
  doc.text('Ending Balance', 40, 137, { lineBreak: false });
  right(doc, '$' + fmt(opening + totalDep - totalWd), 330, 137);
  let y = 170;
  const section = (title, list, total, totalLabel) => {
    doc.font('Helvetica-Bold').text(title, 40, y, { lineBreak: false });
    y += 15;
    doc.text('DATE', 40, y, { lineBreak: false });
    doc.text('DESCRIPTION', 100, y, { lineBreak: false });
    right(doc, 'AMOUNT', 560, y);
    doc.font('Helvetica');
    y += 14;
    for (const x of list) {
      doc.text(`${pad2(x.m)}/${pad2(x.d)}`, 40, y, { lineBreak: false });
      doc.text(x.desc, 100, y, { lineBreak: false });
      right(doc, fmt(Math.abs(x.amount)), 560, y);
      y += 13;
    }
    doc.font('Helvetica-Bold').text(totalLabel, 40, y, { lineBreak: false });
    right(doc, '$' + fmt(total), 560, y);
    doc.font('Helvetica');
    y += 25;
  };
  section('DEPOSITS AND ADDITIONS', deposits, totalDep, 'Total Deposits and Additions');
  section('ELECTRONIC WITHDRAWALS', withdrawals, totalWd, 'Total Electronic Withdrawals');
  const all = [...deposits, ...withdrawals];
  await save('us_sections', doc, {
    opening,
    closing: opening + totalDep - totalWd,
    transactions: all.map((x) => ({ date: iso(x), amount: x.amount, description: x.desc })),
  });
}

// ---------- 8. Same-day rows without date, balance only at end of day, unsigned amounts ----------
async function sameDay() {
  const r = rng(71);
  const rows = [];
  for (let day = 2; day <= 20; day += 2) {
    const k = 1 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) {
      const inc = r() < 0.2;
      rows.push({ y: 2026, m: 7, d: day, desc: inc ? INCOME_EN[j % INCOME_EN.length] : MERCHANTS_EN[Math.floor(r() * MERCHANTS_EN.length)], extra: [], amount: inc ? Math.round(20000 + r() * 90000) : -Math.round(200 + r() * 9000) });
    }
  }
  const opening = 250000;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.font('Helvetica').fontSize(9);
  doc.text('Example Savings Bank - account statement July 2026', 40, 40);
  doc.text('Opening balance', 40, 60, { lineBreak: false });
  right(doc, fmt(opening, { dec: ',', grp: '.' }), 545, 60);
  let y = 85;
  doc.font('Helvetica-Bold');
  doc.text('Date', 40, y, { lineBreak: false });
  doc.text('Details', 110, y, { lineBreak: false });
  right(doc, 'Amount', 440, y);
  right(doc, 'Balance', 545, y);
  doc.font('Helvetica');
  y += 15;
  let bal = opening;
  rows.forEach((x, i) => {
    bal += x.amount;
    const firstOfDay = i === 0 || rows[i - 1].d !== x.d;
    const lastOfDay = i === rows.length - 1 || rows[i + 1].d !== x.d;
    if (firstOfDay) doc.text(`${pad2(x.d)}.${pad2(x.m)}.${x.y}`, 40, y, { lineBreak: false });
    doc.text(x.desc, 110, y, { lineBreak: false });
    right(doc, fmt(Math.abs(x.amount), { dec: ',', grp: '.' }), 440, y);
    if (lastOfDay) right(doc, fmt(bal, { dec: ',', grp: '.', sign: true }), 545, y);
    y += 13;
  });
  y += 6;
  doc.text('Closing balance', 40, y, { lineBreak: false });
  right(doc, fmt(bal, { dec: ',', grp: '.', sign: true }), 545, y);
  await save('same_day', doc, truthOf(rows, opening));
}

await usChecking();
await usChecking('us_checking_broken', true);
await ukSigned();
await deSollHaben();
await ruCard();
await cardCrDr();
await monoLines();
await usSections();
await sameDay();
console.log('fixtures written to', OUT);
