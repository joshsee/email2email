const { parseBocTransaction, TransactionParseError } = require('./parseBocTransaction');
const { applyMerchantRules } = require('./merchantRules');
const { resolveAmounts, ExchangeRateError } = require('./exchangeRate');
const {
    findWalletForTransaction,
    findOrCreatePeriodExpenses,
    createExpenseIfNew,
    NotionExpenseError,
} = require('./notionExpense');
const { stripHtml } = require('./stripHtml');

const RECEIPT_EMAIL = 'receipt@littleplan.com';
const AUTHORIZED_RECEIPT_SENDER = (process.env.RECEIPT_AUTHORIZED_SENDER || 'ychian@gmail.com').toLowerCase();

function isReceiptEmail(toAddress) {
    return toAddress && toAddress.address && toAddress.address.toLowerCase() === RECEIPT_EMAIL;
}

function isAuthorizedReceiptSender(fromAddress) {
    return fromAddress
        && fromAddress.address
        && fromAddress.address.toLowerCase() === AUTHORIZED_RECEIPT_SENDER;
}

function canProcessReceiptEmail(fromAddress, toAddress) {
    return isReceiptEmail(toAddress) && isAuthorizedReceiptSender(fromAddress);
}

async function processReceiptEmail(inboundEmail) {
    const bodyText = inboundEmail.text || stripHtml(inboundEmail.html);
    const transaction = parseBocTransaction(bodyText);
    const { name, categoryId } = applyMerchantRules(transaction.merchant);
    const amounts = await resolveAmounts(transaction);
    const walletId = await findWalletForTransaction(transaction);
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
    isAuthorizedReceiptSender,
    canProcessReceiptEmail,
    processReceiptEmail,
    getReceiptErrorStatus,
    RECEIPT_EMAIL,
    AUTHORIZED_RECEIPT_SENDER,
};
