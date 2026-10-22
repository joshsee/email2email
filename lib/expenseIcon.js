const { getCategoryIds } = require('./merchantRules');

const VALID_ICON_COLORS = new Set([
    'gray',
    'lightgray',
    'brown',
    'yellow',
    'orange',
    'green',
    'blue',
    'purple',
    'pink',
    'red',
]);

const DEFAULT_ICON_COLOR = 'gray';

function normalizeIconColor(color) {
    const value = String(color || '').toLowerCase().replace(/[\s_-]/g, '');
    if (value === 'lightgray' || value === 'grey') {
        return value === 'grey' ? 'gray' : 'lightgray';
    }
    return VALID_ICON_COLORS.has(value) ? value : DEFAULT_ICON_COLOR;
}

function notionIcon(name, color = DEFAULT_ICON_COLOR) {
    return {
        type: 'icon',
        icon: { name, color: normalizeIconColor(color) },
    };
}

// Icon names chosen to match the icons already used in the Expense Journal.
const EXPENSE_ICON_NAME_BY_NAME = {
    'Gym - LCSD': 'basketball',
    ParkNShop: 'banana',
    Citybus: 'bus',
    MTR: 'train-metro',
    Taobao: 'shopping-bag',
    'CLP - Monaco': 'zap',
};

const CATEGORY_ICON_NAME_BY_KEY = {
    sports: 'basketball',
    grocery: 'banana',
    transport: 'bus',
    shopping: 'shopping-bag',
    bills: 'zap',
};

const DEFAULT_EXPENSE_ICON_NAME = 'credit-card';

function resolveExpenseIconName(expense) {
    if (expense.name && EXPENSE_ICON_NAME_BY_NAME[expense.name]) {
        return EXPENSE_ICON_NAME_BY_NAME[expense.name];
    }

    if (expense.categoryId) {
        const categoryIds = getCategoryIds();
        for (const [key, iconName] of Object.entries(CATEGORY_ICON_NAME_BY_KEY)) {
            if (categoryIds[key] && categoryIds[key] === expense.categoryId) {
                return iconName;
            }
        }
    }

    return DEFAULT_EXPENSE_ICON_NAME;
}

function resolveExpenseIcon(expense, color = DEFAULT_ICON_COLOR) {
    return notionIcon(resolveExpenseIconName(expense), color);
}

const DAILY_EXPENSE_ICON = notionIcon('calendar-day');
const MONTHLY_EXPENSE_ICON = notionIcon('calendar');
const DEFAULT_EXPENSE_ICON = notionIcon(DEFAULT_EXPENSE_ICON_NAME);

module.exports = {
    resolveExpenseIcon,
    resolveExpenseIconName,
    normalizeIconColor,
    notionIcon,
    VALID_ICON_COLORS,
    DEFAULT_ICON_COLOR,
    DAILY_EXPENSE_ICON,
    MONTHLY_EXPENSE_ICON,
    DEFAULT_EXPENSE_ICON,
};
