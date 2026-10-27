const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const puppeteer = require('puppeteer-extra');

puppeteer.use(require('puppeteer-extra-plugin-stealth')());

const URL = 'https://logammulia.com/harga-emas';
const RANGE = process.env.LM_RANGE || '1 Bulan';
const DAY_MS = 86_400_000;

const TABS = {
  sell: 'Harga Beli',
  buyback: 'Harga Jual',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Timestamp sumber diperlakukan sebagai waktu lokal yang dikodekan sebagai UTC.
// Tidak menambahkan offset WIB.
function normalize(points) {
  if (!Array.isArray(points) || !points.length) {
    throw new Error('Data grafik kosong');
  }

  const days = new Map();

  for (const [timestamp, value] of points) {
    const price = Number(value);

    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < 1e12 ||
      timestamp > 4.1e12 ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error(`Data tidak valid: ${JSON.stringify([timestamp, value])}`);
    }

    const date = new Date(timestamp);

    // Pertahankan konvensi histori lama: tanggal pada 08:30 UTC.
    const day = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      8, 30
    );

    days.set(day, price);
  }

  return [...days].sort((a, b) => a[0] - b[0]);
}

function merge(existing, fresh, label) {
  const days = new Map();

  for (const row of existing) {
    const day = Math.floor(row[0] / DAY_MS);

    if (!days.has(day)) days.set(day, []);
    days.get(day).push(row);
  }

  let overlap = 0;
  let mismatch = 0;
  let added = 0;
  let replaced = 0;

  for (const [timestamp, price] of fresh) {
    const previous = days.get(Math.floor(timestamp / DAY_MS));

    if (previous) {
      overlap++;

      if (!previous.some(row => row[1] === price)) {
        mismatch++;
      }
    }
  }

  if (
    process.env.FORCE !== '1' &&
    overlap >= 3 &&
    mismatch / overlap > 0.5
  ) {
    throw new Error(
      `${label}: ${mismatch}/${overlap} harga historis tidak cocok`
    );
  }

  for (const row of fresh) {
    const day = Math.floor(row[0] / DAY_MS);
    const previous = days.get(day);

    if (!previous) {
      days.set(day, [row]);
      added++;
    } else if (!previous.some(old => old[1] === row[1])) {
      days.set(day, [row]);
      replaced++;
    }
  }

  return {
    rows: [...days.values()].flat().sort((a, b) => a[0] - b[0]),
    added,
    replaced,
  };
}

function hookCharts() {
  let ApexCharts;

  Object.defineProperty(window, 'ApexCharts', {
    configurable: true,
    get: () => ApexCharts,

    set(value) {
      ApexCharts = value;

      const proto = value?.prototype;
      if (!proto || typeof proto.render !== 'function' || proto.__lmPatched) {
        return;
      }

      const render = proto.render;

      proto.render = function (...args) {
        (window.__lmCharts ||= []).push(this);
        return render.apply(this, args);
      };

      proto.__lmPatched = true;
    },
  });
}

function readChart() {
  const charts = window.__lmCharts || [];

  for (const chart of [...charts].reverse()) {
    if (
      !chart?.el?.isConnected ||
      !chart.el.getClientRects().length ||
      !chart.w?.config
    ) {
      continue;
    }

    const { config, globals } = chart.w;
    const categories = config.xaxis?.categories?.length
      ? config.xaxis.categories
      : globals.categoryLabels || [];

    for (const series of config.series || []) {
      const points = (series.data || []).map((item, index) => {
        if (Array.isArray(item)) return [item[0], item[1]];

        if (item && typeof item === 'object') {
          return [item.x ?? categories[index], item.y];
        }

        return [categories[index], item];
      });

      if (points.length >= 2) {
        return { name: series.name, points };
      }
    }
  }

  return null;
}

