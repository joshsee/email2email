const CATEGORY_ENV_KEYS = {
    sports: 'NOTION_CATEGORY_SPORTS_ID',
    grocery: 'NOTION_CATEGORY_GROCERY_ID',
    transport: 'NOTION_CATEGORY_TRANSPORT_ID',
    shopping: 'NOTION_CATEGORY_SHOPPING_ID',
    bills: 'NOTION_CATEGORY_BILLS_ID',
};

const EXACT_MERCHANT_CARD_LAST4 = new Set(['1110']);

const RULES = [
    { keywords: ['LCSD', 'SMARTPLAY'], name: 'Gym - LCSD', categoryKey: 'sports' },
    { keywords: ['PARKNSHOP'], name: 'ParkNShop', categoryKey: 'grocery' },
    { keywords: ['CITYBUS'], name: 'Citybus', categoryKey: 'transport' },
    { keywords: ['MTR'], name: 'MTR', categoryKey: 'transport' },
    { keywords: ['TAOBAO'], name: 'Taobao', categoryKey: 'shopping' },
    { keywords: ['CLP POWER'], name: 'CLP - Monaco', categoryKey: 'bills' },
];

function getCategoryId(categoryKey) {
    const envKey = CATEGORY_ENV_KEYS[categoryKey];
    return envKey ? process.env[envKey] || null : null;
}

function getCategoryIds() {
    return Object.fromEntries(
        Object.entries(CATEGORY_ENV_KEYS).map(([key, envKey]) => [key, process.env[envKey] || null]),
    );
}

function applyMerchantRules(rawMerchant, cardLast4) {
    const name = String(rawMerchant || '').trim();

    if (cardLast4 && EXACT_MERCHANT_CARD_LAST4.has(cardLast4)) {
        return { name, categoryId: null };
    }

    const upper = name.toUpperCase();

    for (const rule of RULES) {
        if (rule.keywords.some((keyword) => upper.includes(keyword))) {
            return {
                name: rule.name,
                categoryId: getCategoryId(rule.categoryKey),
            };
        }
    }

    return { name, categoryId: null };
}

module.exports = {
    applyMerchantRules,
    getCategoryId,
    getCategoryIds,
    CATEGORY_ENV_KEYS,
    RULES,
    EXACT_MERCHANT_CARD_LAST4,
};
