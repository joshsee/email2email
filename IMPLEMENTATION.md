# BOC Receipt to Notion — Plan and Implementation

This document records the original requirements, design decisions, and what was built.

Follow-up PRs after the initial implementation:

| PR | Change |
|---|---|
| [#10](https://github.com/joshsee/email2email/pull/10) | Notion SDK v5 (`dataSources.query`, `data_source_id` parents) |
| [#11](https://github.com/joshsee/email2email/pull/11) | Pay+ wallet maps to `BoC Pay`; receipt sender authorization |
| [#12](https://github.com/joshsee/email2email/pull/12) | Notion page icons on create |
| [#13](https://github.com/joshsee/email2email/pull/13) | `README.md` |
| [#14](https://github.com/joshsee/email2email/pull/14) | Card `1110` skips merchant rename rules |
| [#15](https://github.com/joshsee/email2email/pull/15) | README Mermaid fix; scrub personal addresses from docs |
| [#16](https://github.com/joshsee/email2email/pull/16) | Notion IDs and receipt config moved to required env vars |

---

## Goal

Extend the existing SendGrid inbound webhook so emails forwarded to **`receipt@your-domain.com`** are parsed for Bank of China (BOC) transaction details and written as new rows in the Notion **Expenses** database under **Expense Journal**.

Receipt emails are **not** forwarded to `TO_EMAIL_ADDRESS`. All other inbound mail continues to forward via SendGrid as before.

---

## Architecture

```
SendGrid Inbound Parse
        │
        ▼
/api/email2email  (Vercel serverless)
        │
        ├── to ≠ RECEIPT_EMAIL ──► forward via SendGrid (existing behaviour)
        │
        └── to = RECEIPT_EMAIL
                │
                ├── from ≠ RECEIPT_AUTHORIZED_SENDER ──► 403 Unauthorized
                │
                ├── parse email body (credit card, Pay+, or Direct Debit format)
                ├── apply merchant rename + category rules (card-specific bypasses apply)
                ├── resolve amounts (HKD direct, or FX conversion)
                ├── lookup Wallet (card last 4; BoC Pay for Pay+; Cash for Direct Debit)
                ├── find/create Daily + Monthly Expense pages
                ├── deduplicate, then create Notion Expense row (with icon)
                └── return JSON { status: "created" | "duplicate" }
```

---

## Email formats supported

### Format A — Credit card notification

```
Card Account Number Ending with: 1110
Transaction Date: 23/06
Merchant Name: AlipayHK*SoFast
Transaction Amount: HKD62.00
```

- Date is `DD/MM` without year; year is inferred (current year, minus one if the date would be >7 days in the future).
- Amount pattern: `HKD62.00` (no space between currency and value).

### Format B — BoC Pay+ wallet notification

Detected when the body contains `Pay+ Wallet` or `Top-up Account No.`:

```
Top-up Account No. : BOC Card Ending [0112]
Transaction Date : 2026/06/21
Merchant : MT CITYBUS
Amount : HKD 4.40
```

- Date is full `YYYY/MM/DD` — no year inference.
- Amount pattern: `HKD 4.40` (space between currency and value).
- Wallet lookup uses the Notion wallet named **`BoC Pay`** (not card last 4).

### Format C — Direct Debit notification

Detected when the body contains `Direct Debit`:

```
Notice of Direct Debit transaction
Transaction Type: Direct Debit
Transaction Date: 2026/06/25
Payee's A/C No: 001..001
Payee: CLP POWER HK LTD
Withdrawal A/C No.: 011..666
Amount: HKD 121.00
Debtor's Reference: ...9256
```

- Date is full `YYYY/MM/DD` — no year inference.
- Merchant comes from the `Payee:` line (the `^Payee:` anchor avoids matching `Payee's A/C No:`).
- Amount pattern: `HKD 121.00` (space between currency and value).
- No card number; wallet lookup uses the Notion wallet named **`Cash`**.
- `Debtor's Reference` is captured as `referenceNo` (not yet used for dedup).

### Foreign currency (Format A)

```
Transaction Amount: CNY12.80
```

Supported currencies: **HKD**, **CNY**, **CNH** (treated as CNY), **USD**, **MYR**, **SGD**.

For non-HKD amounts:

1. Store the original amount in the matching Notion field (`Amount CNY`, etc.).
2. Fetch the **transaction-date** FX rate from [Frankfurter API](https://www.frankfurter.app/).
3. Convert to HKD and populate the `Amount` field.
4. Set `Exchange Rate` text, e.g. `1CNY=1.15970HKD`.

---

## Notion field mapping

| Notion field | Source |
|---|---|
| **Name** | Merchant name after rename rules (or raw merchant if no match) |
| **Date** | Transaction date (ISO `YYYY-MM-DD`) |
| **Amount** | HKD amount (direct or converted), 1 decimal place |
| **Amount CNY / USD / MYR / SGD** | Original foreign amount when applicable, 2 decimal places |
| **Exchange Rate** | Text, e.g. `1CNY=1.15970HKD` (5 decimal rate) |
| **Wallet** | Relation — see [Wallet lookup](#wallet-lookup) below |
| **Category** | Relation — set when merchant matches a rule; otherwise blank |
| **Daily Expense** | Relation — page where `Date` = transaction date (created if missing) |
| **Monthly Expense** | Relation — page named `YYYY MM`, e.g. `2026 06` (created if missing) |

### Notion databases

Configure database and category page IDs via environment variables (see [Environment variables](#environment-variables)). Do not commit real Notion IDs to the public repository.

| Database | Env var |
|---|---|
| Expenses | `NOTION_EXPENSES_DATABASE_ID` |
| Wallet | `NOTION_WALLET_DATABASE_ID` |
| Category pages | `NOTION_CATEGORY_*_ID` (per category) |
| Daily Expense | `NOTION_DAILY_EXPENSE_DATABASE_ID` |
| Monthly Expense | `NOTION_MONTHLY_EXPENSE_DATABASE_ID` |

Copy database IDs from the Notion URL when viewing each database (`.../{database_id}?v=...`).
Copy category page IDs from each Category row URL (`.../{page_id}`).

### Wallet lookup

| Email type | Lookup |
|---|---|
| Credit card | Notion Wallet `Name` **ends with** ` - {cardLast4}` (e.g. `Go R - 1110`) |
| BoC Pay+ | Exact wallet name **`BoC Pay`** |
| Direct Debit | Exact wallet name **`Cash`** |

### Notion API (SDK v5)

`@notionhq/client` v5 uses Notion API `2025-09-03`:

- **Query** databases via `notion.dataSources.query({ data_source_id, filter })`
- **Create** pages with `parent: { data_source_id }` (not `database_id`)
- Data source IDs are resolved from `notion.databases.retrieve()` and cached per database

Implemented in `lib/notionExpense.js`.

### Page icons

New pages get a Notion native icon at create time (`lib/expenseIcon.js`):

| Target | Icon |
|---|---|
| Gym - LCSD / Sports | dumbbell |
| ParkNShop / Grocery | banana |
| Citybus / Transport | bus |
| MTR | train |
| Taobao / Shopping | shopping-bag |
| CLP - Monaco / Bills & Utilities | zap |
| Unknown merchants | credit-card |
| Daily Expense (new) | calendar-day |
| Monthly Expense (new) | calendar |

---

## Merchant rules

Keyword matching is **case-insensitive substring**. First matching rule wins.

| Keyword(s) in merchant | Notion Name | Category |
|---|---|---|
| `LCSD`, `SMARTPLAY` | Gym - LCSD | Sports |
| `PARKNSHOP` | ParkNShop | Grocery |
| `CITYBUS` | Citybus | Transport |
| `MTR` | MTR | Transport |
| `TAOBAO` | Taobao | Shopping |
| `CLP POWER` | CLP - Monaco | Bills & Utilities |

Category page IDs come from `NOTION_CATEGORY_*_ID` environment variables. Unmatched merchants keep the raw name and leave Category blank.

### Card-specific bypass

Cards listed in `EXACT_MERCHANT_CARD_LAST4` (currently **`1110`**) skip rename and category rules entirely. The raw merchant name from the email is used and Category is left blank.

To add a new merchant: edit the `RULES` array in `lib/merchantRules.js`.  
To add a card bypass: add the last 4 digits to `EXACT_MERCHANT_CARD_LAST4` in the same file.

---

## Receipt security

Receipt routing and authorization are configured entirely via environment variables in `lib/receiptHandler.js`. There are **no hardcoded addresses or fallbacks** in code.

| Variable | Required | Behaviour when unset |
|---|---|---|
| `RECEIPT_EMAIL` | Yes | `isReceiptEmail()` returns false — mail is forwarded like any other inbound message |
| `RECEIPT_AUTHORIZED_SENDER` | Yes | `isAuthorizedReceiptSender()` returns false — receipt address mail gets **403** |

Receipt processing only runs when **both** are true:

- **To** matches `RECEIPT_EMAIL` (case-insensitive)
- **From** matches `RECEIPT_AUTHORIZED_SENDER` (case-insensitive)

Unauthorized senders receive HTTP **403** with `{ status: "error", message: "Unauthorized receipt sender" }`. The email is not parsed, not forwarded, and nothing is written to Notion.

Set both in Vercel (Production and Preview) before deploying the receipt flow. See [`.env.example`](.env.example).

---

## Deduplication

Before creating a Notion row, the app queries for an existing expense with the same:

- **HKD transactions:** `Name` + `Date` + `Amount`
- **Foreign currency:** `Name` + `Date` + foreign amount field (e.g. `Amount CNY`)

If found, returns `{ status: "duplicate", pageId }` with HTTP 200 (safe for SendGrid retries).

---

## Landing page and SEO

| Path | Behaviour |
|---|---|
| `/` | Static `public/index.html` — displays "Nothing to see here" |
| `/api`, `/api/index` | Returns same message with `X-Robots-Tag: noindex, nofollow, noarchive` |
| `/robots.txt` | `Disallow: /` for all crawlers |

---

## Environment variables

See [`.env.example`](.env.example).

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_API_KEY` | Yes (receipt flow) | Notion integration secret |
| `RECEIPT_EMAIL` | Yes (receipt flow) | Inbound address for BOC receipt processing; must match SendGrid parse setting |
| `RECEIPT_AUTHORIZED_SENDER` | Yes (receipt flow) | Sender allowed for receipt processing; no code default |
| `NOTION_EXPENSES_DATABASE_ID` | Yes (receipt flow) | Expenses database ID |
| `NOTION_WALLET_DATABASE_ID` | Yes (receipt flow) | Wallet database ID |
| `NOTION_DAILY_EXPENSE_DATABASE_ID` | Yes (receipt flow) | Daily Expense database ID |
| `NOTION_MONTHLY_EXPENSE_DATABASE_ID` | Yes (receipt flow) | Monthly Expense database ID |
| `NOTION_CATEGORY_SPORTS_ID` | Optional | Category page ID for Sports merchants |
| `NOTION_CATEGORY_GROCERY_ID` | Optional | Category page ID for Grocery merchants |
| `NOTION_CATEGORY_TRANSPORT_ID` | Optional | Category page ID for Transport merchants |
| `NOTION_CATEGORY_SHOPPING_ID` | Optional | Category page ID for Shopping merchants |
| `NOTION_CATEGORY_BILLS_ID` | Optional | Category page ID for Bills & Utilities merchants |
| `SENDGRID_API_KEY` | Yes (non-receipt mail) | Existing forward behaviour |
| `TO_EMAIL_ADDRESS` | Yes (non-receipt mail) | Existing forward destination |

### Notion setup (one-time)

1. Create an integration at https://www.notion.so/my-integrations
2. Share these databases with the integration (⋯ → Connections):
   - Expenses, Wallet, Category, Daily Expense, Monthly Expense
3. Add `NOTION_API_KEY` to Vercel (Production + Preview)

---

## Deployment (Vercel)

- Webhook URL: `https://<your-vercel-domain>/api/email2email`
- [`vercel.json`](vercel.json) sets `maxDuration: 30` on the webhook function (headroom for Notion + FX API calls).
- Local dev: `vercel dev`, then POST multipart form data to `http://localhost:3000/api/email2email`.

---

## Files changed

### New files

| File | Purpose |
|---|---|
| `lib/parseBocTransaction.js` | Parse credit card, Pay+, and Direct Debit email formats |
| `lib/merchantRules.js` | Merchant rename + Category mapping |
| `lib/exchangeRate.js` | Frankfurter FX lookup and HKD conversion |
| `lib/notionExpense.js` | Notion API: wallet lookup, period pages, expense create, dedup, icons |
| `lib/expenseIcon.js` | Notion native icon selection for new pages |
| `lib/receiptHandler.js` | Orchestrates the receipt processing pipeline |
| `lib/stripHtml.js` | HTML-to-text fallback when plain text is empty |
| `lib/receipt.test.js` | Unit tests for parser, rules, FX, wallet routing, icons |
| `README.md` | Project overview and setup guide |
| `public/index.html` | Landing page |
| `vercel.json` | Vercel function config |
| `.env.example` | Environment variable template |
| `IMPLEMENTATION.md` | This document |

### Modified files

| File | Change |
|---|---|
| `api/email2email.js` | Branch on `receipt@your-domain.com`; call receipt handler before forward logic |
| `api/index.js` | "Nothing to see here" + `X-Robots-Tag` header |
| `package.json` | Added `@notionhq/client` dependency |
| `package-lock.json` | Lockfile updated |
| `.gitignore` | Added `forever/`, `.DS_Store` |

### Unchanged

| File | Notes |
|---|---|
| `api/email2email.test.js` | Existing forward/parse tests still pass |
| `robots.txt` | Already blocked all crawlers |

---

## API responses (receipt path)

| Scenario | HTTP | Body |
|---|---|---|
| Expense created | 200 | `{ status: "created", pageId, name, date, amountHkd }` |
| Duplicate | 200 | `{ status: "duplicate", pageId }` |
| Unauthorized sender | 403 | `{ status: "error", message: "Unauthorized receipt sender" }` |
| Parse failure | 422 | `{ status: "error", message: "..." }` |
| Wallet not found | 422 | `{ status: "error", message: "No wallet found for card ending ..." }` |
| FX lookup failed | 422 | `{ status: "error", message: "..." }` |
| Notion API error | 500 | `{ status: "error", message: "..." }` |

---

## Testing

```bash
npm test
```

13 tests in `lib/receipt.test.js` cover:

- Credit card HKD and CNY parsing
- BoC Pay+ parsing
- Direct Debit parsing
- Merchant rules (ParkNShop, Taobao, Citybus, CLP POWER)
- Card `1110` exact-merchant bypass
- Exchange rate text formatting
- Monthly expense name generation
- Pay+ / Direct Debit / credit card wallet routing
- Receipt sender authorization
- Expense icon resolution

6 tests in `api/email2email.test.js` cover existing email forward/parse behaviour.

### Manual smoke test

```bash
curl -X POST http://localhost:3000/api/email2email \
  -F 'from=bank@example.com' \
  -F 'to=receipt@your-domain.com' \
  -F 'subject=BOC Transaction' \
  -F 'text=Card Account Number Ending with: 1110
Transaction Date: 23/06
Merchant Name: AlipayHK*SoFast
Transaction Amount: HKD62.00'
```

Requires `NOTION_API_KEY` and database access configured locally.

---

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Receipt email handling | Notion only, no forward | Per user preference |
| Category for unknown merchants | Leave blank | Per user preference |
| FX rate date | Transaction date | Matches expense date; confirmed by user |
| Daily/Monthly Expense | Find or create by transaction date | User requested explicit linking |
| FX source | Frankfurter API | Free, no API key, supports historical dates |
| Pay+ vs credit card detection | Try Pay+ first | More specific markers reduce false matches |
| Pay+ wallet lookup | Exact name `BoC Pay` | Pay+ is a separate wallet, not card-suffix matched |
| Direct Debit wallet lookup | Exact name `Cash` | No card number on direct debit; tracked as cash per user |
| Receipt security | Authorized sender only | Prevent arbitrary inbound receipt processing |
| Card `1110` merchants | Exact name, no rules | Per-user preference for one card |
| Notion SDK | v5 / API 2025-09-03 | `dataSources` API required for query/create |
| Page icons | Native Notion icons on create | Visual consistency in Expense Journal |
| Dedup key | Name + Date + amount (foreign field if applicable) | Avoids duplicates on SendGrid retry |

---

## Out of scope (future work)

- Attachment / receipt file upload to Notion `Receipt` field
- `Reference No.` deduplication for Pay+ transactions
- Additional merchant rules beyond the six listed
- Currencies beyond CNY, USD, MYR, SGD
