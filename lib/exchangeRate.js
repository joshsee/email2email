const axios = require('axios');

const FOREIGN_AMOUNT_FIELDS = {
    CNY: 'Amount CNY',
    USD: 'Amount USD',
    MYR: 'Amount MYR',
    SGD: 'Amount SGD',
};

class ExchangeRateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ExchangeRateError';
        this.statusCode = 422;
    }
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function formatExchangeRateText(currency, rate) {
    return `1${currency}=${rate.toFixed(5)}HKD`;
}

async function getHkdRate(currency, date) {
    const fromCurrency = currency === 'CNH' ? 'CNY' : currency;
    const url = `https://api.frankfurter.app/${date}?from=${fromCurrency}&to=HKD`;

    try {
        const response = await axios.get(url, { timeout: 10000 });
        const rate = response.data && response.data.rates && response.data.rates.HKD;

        if (!rate) {
            throw new ExchangeRateError(`No HKD rate returned for ${fromCurrency} on ${date}`);
        }

        return rate;
    } catch (error) {
        if (error instanceof ExchangeRateError) {
            throw error;
        }

        throw new ExchangeRateError(
            `Failed to fetch exchange rate for ${fromCurrency} on ${date}: ${error.message}`,
        );
    }
}

async function resolveAmounts(transaction) {
    const { currency, amount, date } = transaction;

    if (currency === 'HKD') {
        return {
            amountHkd: round(amount, 1),
            foreignAmount: null,
            foreignAmountField: null,
            exchangeRateText: null,
        };
    }

    const rate = await getHkdRate(currency, date);
    const foreignAmountField = FOREIGN_AMOUNT_FIELDS[currency];

    if (!foreignAmountField) {
        throw new ExchangeRateError(`Unsupported foreign currency: ${currency}`);
    }

    return {
        amountHkd: round(amount * rate, 1),
        foreignAmount: round(amount, 2),
        foreignAmountField,
        exchangeRateText: formatExchangeRateText(currency, rate),
    };
}

module.exports = {
    ExchangeRateError,
    resolveAmounts,
    getHkdRate,
    formatExchangeRateText,
    FOREIGN_AMOUNT_FIELDS,
};
