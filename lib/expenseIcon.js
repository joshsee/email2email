const { getCategoryIds } = require('./merchantRules');

function notionIcon(name, color = 'gray') {
    return {
        type: 'icon',
        icon: { name, color },
    };
}

const EXPENSE_ICONS_BY_NAME = {
    'Gym - LCSD': notionIcon('dumbbell'),
    ParkNShop: notionIcon('banana'),
    Citybus: notionIcon('bus'),
    MTR: notionIcon('train'),
    Taobao: notionIcon('shopping-bag'),
    'CLP - Monaco': notionIcon('zap'),
};

const CATEGORY_ICON_BY_KEY = {
    sports: notionIcon('dumbbell'),
    grocery: notionIcon('banana'),
    transport: notionIcon('bus'),
    shopping: notionIcon('shopping-bag'),
    bills: notionIcon('zap'),
};

const DAILY_EXPENSE_ICON = notionIcon('calendar-day');
const MONTHLY_EXPENSE_ICON = notionIcon('calendar');
const DEFAULT_EXPENSE_ICON = notionIcon('credit-card');

function resolveExpenseIcon(expense) {
    if (expense.name && EXPENSE_ICONS_BY_NAME[expense.name]) {
        return EXPENSE_ICONS_BY_NAME[expense.name];
    }

    if (expense.categoryId) {
        const categoryIds = getCategoryIds();
        for (const [key, icon] of Object.entries(CATEGORY_ICON_BY_KEY)) {
            if (categoryIds[key] && categoryIds[key] === expense.categoryId) {
                return icon;
            }
        }
    }

    return DEFAULT_EXPENSE_ICON;
}

module.exports = {
    resolveExpenseIcon,
    DAILY_EXPENSE_ICON,
    MONTHLY_EXPENSE_ICON,
    DEFAULT_EXPENSE_ICON,
};
