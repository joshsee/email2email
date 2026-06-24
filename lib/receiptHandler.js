const { parseBocTransaction, TransactionParseError } = require('./parseBocTransaction');
const { applyMerchantRules } = require('./merchantRules');
const { resolveAmounts, ExchangeRateError } = require('./exchangeRate');
const {
    findWalletByCardLast4,
    findOrCreatePeriodExpenses,
    createExpenseIfNew,
    NotionExpenseError,
} = require('./notionExpense');
const { stripHtml } = require('./stripHtml');

const RECEIPT_EMAIL = 'receipt@littleplan.com';

function isReceiptEmail(toAddress) {
    return toAddress && toAddress.address && toAddress.address.toLowerCase() === RECEIPT_EMAIL;
}

async function processReceiptEmail(inboundEmail) {
    const bodyText = inboundEmail.text || stripHtml(inboundEmail.html);
    const transaction = parseBocTransaction(bodyText);
    const { name, categoryId } = applyMerchantRules(transaction.merchant);
    const amounts = await resolveAmounts(transaction);
    const walletId = await findWalletByCardLast4(transaction.cardLast4);
    const periodIds = await findOrCreatePeriodExpenses(transaction.date);

    const expense = {
        name,
        categoryId,
        date: transaction.date,
        amountHkd: amounts.amountHkd,
        foreignAmount: amounts.foreignAmount,
        foreignAmountField: amounts.foreignAmountField,
        exchangeRateText: amounts.exchangeRateText,
    };

    return createExpenseIfNew(expense, walletId, periodIds);
}

function getReceiptErrorStatus(error) {
    if (error instanceof TransactionParseError || error instanceof ExchangeRateError) {
        return 422;
    }

    if (error instanceof NotionExpenseError) {
        return error.statusCode;
    }

    return 500;
}

module.exports = {
    isReceiptEmail,
    processReceiptEmail,
    getReceiptErrorStatus,
    RECEIPT_EMAIL,
};
