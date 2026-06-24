const { Client } = require('@notionhq/client');
const { resolveExpenseIcon, DAILY_EXPENSE_ICON, MONTHLY_EXPENSE_ICON } = require('./expenseIcon');

const DEFAULT_DATABASE_IDS = {
    expenses: '8c07d787-86bd-4643-8d68-92b85f3b7a04',
    wallet: 'aada623f-ef44-4240-a3d0-992dc4991ed1',
    dailyExpense: '31634792-2fcd-40d1-a5f5-8b7c9f01cefe',
    monthlyExpense: '6e82eeb3-4fe7-43f5-b3dc-66fce198ab20',
};

class NotionExpenseError extends Error {
    constructor(message, statusCode = 422) {
        super(message);
        this.name = 'NotionExpenseError';
        this.statusCode = statusCode;
    }
}

let notionClient;
const dataSourceIdCache = new Map();

function getNotionClient() {
    if (!process.env.NOTION_API_KEY) {
        throw new NotionExpenseError('NOTION_API_KEY is not configured', 500);
    }

    if (!notionClient) {
        notionClient = new Client({ auth: process.env.NOTION_API_KEY });
    }

    return notionClient;
}

const ENV_DATABASE_KEYS = {
    expenses: 'NOTION_EXPENSES_DATABASE_ID',
    wallet: 'NOTION_WALLET_DATABASE_ID',
    dailyExpense: 'NOTION_DAILY_EXPENSE_DATABASE_ID',
    monthlyExpense: 'NOTION_MONTHLY_EXPENSE_DATABASE_ID',
};

function getDatabaseId(key) {
    const envKey = ENV_DATABASE_KEYS[key];
    return (envKey && process.env[envKey]) || DEFAULT_DATABASE_IDS[key];
}

async function getDataSourceId(databaseKey) {
    const databaseId = getDatabaseId(databaseKey);
    if (dataSourceIdCache.has(databaseId)) {
        return dataSourceIdCache.get(databaseId);
    }

    const notion = getNotionClient();
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = database.data_sources?.[0]?.id;

    if (!dataSourceId) {
        throw new NotionExpenseError(`No data source found for database ${databaseKey}`);
    }

    dataSourceIdCache.set(databaseId, dataSourceId);
    return dataSourceId;
}

function monthlyExpenseName(date) {
    const [year, month] = date.split('-');
    return `${year} ${month}`;
}

async function queryDatabase(databaseKey, filter) {
    const notion = getNotionClient();
    const dataSourceId = await getDataSourceId(databaseKey);
    const response = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter,
        page_size: 5,
    });

    return response.results || [];
}

const PAYPLUS_WALLET_NAME = 'BoC Pay';

function resolveWalletLookup(transaction) {
    if (transaction.format === 'payplus') {
        return { lookup: 'name', value: PAYPLUS_WALLET_NAME };
    }

    return { lookup: 'cardLast4', value: transaction.cardLast4 };
}

async function findWalletByName(name) {
    const results = await queryDatabase('wallet', {
        property: 'Name',
        title: { equals: name },
    });

    if (results.length === 0) {
        throw new NotionExpenseError(`No wallet found with name ${name}`);
    }

    if (results.length > 1) {
        throw new NotionExpenseError(`Multiple wallets match name ${name}`);
    }

    return results[0].id;
}

async function findWalletByCardLast4(cardLast4) {
    const results = await queryDatabase('wallet', {
        property: 'Name',
        title: { ends_with: ` - ${cardLast4}` },
    });

    if (results.length === 0) {
        throw new NotionExpenseError(`No wallet found for card ending ${cardLast4}`);
    }

    if (results.length > 1) {
        const names = results.map((page) => page.properties.Name.title[0]?.plain_text || page.id);
        throw new NotionExpenseError(`Multiple wallets match card ending ${cardLast4}: ${names.join(', ')}`);
    }

    return results[0].id;
}

async function findWalletForTransaction(transaction) {
    const { lookup, value } = resolveWalletLookup(transaction);

    if (lookup === 'name') {
        return findWalletByName(value);
    }

    return findWalletByCardLast4(value);
}

async function findDailyExpensePage(date) {
    const results = await queryDatabase('dailyExpense', {
        property: 'Date',
        date: { equals: date },
    });

    return results[0] || null;
}

