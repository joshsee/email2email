const assert = require('node:assert/strict');
const test = require('node:test');

const addrs = require('email-addresses');
const { parseBocTransaction } = require('./parseBocTransaction');
const { applyMerchantRules } = require('./merchantRules');
const { formatExchangeRateText } = require('./exchangeRate');
const { monthlyExpenseName, resolveWalletLookup } = require('./notionExpense');
const { resolveExpenseIcon } = require('./expenseIcon');
const {
    canProcessReceiptEmail,
    isAuthorizedReceiptSender,
    isReceiptEmail,
    AUTHORIZED_RECEIPT_SENDER,
    RECEIPT_EMAIL,
} = require('./receiptHandler');

const CARD_EMAIL = [
    'Card Account Number Ending with: 1110',
    'Transaction Date: 23/06',
    'Merchant Name: AlipayHK*SoFast',
    'Transaction Amount: HKD62.00',
].join('\n');

const CNY_EMAIL = [
    'Card Account Number Ending with: 1110',
    'Transaction Date: 06/06',
    'Merchant Name: TAOBAO MERCHANT',
    'Transaction Amount: CNY12.80',
].join('\n');

const PAYPLUS_EMAIL = [
    'Thank you for choosing BoC Pay+.',
    '',
    'Your Pay+ Wallet transaction details as follows:',
    '',
    'Transaction Type : Top-up and Merchant Payment',
    'Top-up Account No. : BOC Card Ending [0112]',
    'Transaction Date : 2026/06/21',
    'Merchant : MT CITYBUS',
    'Amount : HKD 4.40',
    'Reference No. : 0000002606220060301',
].join('\n');

test('parses credit card HKD transactions', () => {
    const result = parseBocTransaction(CARD_EMAIL);

    assert.equal(result.cardLast4, '1110');
    assert.equal(result.merchant, 'AlipayHK*SoFast');
    assert.equal(result.currency, 'HKD');
    assert.equal(result.amount, 62);
    assert.match(result.date, /^\d{4}-06-23$/);
    assert.equal(result.format, 'card');
});

test('parses credit card foreign currency transactions', () => {
    const result = parseBocTransaction(CNY_EMAIL);

    assert.equal(result.currency, 'CNY');
    assert.equal(result.amount, 12.8);
    assert.match(result.date, /^\d{4}-06-06$/);
});

test('parses BoC Pay+ wallet transactions', () => {
    const result = parseBocTransaction(PAYPLUS_EMAIL);

    assert.equal(result.cardLast4, '0112');
    assert.equal(result.date, '2026-06-21');
    assert.equal(result.merchant, 'MT CITYBUS');
    assert.equal(result.currency, 'HKD');
    assert.equal(result.amount, 4.4);
    assert.equal(result.referenceNo, '0000002606220060301');
    assert.equal(result.format, 'payplus');
});

test('merchant rules rename and categorize known merchants', () => {
    assert.deepEqual(applyMerchantRules('AlipayHK*PARKnSHOP H'), {
        name: 'ParkNShop',
        categoryId: 'a628287d-69db-4f8e-8612-d606273d6d6d',
    });

    assert.deepEqual(applyMerchantRules('TAOBAO MERCHANT'), {
        name: 'Taobao',
        categoryId: '94414e58-b0b0-42e0-aa40-f6fe1f700ed8',
    });

    assert.deepEqual(applyMerchantRules('MT CITYBUS'), {
        name: 'Citybus',
        categoryId: '5cbac350-cea0-4b59-9bb6-f1b6052a2b60',
    });
});

test('card ending 1110 keeps exact merchant name without rules', () => {
    assert.deepEqual(applyMerchantRules('TAOBAO MERCHANT', '1110'), {
        name: 'TAOBAO MERCHANT',
        categoryId: null,
    });

    assert.deepEqual(applyMerchantRules('AlipayHK*PARKnSHOP H', '1110'), {
        name: 'AlipayHK*PARKnSHOP H',
        categoryId: null,
    });

    const transaction = parseBocTransaction(CNY_EMAIL);
    assert.deepEqual(applyMerchantRules(transaction.merchant, transaction.cardLast4), {
        name: 'TAOBAO MERCHANT',
        categoryId: null,
    });
});

test('formats exchange rate text like existing Notion entries', () => {
    assert.equal(formatExchangeRateText('CNY', 1.1597), '1CNY=1.15970HKD');
});

test('builds monthly expense names from transaction dates', () => {
    assert.equal(monthlyExpenseName('2026-06-21'), '2026 06');
});

test('payplus transactions resolve BoC Pay wallet by name', () => {
    const transaction = parseBocTransaction(PAYPLUS_EMAIL);
    assert.deepEqual(resolveWalletLookup(transaction), { lookup: 'name', value: 'BoC Pay' });
});

test('credit card transactions resolve wallet by card last 4', () => {
    const transaction = parseBocTransaction(CARD_EMAIL);
    assert.deepEqual(resolveWalletLookup(transaction), { lookup: 'cardLast4', value: '1110' });
});

test('allows receipt processing only from the authorized sender to receipt address', () => {
    const authorizedFrom = addrs.parseOneAddress(`Josh <${AUTHORIZED_RECEIPT_SENDER}>`);
    const unauthorizedFrom = addrs.parseOneAddress('attacker@example.com');
    const receiptTo = addrs.parseOneAddress(`Receipt <${RECEIPT_EMAIL}>`);
    const otherTo = addrs.parseOneAddress('other@littleplan.com');

    assert.equal(isAuthorizedReceiptSender(authorizedFrom), true);
    assert.equal(isAuthorizedReceiptSender(unauthorizedFrom), false);
    assert.equal(canProcessReceiptEmail(authorizedFrom, receiptTo), true);
    assert.equal(canProcessReceiptEmail(unauthorizedFrom, receiptTo), false);
    assert.equal(canProcessReceiptEmail(authorizedFrom, otherTo), false);
});

test('resolves Notion icons for known merchants and categories', () => {
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }).icon.name, 'train');
    assert.equal(resolveExpenseIcon({ name: 'Citybus', categoryId: null }).icon.name, 'bus');
    assert.equal(resolveExpenseIcon({ name: 'ParkNShop', categoryId: null }).icon.name, 'banana');
    assert.equal(resolveExpenseIcon({ name: 'Random Merchant', categoryId: null }).icon.name, 'credit-card');
});
