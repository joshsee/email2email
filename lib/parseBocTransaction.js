const SUPPORTED_CURRENCIES = new Set(['HKD', 'CNY', 'CNH', 'USD', 'MYR', 'SGD']);

class TransactionParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TransactionParseError';
        this.statusCode = 422;
    }
}

function normalizeAmount(rawAmount) {
    return Number.parseFloat(String(rawAmount).replace(/,/g, ''));
}

function inferYear(day, month) {
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(Date.UTC(year, month - 1, day));

    const msPerDay = 24 * 60 * 60 * 1000;
    if (candidate.getTime() - now.getTime() > 7 * msPerDay) {
        year -= 1;
    }

    return year;
}

function toIsoDate(day, month, year) {
    const yyyy = String(year).padStart(4, '0');
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function parsePayPlusFormat(text) {
    if (!/Pay\+\s*Wallet|Top-up Account No\./i.test(text)) {
        return null;
    }

    const cardMatch = text.match(/Top-up Account No\.\s*:\s*BOC Card Ending\s*\[(\d{4})\]/i);
    const dateMatch = text.match(/Transaction Date\s*:\s*(\d{4})\/(\d{2})\/(\d{2})/i);
    const merchantMatch = text.match(/Merchant\s*:\s*(.+)/i);
    const amountMatch = text.match(/Amount\s*:\s*([A-Z]{3})\s+([\d,]+\.?\d*)/i);
    const referenceMatch = text.match(/Reference No\.\s*:\s*(\S+)/i);

    if (!cardMatch || !dateMatch || !merchantMatch || !amountMatch) {
        throw new TransactionParseError('Failed to parse BoC Pay+ transaction email');
    }

    const currency = amountMatch[1].toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
        throw new TransactionParseError(`Unsupported currency: ${currency}`);
    }

    return {
        cardLast4: cardMatch[1],
        date: toIsoDate(
            Number.parseInt(dateMatch[3], 10),
            Number.parseInt(dateMatch[2], 10),
            Number.parseInt(dateMatch[1], 10),
        ),
        merchant: merchantMatch[1].trim().split('\n')[0].trim(),
        currency: currency === 'CNH' ? 'CNY' : currency,
        amount: normalizeAmount(amountMatch[2]),
        referenceNo: referenceMatch ? referenceMatch[1] : null,
        format: 'payplus',
    };
}

function parseCreditCardFormat(text) {
    const cardMatch = text.match(/Card Account Number Ending with:\s*(\d{4})/i);
    const dateMatch = text.match(/Transaction Date:\s*(\d{2})\/(\d{2})/i);
    const merchantMatch = text.match(/Merchant Name:\s*(.+)/i);
    const amountMatch = text.match(/Transaction Amount:\s*([A-Z]{3})([\d,]+\.?\d*)/i);

    if (!cardMatch || !dateMatch || !merchantMatch || !amountMatch) {
        return null;
    }

    const currency = amountMatch[1].toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
        throw new TransactionParseError(`Unsupported currency: ${currency}`);
    }

    const day = Number.parseInt(dateMatch[1], 10);
    const month = Number.parseInt(dateMatch[2], 10);
    const year = inferYear(day, month);

    return {
        cardLast4: cardMatch[1],
        date: toIsoDate(day, month, year),
        merchant: merchantMatch[1].trim().split('\n')[0].trim(),
        currency: currency === 'CNH' ? 'CNY' : currency,
        amount: normalizeAmount(amountMatch[2]),
        referenceNo: null,
        format: 'card',
    };
}

function parseBocTransaction(text) {
    if (!text || !String(text).trim()) {
        throw new TransactionParseError('Email body is empty');
    }

    const normalized = String(text).replace(/\r\n/g, '\n');

    const payPlus = parsePayPlusFormat(normalized);
    if (payPlus) {
        return payPlus;
    }

    const creditCard = parseCreditCardFormat(normalized);
    if (creditCard) {
        return creditCard;
    }

    throw new TransactionParseError('Unrecognized BOC transaction email format');
}

module.exports = {
    TransactionParseError,
    parseBocTransaction,
    SUPPORTED_CURRENCIES,
};
