const { CATEGORY_IDS } = require('./merchantRules');

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
};

const EXPENSE_ICONS_BY_CATEGORY = {
    [CATEGORY_IDS.sports]: notionIcon('dumbbell'),
    [CATEGORY_IDS.grocery]: notionIcon('banana'),
    [CATEGORY_IDS.transport]: notionIcon('bus'),
    [CATEGORY_IDS.shopping]: notionIcon('shopping-bag'),
};

const DAILY_EXPENSE_ICON = notionIcon('calendar-day');
const MONTHLY_EXPENSE_ICON = notionIcon('calendar');
const DEFAULT_EXPENSE_ICON = notionIcon('credit-card');

function resolveExpenseIcon(expense) {
    if (expense.name && EXPENSE_ICONS_BY_NAME[expense.name]) {
        return EXPENSE_ICONS_BY_NAME[expense.name];
    }

    if (expense.categoryId && EXPENSE_ICONS_BY_CATEGORY[expense.categoryId]) {
        return EXPENSE_ICONS_BY_CATEGORY[expense.categoryId];
    }

    return DEFAULT_EXPENSE_ICON;
}

module.exports = {
    resolveExpenseIcon,
    DAILY_EXPENSE_ICON,
    MONTHLY_EXPENSE_ICON,
    DEFAULT_EXPENSE_ICON,
};
