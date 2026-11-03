# Logam Mulia Scraper

Automated ANTAM gold price scraper with historical data, daily updates, Telegram alerts, and interactive charts.

**[View live gold price history](https://faisallbhr.github.io/logammulia-scraper/)**

## Overview

This project collects ANTAM gold sell and buyback price history from [Logam Mulia](https://logammulia.com/harga-emas), stores the data as JSON, and displays it in a lightweight static website.

The scraper uses **Lightpanda** with **Puppeteer Core** to read price data from the site's charts. GitHub Actions runs it daily, commits any data changes, and redeploys the website only when the historical dataset changes.

## Features

- Scrapes ANTAM sell and buyback price history
- Merges new observations with existing historical data
- Validates incoming data and detects suspicious historical mismatches
- Preserves timestamps supplied by the source
- Sends Telegram notifications after successful scraping, even when data is unchanged
- Publishes interactive historical charts through GitHub Pages
- Runs automatically every day at **08:30 WIB** (01:30 UTC)

## Getting started

> Prerequisites: Node.js 22 (recommended, matching the GitHub Actions environment) and npm.

```bash
git clone https://github.com/faisallbhr/logammulia-scraper.git
cd logammulia-scraper
npm ci
npx lightpanda install
```

Set the Telegram environment variables before running the scraper:

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
npm run scrape
```

To inspect scraping results without modifying the JSON file or sending a Telegram notification:

```bash
DRY_RUN=1 npm run scrape
```

The scraper uses the **1 Bulan** chart range by default. You can override the selected range using `LM_RANGE`, provided that label is available on the source website.

## Data format

The generated dataset is stored at [`web/data/gold-history.json`](web/data/gold-history.json).

```json
{
  "provider": "antam",
  "source": "logammulia",
  "currency": "IDR",
  "unit": "gram",
  "sell": [[1793089800000, 2500000]],
  "buyback": [[1793089800000, 2350000]]
}
```

Each entry is a `[timestamp, price]` pair: a Unix timestamp in milliseconds and a price in Indonesian rupiah per gram. The values above are illustrative, not live prices. The scraper retains source timestamps without applying a timezone offset.

## Automation

The [scraping workflow](.github/workflows/scrape.yml) runs daily at **08:30 WIB** and can also be started manually through GitHub Actions.

1. Scrape and validate the latest price history.
2. Update the JSON file if its contents changed.
3. Send a Telegram notification for each successful run.
4. Commit changed data and deploy the static site only when necessary.

To enable Telegram notifications in GitHub Actions, add these **repository secrets** under **Settings → Secrets and variables → Actions**:

| Secret | Description |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Destination chat ID |

> **Scheduling note:** The 08:30 WIB schedule is a target, not a guaranteed execution time. GitHub Actions may delay scheduled workflows when runner capacity is limited or the Actions service is experiencing high load. In some cases, scheduled runs may even be dropped. As a result, scraping, Telegram notifications, and website updates may occur later than 08:30 WIB. The workflow can also be triggered manually if needed.

## Project structure

```text
.github/workflows/
  scrape.yml           # Daily scraping and conditional deployment
  deploy.yml           # GitHub Pages deployment
scraper/
  index.js             # Scraping, validation, merging, and persistence
  telegram.js          # Telegram notification formatting and delivery
web/
  assets/              # Website styles, scripts, and icons
  data/gold-history.json
  index.html           # Static chart interface
```

## Disclaimer

This is an independent project and is not affiliated with or endorsed by ANTAM or Logam Mulia. Price information is provided for informational purposes and may differ from current official prices. Refer to the [official Logam Mulia website](https://logammulia.com/harga-emas) before making financial decisions.
