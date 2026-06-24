const CATEGORY_IDS = {
    sports: '28c34683-85ad-4bbf-b321-a3a9a1ffad2d',
    grocery: 'a628287d-69db-4f8e-8612-d606273d6d6d',
    transport: '5cbac350-cea0-4b59-9bb6-f1b6052a2b60',
    shopping: '94414e58-b0b0-42e0-aa40-f6fe1f700ed8',
};

const RULES = [
    { keywords: ['LCSD', 'SMARTPLAY'], name: 'Gym - LCSD', categoryId: CATEGORY_IDS.sports },
    { keywords: ['PARKNSHOP'], name: 'ParkNShop', categoryId: CATEGORY_IDS.grocery },
    { keywords: ['CITYBUS'], name: 'Citybus', categoryId: CATEGORY_IDS.transport },
    { keywords: ['MTR'], name: 'MTR', categoryId: CATEGORY_IDS.transport },
    { keywords: ['TAOBAO'], name: 'Taobao', categoryId: CATEGORY_IDS.shopping },
];

function applyMerchantRules(rawMerchant) {
    const upper = String(rawMerchant || '').toUpperCase();

    for (const rule of RULES) {
        if (rule.keywords.some((keyword) => upper.includes(keyword))) {
            return { name: rule.name, categoryId: rule.categoryId };
        }
    }

    return { name: String(rawMerchant || '').trim(), categoryId: null };
}

module.exports = {
    applyMerchantRules,
    CATEGORY_IDS,
    RULES,
};
