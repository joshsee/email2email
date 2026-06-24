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

function getReceiptEmail() {
    const email = process.env.RECEIPT_EMAIL;
    return email ? email.toLowerCase() : null;
}

function getAuthorizedReceiptSender() {
    const email = process.env.RECEIPT_AUTHORIZED_SENDER;
    return email ? email.toLowerCase() : null;
}

function isReceiptEmail(toAddress) {
    const receiptEmail = getReceiptEmail();
    return receiptEmail
        && toAddress
        && toAddress.address
        && toAddress.address.toLowerCase() === receiptEmail;
}

function isAuthorizedReceiptSender(fromAddress) {
    const authorizedSender = getAuthorizedReceiptSender();
    return authorizedSender
        && fromAddress
        && fromAddress.address
        && fromAddress.address.toLowerCase() === authorizedSender;
}

function canProcessReceiptEmail(fromAddress, toAddress) {
    return isReceiptEmail(toAddress) && isAuthorizedReceiptSender(fromAddress);
}

async function processReceiptEmail(inboundEmail) {
    const bodyText = inboundEmail.text || stripHtml(inboundEmail.html);
    const transaction = parseBocTransaction(bodyText);
    const { name, categoryId } = applyMerchantRules(transaction.merchant, transaction.cardLast4);
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
    getReceiptEmail,
    getAuthorizedReceiptSender,
};
