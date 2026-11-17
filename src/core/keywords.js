// Multilingual keyword dictionaries used to recognise statement structure.
// All matching is done on lower-cased text with diacritics kept.

const words = (s) => s.split('|');

// Column header labels -> role.
export const HEADER_ROLES = {
  date: words(
    'date|posting date|post date|trans date|transaction date|tran date|value date|txn date|' +
      'дата|дата операции|дата проводки|дата списания|' +
      'datum|buchungstag|buchung|valuta|wertstellung|fecha|data|date opération|date valeur|datum boeking'
  ),
  description: words(
    'description|details|transaction details|particulars|narrative|narration|payee|memo|reference|transaction|' +
      'описание|описание операции|назначение|назначение платежа|содержание операции|операция|наименование|' +
      'verwendungszweck|buchungstext|beschreibung|vorgang|concepto|descripción|libellé|libelle|opération|descrizione|omschrijving|histórico'
  ),
  debit: words(
    'debit|debits|withdrawal|withdrawals|money out|paid out|out|payments|charges|debit amount|withdrawal amt|' +
      'списание|списания|расход|расходы|дебет|сумма списания|' +
      'soll|belastung|lastschrift|ausgang|cargo|cargos|débit|debit|uscite|dare|af|débito'
  ),
  credit: words(
    'credit|credits|deposit|deposits|money in|paid in|in|receipts|credit amount|deposit amt|' +
      'зачисление|зачисления|поступление|поступления|приход|кредит|сумма зачисления|' +
      'haben|gutschrift|eingang|abono|abonos|crédit|entrate|avere|bij|crédito'
  ),
  amount: words(
    'amount|amount ($)|amount (£)|amount (€)|transaction amount|сумма|сумма операции|сумма в валюте счета|' +
      'betrag|umsatz|importe|montant|importo|bedrag|valor|kwota'
  ),
  balance: words(
    'balance|running balance|balance ($)|ledger balance|остаток|баланс|сальдо|остаток после операции|' +
      'saldo|kontostand|solde|saldo contable|saldo disponible'
  ),
};

// Lines that carry the statement opening / closing balance.
export const OPENING_RE = new RegExp(
  [
    'opening balance', 'beginning balance', 'previous balance', 'balance brought forward', 'brought forward',
    'balance forward', 'starting balance', 'start balance', 'balance at start', 'b/f', 'balance b/fwd',
    'входящий остаток', 'остаток на начало', 'входящий баланс', 'баланс на начало', 'остаток входящий', 'начальный остаток',
    'anfangssaldo', 'alter kontostand', 'kontostand am anfang', 'saldo anterior', 'saldo inicial',
    'solde précédent', 'solde precedent', 'ancien solde', 'solde initial', 'saldo iniziale', 'beginsaldo',
  ].map(escapeRe).join('|'),
  'i'
);

export const CLOSING_RE = new RegExp(
  [
    'closing balance', 'ending balance', 'new balance', 'balance carried forward', 'carried forward',
    'end balance', 'balance at end', 'c/f', 'balance c/fwd', 'statement balance',
    'исходящий остаток', 'остаток на конец', 'исходящий баланс', 'баланс на конец', 'остаток исходящий', 'конечный остаток',
    'endsaldo', 'neuer kontostand', 'kontostand am ende', 'saldo final', 'nouveau solde', 'solde final',
    'saldo finale', 'eindsaldo',
  ].map(escapeRe).join('|'),
  'i'
);

// Summary lines that are never transactions.
export const TOTAL_RE = new RegExp(
  [
    'total', 'subtotal', 'sub-total', 'sum of', 'итого', 'всего', 'обороты', 'оборот за период',
    'summe', 'gesamt', 'totale', 'totaal', 'suma',
  ].map(escapeRe).join('|'),
  'i'
);

export const TOTAL_DEBIT_RE = /(total|итого|всего|summe|totale|totaal)[^\n]*(debit|withdrawal|money out|paid out|списан|расход|дебет|soll|belastung|cargo|uscite|dare)/i;
export const TOTAL_CREDIT_RE = /(total|итого|всего|summe|totale|totaal)[^\n]*(credit|deposit|money in|paid in|зачисл|поступл|приход|кредит|haben|gutschrift|abono|entrate|avere)/i;

// Section headings that set the sign of unsigned amounts (US-style statements).
export const SECTION_CREDIT_RE = /(deposit|credits?\b|additions|money in|paid in|payments? received|refund|зачислени|поступлени|приход|gutschrift|eingänge|abonos|crédits)/i;
export const SECTION_DEBIT_RE = /(withdrawal|debits?\b|payments?\b|purchases?|checks? paid|cheques?|fees|charges|interest charged|cash advance|списани|расход|покупк|комисси|belastung|ausgänge|cargos|débits)/i;

// Credit-card statements: amounts increase the amount owed.
export const LIABILITY_RE = /(credit card|card account|minimum payment|payment due date|credit limit|available credit|кредитная карта|минимальный платеж|минимальный платёж|кредитный лимит|kreditkarte|tarjeta de crédito|carte de crédit|carta di credito)/i;

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function headerRoleOf(text) {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Exact or prefix match against the dictionaries, longest label wins.
  let best = null;
  let bestLen = 0;
  for (const [role, labels] of Object.entries(HEADER_ROLES)) {
    for (const label of labels) {
      if (t === label || (label.length >= 4 && (t.startsWith(label + ' ') || t.endsWith(' ' + label)))) {
        if (label.length > bestLen) {
          best = role;
          bestLen = label.length;
        }
      }
    }
  }
  return best;
}
