const assert = require('node:assert/strict');
const test = require('node:test');

const addrs = require('email-addresses');

const TEST_CATEGORY_IDS = {
    sports: '11111111-1111-4111-8111-111111111101',
    grocery: '11111111-1111-4111-8111-111111111102',
    transport: '11111111-1111-4111-8111-111111111103',
    shopping: '11111111-1111-4111-8111-111111111104',
    bills: '11111111-1111-4111-8111-111111111105',
};

process.env.NOTION_CATEGORY_GROCERY_ID = TEST_CATEGORY_IDS.grocery;
process.env.NOTION_CATEGORY_SHOPPING_ID = TEST_CATEGORY_IDS.shopping;
process.env.NOTION_CATEGORY_TRANSPORT_ID = TEST_CATEGORY_IDS.transport;
process.env.NOTION_CATEGORY_SPORTS_ID = TEST_CATEGORY_IDS.sports;
process.env.NOTION_CATEGORY_BILLS_ID = TEST_CATEGORY_IDS.bills;
process.env.RECEIPT_EMAIL = 'receipt@example.com';
process.env.RECEIPT_AUTHORIZED_SENDER = 'authorized-sender@example.com';

const { parseBocTransaction } = require('./parseBocTransaction');
const { applyMerchantRules } = require('./merchantRules');
const { formatExchangeRateText } = require('./exchangeRate');
const { monthlyExpenseName, resolveWalletLookup, buildDedupFilter } = require('./notionExpense');
const { resolveExpenseIcon } = require('./expenseIcon');
const {
    canProcessReceiptEmail,
    isAuthorizedReceiptSender,
    isReceiptEmail,
    getReceiptEmail,
    getAuthorizedReceiptSender,
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

const DIRECT_DEBIT_EMAIL = [
    'Notice of Direct Debit transaction',
    'Please note that the following transaction has been executed:',
    'Transaction Type: Direct Debit',
    'Transaction Date: 2026/06/25',
    "Payee's A/C No: 001..001",
    'Payee: CLP POWER HK LTD',
    'Withdrawal A/C No.: 011..666',
    'Amount: HKD 121.00',
    "Debtor's Reference: ...9256",
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

test('parses BOC Direct Debit transactions', () => {
    const result = parseBocTransaction(DIRECT_DEBIT_EMAIL);

    assert.equal(result.cardLast4, null);
    assert.equal(result.date, '2026-06-25');
    assert.equal(result.merchant, 'CLP POWER HK LTD');
    assert.equal(result.currency, 'HKD');
    assert.equal(result.amount, 121);
    assert.equal(result.referenceNo, '...9256');
    assert.equal(result.format, 'directdebit');
});

test('merchant rules rename and categorize known merchants', () => {
    assert.deepEqual(applyMerchantRules('AlipayHK*PARKnSHOP H'), {
        name: 'ParkNShop',
        categoryId: TEST_CATEGORY_IDS.grocery,
    });

    assert.deepEqual(applyMerchantRules('TAOBAO MERCHANT'), {
        name: 'Taobao',
        categoryId: TEST_CATEGORY_IDS.shopping,
    });

    assert.deepEqual(applyMerchantRules('MT CITYBUS'), {
        name: 'Citybus',
        categoryId: TEST_CATEGORY_IDS.transport,
    });

    assert.deepEqual(applyMerchantRules('CLP POWER HK LTD'), {
        name: 'CLP - Monaco',
        categoryId: TEST_CATEGORY_IDS.bills,
    });
});

test('merchant keyword rules apply to every card (incl. 1110)', () => {
    assert.deepEqual(applyMerchantRules('MT MTR Corporation L', '1110'), {
        name: 'MTR',
        categoryId: TEST_CATEGORY_IDS.transport,
    });

    assert.deepEqual(applyMerchantRules('TAOBAO MERCHANT', '1110'), {
        name: 'Taobao',
        categoryId: TEST_CATEGORY_IDS.shopping,
    });

    // Merchants without a matching rule still keep their raw name.
    assert.deepEqual(applyMerchantRules('SOME RANDOM SHOP', '1110'), {
        name: 'SOME RANDOM SHOP',
        categoryId: null,
    });
});

test('formats exchange rate text like existing Notion entries', () => {
    assert.equal(formatExchangeRateText('CNY', 1.1597), '1CNY=1.15970HKD');
});

test('builds monthly expense names from transaction dates', () => {
    assert.equal(monthlyExpenseName('2026-06-21'), '2026 06');
});

test('dedup requires matching wallet as well as name, date, and amount', () => {
    const expense = {
        name: 'MTR',
        date: '2026-08-01',
        amountHkd: 13.8,
    };
    const goRWalletId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const unionPayWalletId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const goRFilter = buildDedupFilter(expense, goRWalletId);
    assert.deepEqual(goRFilter, {
        and: [
            { property: 'Name', title: { equals: 'MTR' } },
            { property: 'Date', date: { equals: '2026-08-01' } },
            { property: 'Wallet', relation: { contains: goRWalletId } },
            { property: 'Amount', number: { equals: 13.8 } },
        ],
    });

    const unionPayFilter = buildDedupFilter(expense, unionPayWalletId);
    assert.deepEqual(
        unionPayFilter.and.find((f) => f.property === 'Wallet'),
        { property: 'Wallet', relation: { contains: unionPayWalletId } },
    );
    assert.notDeepEqual(goRFilter, unionPayFilter);
});

test('dedup for foreign currency uses the foreign amount field and wallet', () => {
    const expense = {
        name: 'Taobao',
        date: '2026-06-06',
        amountHkd: 14.84,
        foreignAmount: 12.8,
        foreignAmountField: 'Amount CNY',
    };
    const walletId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    assert.deepEqual(buildDedupFilter(expense, walletId), {
        and: [
            { property: 'Name', title: { equals: 'Taobao' } },
            { property: 'Date', date: { equals: '2026-06-06' } },
            { property: 'Wallet', relation: { contains: walletId } },
            { property: 'Amount CNY', number: { equals: 12.8 } },
        ],
    });
});

test('payplus transactions resolve BoC Pay wallet by name', () => {
    const transaction = parseBocTransaction(PAYPLUS_EMAIL);
    assert.deepEqual(resolveWalletLookup(transaction), { lookup: 'name', value: 'BoC Pay' });
});

test('credit card transactions resolve wallet by card last 4', () => {
    const transaction = parseBocTransaction(CARD_EMAIL);
    assert.deepEqual(resolveWalletLookup(transaction), { lookup: 'cardLast4', value: '1110' });
});

test('direct debit transactions resolve Cash wallet by name', () => {
    const transaction = parseBocTransaction(DIRECT_DEBIT_EMAIL);
    assert.deepEqual(resolveWalletLookup(transaction), { lookup: 'name', value: 'Cash' });
});

test('allows receipt processing only from the authorized sender to receipt address', () => {
    const authorizedFrom = addrs.parseOneAddress(`Josh <${getAuthorizedReceiptSender()}>`);
    const unauthorizedFrom = addrs.parseOneAddress('attacker@example.com');
    const receiptTo = addrs.parseOneAddress(`Receipt <${getReceiptEmail()}>`);
    const otherTo = addrs.parseOneAddress('other@example.com');

    assert.equal(isAuthorizedReceiptSender(authorizedFrom), true);
    assert.equal(isAuthorizedReceiptSender(unauthorizedFrom), false);
    assert.equal(canProcessReceiptEmail(authorizedFrom, receiptTo), true);
    assert.equal(canProcessReceiptEmail(unauthorizedFrom, receiptTo), false);
    assert.equal(canProcessReceiptEmail(authorizedFrom, otherTo), false);
});

test('resolves Notion icons for known merchants and categories', () => {
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }).icon.name, 'train-metro');
    assert.equal(resolveExpenseIcon({ name: 'Citybus', categoryId: null }).icon.name, 'bus');
    assert.equal(resolveExpenseIcon({ name: 'ParkNShop', categoryId: null }).icon.name, 'banana');
    assert.equal(resolveExpenseIcon({ name: 'Gym - LCSD', categoryId: null }).icon.name, 'basketball');
    assert.equal(resolveExpenseIcon({ name: 'CLP - Monaco', categoryId: null }).icon.name, 'zap');
    assert.equal(resolveExpenseIcon({ name: 'Random Merchant', categoryId: null }).icon.name, 'credit-card');
});

test('expense icon colour matches the wallet payment method colour', () => {
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }).icon.color, 'gray');
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }, 'blue').icon.color, 'blue');
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }, 'green').icon.color, 'green');

    // Wallet colours read from Notion (e.g. `_lightgray`) normalise safely.
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }, 'lightgray').icon.color, 'lightgray');
    // Unknown / unsupported colours fall back to gray.
    assert.equal(resolveExpenseIcon({ name: 'MTR', categoryId: null }, 'teal').icon.color, 'gray');
});