async function findMonthlyExpensePage(date) {
    const name = monthlyExpenseName(date);
    const results = await queryDatabase('monthlyExpense', {
        property: 'Name',
        title: { equals: name },
    });

    return results[0] || null;
}

async function createDailyExpensePage(date) {
    const notion = getNotionClient();
    const dataSourceId = await getDataSourceId('dailyExpense');
    const page = await notion.pages.create({
        parent: { data_source_id: dataSourceId },
        icon: DAILY_EXPENSE_ICON,
        properties: {
            Name: {
                title: [{ text: { content: date } }],
            },
            Date: {
                date: { start: date },
            },
        },
    });

    return page.id;
}

async function createMonthlyExpensePage(date) {
    const notion = getNotionClient();
    const name = monthlyExpenseName(date);
    const dataSourceId = await getDataSourceId('monthlyExpense');
    const page = await notion.pages.create({
        parent: { data_source_id: dataSourceId },
        icon: MONTHLY_EXPENSE_ICON,
        properties: {
            Name: {
                title: [{ text: { content: name } }],
            },
        },
    });

    return page.id;
}

async function findOrCreatePeriodExpenses(date) {
    let dailyExpensePage = await findDailyExpensePage(date);
    if (!dailyExpensePage) {
        const dailyExpenseId = await createDailyExpensePage(date);
        dailyExpensePage = { id: dailyExpenseId };
    }

    let monthlyExpensePage = await findMonthlyExpensePage(date);
    if (!monthlyExpensePage) {
        const monthlyExpenseId = await createMonthlyExpensePage(date);
        monthlyExpensePage = { id: monthlyExpenseId };
    }

    return {
        dailyExpenseId: dailyExpensePage.id,
        monthlyExpenseId: monthlyExpensePage.id,
    };
}

function buildDedupFilter(expense) {
    const filters = [
        { property: 'Name', title: { equals: expense.name } },
        { property: 'Date', date: { equals: expense.date } },
    ];

    if (expense.foreignAmountField && expense.foreignAmount != null) {
        filters.push({
            property: expense.foreignAmountField,
            number: { equals: expense.foreignAmount },
        });
    } else {
        filters.push({
            property: 'Amount',
            number: { equals: expense.amountHkd },
        });
    }

    return { and: filters };
}

async function findDuplicateExpense(expense) {
    const results = await queryDatabase('expenses', buildDedupFilter(expense));
    return results[0] || null;
}

function buildExpenseProperties(expense, walletId, periodIds) {
    const properties = {
        Name: {
            title: [{ text: { content: expense.name } }],
        },
        Date: {
            date: { start: expense.date },
        },
        Amount: {
            number: expense.amountHkd,
        },
        Wallet: {
            relation: [{ id: walletId }],
        },
        'Daily Expense': {
            relation: [{ id: periodIds.dailyExpenseId }],
        },
        'Monthly Expense': {
            relation: [{ id: periodIds.monthlyExpenseId }],
        },
    };

    if (expense.categoryId) {
        properties.Category = {
            relation: [{ id: expense.categoryId }],
        };
    }

    if (expense.foreignAmountField && expense.foreignAmount != null) {
        properties[expense.foreignAmountField] = {
            number: expense.foreignAmount,
        };
    }

    if (expense.exchangeRateText) {
        properties['Exchange Rate'] = {
            rich_text: [{ text: { content: expense.exchangeRateText } }],
        };
    }

    return properties;
}

async function createExpenseIfNew(expense, walletId, periodIds) {
    const duplicate = await findDuplicateExpense(expense);
    if (duplicate) {
        return {
            status: 'duplicate',
            pageId: duplicate.id,
        };
    }

    const notion = getNotionClient();
    const dataSourceId = await getDataSourceId('expenses');
    const page = await notion.pages.create({
        parent: { data_source_id: dataSourceId },
        icon: resolveExpenseIcon(expense),
        properties: buildExpenseProperties(expense, walletId, periodIds),
    });

    return {
        status: 'created',
        pageId: page.id,
        name: expense.name,
        date: expense.date,
        amountHkd: expense.amountHkd,
    };
}

module.exports = {
    NotionExpenseError,
    PAYPLUS_WALLET_NAME,
    resolveWalletLookup,
    findWalletByCardLast4,
    findWalletByName,
    findWalletForTransaction,
    findOrCreatePeriodExpenses,
    createExpenseIfNew,
    monthlyExpenseName,
    DEFAULT_DATABASE_IDS,
};
