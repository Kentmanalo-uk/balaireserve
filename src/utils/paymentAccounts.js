/**
 * How guests can pay. GCash, Maya and bank transfer are all optional: a method only appears for guests
 * once the resort has filled it in (Settings → Payment).
 *
 * Banks are free text and any number of them: settings.bank_accounts is a JSON array of
 * { bank, account_name, number }. The older bank_bdo / bank_bpi / bank_name settings are read until the
 * new list is first saved.
 */
'use strict';

const isPlaceholder = v => { const s = String(v == null ? '' : v).trim(); return !s || s === '—' || /x{3,}/i.test(s); };

function bankAccounts(settings = {}) {
  if (settings.bank_accounts != null && settings.bank_accounts !== '') {
    let list;
    try { list = JSON.parse(settings.bank_accounts); } catch { list = []; }
    if (Array.isArray(list)) {
      return list
        .map(b => ({ bank: String(b.bank || '').trim(), account_name: String(b.account_name || '').trim(), number: String(b.number || '').trim() }))
        .filter(b => b.bank && !isPlaceholder(b.number));
    }
  }
  const name = isPlaceholder(settings.bank_name) ? '' : String(settings.bank_name).trim();
  return [['BDO', settings.bank_bdo], ['BPI', settings.bank_bpi]]
    .filter(([, number]) => !isPlaceholder(number))
    .map(([bank, number]) => ({ bank, account_name: name, number: String(number).trim() }));
}

/** Form rows → rows to store. Returns { rows, errors }; completely empty rows are skipped. */
function buildBankAccounts(input) {
  const list = Array.isArray(input) ? input : input && typeof input === 'object' ? Object.values(input) : [];
  const rows = [], errors = [];
  for (const r of list) {
    const row = { bank: String(r?.bank || '').trim(), account_name: String(r?.account_name || '').trim(), number: String(r?.number || '').trim() };
    if (!row.bank && !row.account_name && !row.number) continue;
    if (!row.bank || !row.number) { errors.push('Each bank account needs a bank name and an account number.'); continue; }
    if (isPlaceholder(row.number)) { errors.push(`Enter the real account number for ${row.bank}.`); continue; }
    if (row.bank.length > 100 || row.account_name.length > 150 || row.number.length > 60) { errors.push(`The details for ${row.bank} are too long.`); continue; }
    rows.push(row);
  }
  return { rows, errors };
}

// The methods guests can choose right now.
function readyMethods(settings = {}, { gcashQr = settings.gcash_qr_path, mayaQr = settings.maya_qr_path } = {}) {
  const out = [];
  if (!isPlaceholder(settings.gcash_number) || gcashQr) out.push('gcash');
  if (!isPlaceholder(settings.maya_number) || mayaQr) out.push('maya');
  if (bankAccounts(settings).length) out.push('bank_transfer');
  return out;
}

// "GCash, Maya or bank transfer" with only the methods in use; '' when none is set up.
function methodsText(settings = {}) {
  const names = readyMethods(settings).map(m => ({ gcash: 'GCash', maya: 'Maya', bank_transfer: 'bank transfer' }[m]));
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] : (names[0] || '');
}

module.exports = { isPlaceholder, bankAccounts, buildBankAccounts, readyMethods, methodsText };
