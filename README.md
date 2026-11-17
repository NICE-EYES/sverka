# Sverka

**Bank statement PDF → verified transaction table. Free, open source, 100% in your browser.**

*Русская версия ниже.*

Sverka turns PDF bank and credit-card statements into a clean table and **proves it got every row right**: it checks the opening balance plus every transaction against the closing balance, and every row against the running balance printed on the statement. If something does not add up, it shows the exact row, the original PDF text, and offers a one-click fix.

## Why another converter

| | Typical online converter | Chatbot (upload PDF, ask for a table) | Sverka |
|---|---|---|---|
| Your statement leaves your computer | yes | yes | **no** |
| Price | per page / subscription | subscription | **free (MIT)** |
| Proves the rows are complete and correct | rarely | no | **yes: period + running balance + printed totals** |
| Shows where an error is | — | — | **row number, original text, suggested fix** |
| Exports | CSV/Excel | copy-paste | **XLSX, CSV presets (Excel EU/US, YNAB, QuickBooks, Xero), OFX, QIF, Beancount, JSON** |

## Features

- Drag in one or many PDFs (e.g. 12 monthly statements). Password-protected PDFs are supported.
- Works with any layout that has dates and amounts: no per-bank templates needed. The parser finds the table columns by geometry, reads the header in 8 languages, and when the header is ambiguous it tries every column interpretation and keeps the one that reconciles.
- Understands `1,234.56`, `1.234,56`, `1 234,56`, `(12.50)`, `12.50-`, `12.50 CR/DR`, `+5 000,00` (income-only plus sign), currency symbols, DD/MM vs MM/DD (decided per document), dates without a year (year taken from the statement period, including December → January), month names in EN/RU/DE/FR/ES/IT/PT/NL.
- Debit/credit columns, a signed amount column, an unsigned amount column with section headings (“Deposits and additions” / “Withdrawals”), CR/DR markers, multi-line descriptions, rows that omit a repeated date, daily balances.
- Signs that the statement does not print are worked out from the running balance (or from the opening/closing balance), never guessed silently.
- Checks: opening + Σ rows = closing; running balance on every row; printed “Total debits/credits”; continuity between consecutive statements (and overlap warnings for duplicates).
- Inline editing of date, description and amount with instant re-check; exclude rows; “add missing transaction” and “correct amount” fixes.
- Credit-card mode: purchases increase what you owe; exports show them as negative cash flow.
- Beancount export includes `balance` assertions taken from the statement, so `bean-check` re-verifies your import.
- RU/EN interface, light and dark themes, works on phones.

## How it works

```
PDF ──pdf.js──► positioned text ──► lines & cells ──► dates / amounts / header roles
    ──► amount columns (cluster right edges) ──► column-role hypotheses
    ──► rows (multi-line, same-day, sections) ──► signs (explicit → balance → period)
    ──► reconciliation ──► review UI ──► exports
```

All code is plain JavaScript in `src/`:

- `src/core/` — parsing and reconciliation (no DOM; runs in Node and the browser)
- `src/export/` — CSV/TSV, XLSX (own tiny writer), OFX, QIF, Beancount, JSON
- `src/web/` — the single-page interface

## Run it

Open `dist/index.html` in a browser, or host the `dist/` folder anywhere (GitHub Pages works). The page loads pdf.js 3.11.174 from cdnjs; after that, parsing needs no network.

```bash
npm install
npm run fixtures   # regenerate synthetic test statements
npm test           # 9 statement layouts + unit tests
npm run build      # writes dist/index.html
node scripts/debug.mjs some-statement.pdf   # see what the parser extracted
```

## Limitations (honest list)

- Scanned statements (images without a text layer) are not supported yet — OCR is on the roadmap.
- Currencies with 3 decimals (KWD, BHD, OMR…) and with no decimals are not supported yet.
- The test suite uses **synthetic** statements in 9 layouts. Real banks vary more; if a statement does not parse, open an issue with the layout (column names, how dates and amounts look — never real data).

## Roadmap

OCR for scans (Tesseract.js), per-bank presets contributed by users, merchant-name cleanup, categorisation rules, Firefly III / Actual Budget direct import, a desktop build for batch work.

---

# Sverka — по-русски

**PDF-выписка банка → проверенная таблица операций. Бесплатно, с открытым кодом, полностью в браузере.**

Sverka превращает PDF-выписки по счетам и картам в таблицу и **доказывает, что ни одна строка не потеряна и не искажена**: сверяет «начальный остаток + все операции = конечный остаток» и остаток после каждой операции с тем, что напечатано в выписке. Если что-то не сходится, показывает конкретную строку, исходный текст из PDF и предлагает исправление в один клик.

Главное:

- Файлы не загружаются на сервер — всё считается в вашем браузере.
- Без регистрации, лимитов страниц и подписки.
- Любой банк с текстовыми PDF: колонки определяются по расположению текста, заголовки понимаются на 8 языках, включая русский.
- Форматы сумм `1 234,56`, `+5 000,00` / `1 234,56` (как в выписках российских банков), `1.234,56`, `(12.50)`, `CR/DR`; даты без года; дебет/кредит, сумма со знаком, разделы «зачисления/списания».
- Экспорт: Excel (.xlsx), CSV для Excel (с точкой с запятой и запятой в дробях), универсальный CSV для Firefly III и Actual Budget, YNAB, QuickBooks, Xero, OFX (GnuCash и др.), QIF, Beancount с проверками остатков, JSON.
- Проверка непрерывности между выписками за разные месяцы.

Ограничения: сканы без текстового слоя пока не поддерживаются; тесты построены на синтетических выписках — если ваша выписка не распознаётся, опишите её структуру (без персональных данных) в issue.

Лицензия: MIT.
