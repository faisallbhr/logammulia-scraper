const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.logammulia.com';

async function fetchHistory(page, url, label) {
  const response = await page.evaluate(async (endpoint) => {
    const result = await fetch(endpoint, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(60000),
    });

    return {
      ok: result.ok,
      status: result.status,
      text: await result.text(),
    };
  }, url);

  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }

  let data;

  try {
    data = JSON.parse(response.text);
  } catch {
    throw new Error(
      `${label}: respons bukan JSON, kemungkinan disebabkan CAPTCHA atau challenge`
    );
  }

  return normalizeHistory(data, label);
}

function normalizeHistory(data, label) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${label}: data historis kosong atau bukan array`);
  }

  const records = new Map();

  for (const [index, row] of data.entries()) {
    if (!Array.isArray(row) || row.length !== 2) {
      throw new Error(`${label}: format baris pada indeks ${index} tidak valid`);
    }

    if (
      row.some(
        (value) =>
          !['number', 'string'].includes(typeof value) ||
          String(value).trim() === ''
      )
    ) {
      throw new Error(`${label}: nilai pada baris ${index} tidak valid`);
    }

    const timestamp = Number(row[0]);
    const price = Number(row[1]);

    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0 ||
      Number.isNaN(new Date(timestamp).getTime()) ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error(`${label}: timestamp atau harga pada baris ${index} tidak valid`);
    }

    if (records.has(timestamp) && records.get(timestamp) !== price) {
      throw new Error(`${label}: harga berbeda untuk timestamp ${timestamp}`);
    }

    records.set(timestamp, price);
  }

  // Pertahankan timestamp milidetik dari data grafik asli.
  return [...records.entries()].sort((a, b) => a[0] - b[0]);
}

async function scrape() {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false',
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    ...(process.env.NO_SANDBOX === 'true'
      ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
      : {}),
  });

  try {
    const page = await browser.newPage();

    const response = await page.goto(`${BASE_URL}/id`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    if (!response?.ok()) {
      throw new Error(
        `Beranda: HTTP ${response?.status() ?? 'tidak ada respons'}`
      );
    }

    await page.waitForSelector('input[name="_token"]', {
      timeout: 30000,
    });

    const token = await page.$eval(
      'input[name="_token"]',
      (element) => element.value
    );

    if (!token) {
      throw new Error('Token CSRF kosong');
    }

    const encodedToken = encodeURIComponent(token);

    const [sell, buyback] = await Promise.all([
      fetchHistory(
        page,
        `${BASE_URL}/data-base-price/gold_eai/sell?_token=${encodedToken}&transition=1`,
        'SELL'
      ),
      fetchHistory(
        page,
        `${BASE_URL}/data-base-price/gold/buy?_token=${encodedToken}`,
        'BUYBACK'
      ),
    ]);

    return {
      provider: 'antam',
      source: 'logammulia',
      currency: 'IDR',
      unit: 'gram',
      sell,
      buyback,
    };
  } finally {
    await browser.close();
  }
}

async function saveIfChanged(filename, data) {
  try {
    const previousContents = await fs.readFile(filename, 'utf8');

    if (previousContents.trim() !== '') {
      const previous = JSON.parse(previousContents);

      if (JSON.stringify(previous) === JSON.stringify(data)) {
        return false;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(filename), { recursive: true });

  const temporary = `${filename}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(
      temporary,
      `${JSON.stringify(data, null, 2)}\n`,
      { flag: 'wx' }
    );

    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }

  return true;
}

async function main() {
  const filename = path.resolve(
    process.argv[2] || 'web/data/gold-history.json'
  );

  const history = await scrape();
  const changed = await saveIfChanged(filename, history);

  console.log(`${changed ? 'Diperbarui' : 'Tidak berubah'}: ${filename}`);
  console.log(`SELL: ${history.sell.length} data`);
  console.log(`BUYBACK: ${history.buyback.length} data`);
}

main().catch((error) => {
  console.error(`Scrape gagal: ${error.message}`);
  process.exitCode = 1;
});