async function dismissDialog(page) {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll(
      '.v-dialog__content--active button, .v-dialog--active button'
    )) {
      if (button.innerText.trim().toLowerCase() === 'ok') {
        button.click();
      }
    }
  });
}

async function waitChart(page, previous = null) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    await dismissDialog(page);

    const chart = await page.evaluate(readChart);

    if (chart && JSON.stringify(chart.points) !== previous) {
      return chart;
    }

    await sleep(500);
  }

  throw new Error('Grafik tidak ditemukan atau belum diperbarui');
}

async function select(page, selector, label, type) {
  const before = await page.evaluate(readChart);
  const previous = before ? JSON.stringify(before.points) : null;

  const response = page.waitForResponse(
    res => res.url().includes('/commodity-v2/'),
    { timeout: 8000 }
  ).catch(() => null);

  const status = await page.evaluate(({ selector, label, type }) => {
    const element = [...document.querySelectorAll(selector)].find(
      el => el.getClientRects().length &&
        el.innerText.trim().toLowerCase() === label.toLowerCase()
    );

    if (!element) return 'missing';

    const active = type === 'tab'
      ? element.getAttribute('aria-selected') === 'true'
      : element.classList.contains('active');

    if (active) return 'already';

    element.click();
    return 'clicked';
  }, { selector, label, type });

  if (status === 'missing') {
    throw new Error(`Pilihan "${label}" tidak ditemukan`);
  }

  if (status === 'clicked') {
    await response;
    await waitChart(page, previous);
  }
}

async function scrape() {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false',
    ...(process.env.CHROME_PATH && {
      executablePath: process.env.CHROME_PATH,
    }),
    ...(process.env.NO_SANDBOX === 'true' && {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }),
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1366, height: 900 });
    await page.evaluateOnNewDocument(hookCharts);

    console.log(`[lm] Membuka ${URL}`);

    const response = await page.goto(URL, {
      waitUntil: 'networkidle2',
      timeout: 90000,
    });

    if (!response?.ok()) {
      throw new Error(`HTTP ${response?.status()}`);
    }

    await waitChart(page);

    const result = {};

    for (const [key, label] of Object.entries(TABS)) {
      console.log(`[lm] Mengambil ${label}`);

      await select(page, '[role="tab"]', label, 'tab');
      await select(page, '.default-badge', RANGE, 'range');

      const chart = await waitChart(page);
      result[key] = normalize(chart.points);

      console.log(`[lm] ${key}: ${result[key].length} titik (${chart.name})`);
    }

    return result;
  } finally {
    await browser.close();
  }
}

async function readExisting(filename) {
  try {
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));

    return {
      sell: data.sell || [],
      buyback: data.buyback || [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { sell: [], buyback: [] };
    }

    throw error;
  }
}

async function save(filename, data) {
  try {
    const old = JSON.parse(await fs.readFile(filename, 'utf8'));

    if (JSON.stringify(old) === JSON.stringify(data)) {
      return false;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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

  const [fresh, existing] = await Promise.all([
    scrape(),
    readExisting(filename),
  ]);

  const sell = merge(existing.sell, fresh.sell, 'SELL');
  const buyback = merge(existing.buyback, fresh.buyback, 'BUYBACK');

  const history = {
    provider: 'antam',
    source: 'logammulia',
    currency: 'IDR',
    unit: 'gram',
    sell: sell.rows,
    buyback: buyback.rows,
  };

  console.log(
    `SELL: +${sell.added} baru, ${sell.replaced} diganti, total ${sell.rows.length}`
  );

  console.log(
    `BUYBACK: +${buyback.added} baru, ${buyback.replaced} diganti, total ${buyback.rows.length}`
  );

  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN: file tidak diubah');
    return;
  }

  const changed = await save(filename, history);

  console.log(
    `${changed ? 'Diperbarui' : 'Tidak berubah'}: ${filename}`
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Scrape gagal: ${error.message}`);
    process.exitCode = 1;
  });
}
