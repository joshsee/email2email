# BOC Receipt to Notion — Plan and Implementation

**Pull request:** https://github.com/joshsee/email2email/pull/9  
**Branch:** `feat/boc-receipt-to-notion`

This document records the original requirements, design decisions, and what was built.

---

## Goal

Extend the existing SendGrid inbound webhook so emails forwarded to **`receipt@littleplan.com`** are parsed for Bank of China (BOC) transaction details and written as new rows in the Notion **Expenses** database under **Expense Journal**.

Receipt emails are **not** forwarded to `TO_EMAIL_ADDRESS`. All other inbound mail continues to forward via SendGrid as before.

---

## Architecture

```
SendGrid Inbound Parse
        │
        ▼
/api/email2email  (Vercel serverless)
        │
        ├── to ≠ receipt@littleplan.com ──► forward via SendGrid (existing behaviour)
        │
        └── to = receipt@littleplan.com
                │
                ├── parse email body (credit card or Pay+ format)
                ├── apply merchant rename + category rules
                ├── resolve amounts (HKD direct, or FX conversion)
                ├── lookup Wallet by card last 4 digits
                ├── find/create Daily + Monthly Expense pages
                ├── deduplicate, then create Notion Expense row
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
- Wallet lookup uses the card number from `Top-up Account No.`.

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
| **Wallet** | Relation — matched by card last 4, e.g. `Go R - 1110` |
| **Category** | Relation — set when merchant matches a rule; otherwise blank |
| **Daily Expense** | Relation — page where `Date` = transaction date (created if missing) |
| **Monthly Expense** | Relation — page named `YYYY MM`, e.g. `2026 06` (created if missing) |

### Notion databases

| Database | ID |
|---|---|
| Expenses | `8c07d787-86bd-4643-8d68-92b85f3b7a04` |
| Wallet | `aada623f-ef44-4240-a3d0-992dc4991ed1` |
| Category | (relation targets only — see merchant rules) |
| Daily Expense | `31634792-2fcd-40d1-a5f5-8b7c9f01cefe` |
| Monthly Expense | `6e82eeb3-4fe7-43f5-b3dc-66fce198ab20` |

### Wallet lookup

Wallet names follow `{label} - {last4}` (e.g. `Go R - 1110`, `Go J - 0112`).

Query: Notion filter `Name` **ends with** ` - {cardLast4}`.

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

Category page IDs are hardcoded in `lib/merchantRules.js`. Unmatched merchants keep the raw name and leave Category blank.

To add a new merchant: edit the `RULES` array in `lib/merchantRules.js`.

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
| `NOTION_EXPENSES_DATABASE_ID` | Optional | Defaults to Expenses DB ID above |
| `NOTION_WALLET_DATABASE_ID` | Optional | Defaults to Wallet DB ID above |
| `NOTION_DAILY_EXPENSE_DATABASE_ID` | Optional | Defaults to Daily Expense DB ID above |
| `NOTION_MONTHLY_EXPENSE_DATABASE_ID` | Optional | Defaults to Monthly Expense DB ID above |
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
| `lib/parseBocTransaction.js` | Parse credit card and Pay+ email formats |
| `lib/merchantRules.js` | Merchant rename + Category mapping |
| `lib/exchangeRate.js` | Frankfurter FX lookup and HKD conversion |
| `lib/notionExpense.js` | Notion API: wallet lookup, period pages, expense create, dedup |
| `lib/receiptHandler.js` | Orchestrates the receipt processing pipeline |
| `lib/stripHtml.js` | HTML-to-text fallback when plain text is empty |
| `lib/receipt.test.js` | Unit tests for parser, rules, FX formatting |
| `public/index.html` | Landing page |
| `vercel.json` | Vercel function config |
| `.env.example` | Environment variable template |
| `IMPLEMENTATION.md` | This document |

### Modified files

| File | Change |
|---|---|
| `api/email2email.js` | Branch on `receipt@littleplan.com`; call receipt handler before forward logic |
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
| Parse failure | 422 | `{ status: "error", message: "..." }` |
| Wallet not found | 422 | `{ status: "error", message: "No wallet found for card ending ..." }` |
| FX lookup failed | 422 | `{ status: "error", message: "..." }` |
| Notion API error | 500 | `{ status: "error", message: "..." }` |

---

## Testing

```bash
npm test
```

12 tests cover:

- Existing email forward/parse behaviour (6 tests)
- Credit card HKD and CNY parsing
- BoC Pay+ parsing
- Merchant rules (ParkNShop, Taobao, Citybus)
- Exchange rate text formatting
- Monthly expense name generation

### Manual smoke test

```bash
curl -X POST http://localhost:3000/api/email2email \
  -F 'from=bank@example.com' \
  -F 'to=receipt@littleplan.com' \
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
| Dedup key | Name + Date + amount (foreign field if applicable) | Avoids duplicates on SendGrid retry |

---

## Out of scope (future work)

- Attachment / receipt file upload to Notion `Receipt` field
- `Reference No.` deduplication for Pay+ transactions
- Additional merchant rules beyond the six listed
- Currencies beyond CNY, USD, MYR, SGD
