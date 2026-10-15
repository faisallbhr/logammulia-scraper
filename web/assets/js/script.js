const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

// Sumber mengodekan waktu WIB sebagai timestamp UTC.
const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateLabel = timestamp => dateFormatter.format(new Date(timestamp));
const dayKey = timestamp => {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const dayTimestamp = date => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
let data;
let chart;
let historyRows = [];
let historyPage = 1;
const historyPageSize = 25;

function validateSeries(series, label) {
  if (!Array.isArray(series) || !series.length) {
    throw new Error(`Data ${label} kosong.`);
  }

  for (const row of series) {
    if (
      !Array.isArray(row) || row.length !== 2 ||
      !Number.isSafeInteger(row[0]) || row[0] <= 0 ||
      Number.isNaN(new Date(row[0]).getTime()) ||
      !Number.isFinite(row[1]) || row[1] <= 0
    ) {
      throw new Error(`Format data ${label} tidak valid.`);
    }
  }

  return [...series].sort((a, b) => a[0] - b[0]);
}

function renderCard(key) {
  const series = data[key];
  const latest = series.at(-1);
  const latestDay = dayKey(latest[0]);
  const previous = series
    .slice(0, -1)
    .reverse()
    .find(([timestamp]) => dayKey(timestamp) !== latestDay);

  document.getElementById(`${key}-price`).textContent = rupiah.format(latest[1]);
  document.getElementById(`${key}-date`).textContent = `Data terakhir: ${dateLabel(latest[0])}`;

  const element = document.getElementById(`${key}-change`);

  if (!previous) {
    element.textContent = 'Belum ada data hari sebelumnya';
    return;
  }

  const difference = latest[1] - previous[1];
  const percent = Math.abs(difference / previous[1] * 100)
    .toLocaleString('id-ID', { maximumFractionDigits: 2 });

  element.textContent = difference === 0
    ? 'Tidak berubah dari hari sebelumnya'
    : `${difference > 0 ? '↑' : '↓'} ${rupiah.format(Math.abs(difference))} (${percent}%) dari hari sebelumnya`;

  element.style.color = difference === 0
    ? '#687385'
    : difference > 0 ? '#008f5a' : '#d92d20';
}

function renderHistoryTable() {
  const history = new Map();

  for (const key of ['sell', 'buyback']) {
    for (const [timestamp, price] of data[key]) {
      const date = dayKey(timestamp);
      const row = history.get(date) || { date };
      row[key] = price;
      history.set(date, row);
    }
  }

  historyRows = [...history.values()]
    .sort((a, b) => b.date.localeCompare(a.date))

  let previous = {};
  for (let index = historyRows.length - 1; index >= 0; index -= 1) {
    const row = historyRows[index];
    row.sellChange = row.sell === undefined || previous.sell === undefined
      ? undefined
      : row.sell - previous.sell;
    row.buybackChange = row.buyback === undefined || previous.buyback === undefined
      ? undefined
      : row.buyback - previous.buyback;
    previous = {
      sell: row.sell ?? previous.sell,
      buyback: row.buyback ?? previous.buyback,
    };
  }

  renderHistoryPage();
}

function formatHistoryChange(label, difference) {
  if (difference === undefined) return `<span>—</span>`;
  if (difference === 0) return `<span class="unchanged">${label} → Tidak berubah</span>`;
  const direction = difference > 0 ? 'up' : 'down';
  const icon = difference > 0 ? '↑' : '↓';
  return `<span class="${direction}">${label} ${icon} ${rupiah.format(Math.abs(difference))}</span>`;
}

function renderHistoryPage() {
  const pageCount = Math.ceil(historyRows.length / historyPageSize);
  const start = (historyPage - 1) * historyPageSize;

  document.getElementById('history-table').innerHTML = historyRows
    .slice(start, start + historyPageSize)
    .map(row => `
      <tr>
        <th scope="row">${dateLabel(dayTimestamp(row.date))}</th>
        <td>${row.sell ? rupiah.format(row.sell) : '—'}</td>
        <td>${row.buyback ? rupiah.format(row.buyback) : '—'}</td>
        <td class="daily-change">
          ${formatHistoryChange('Jual', row.sellChange)}
          ${formatHistoryChange('Buyback', row.buybackChange)}
        </td>
      </tr>`)
    .join('');

  document.getElementById('page-info').textContent = `Halaman ${historyPage} dari ${pageCount}`;
  document.getElementById('previous-page').disabled = historyPage === 1;
  document.getElementById('next-page').disabled = historyPage === pageCount;
}

function renderRange(days) {
  const latest = Math.max(data.sell.at(-1)[0], data.buyback.at(-1)[0]);
  const endDay = dayTimestamp(dayKey(latest));
  const cutoffDate = new Date(endDay);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days + 1);
  const cutoff = days ? cutoffDate.getTime() : -Infinity;

  const selectedSell = data.sell.filter(([timestamp]) => timestamp >= cutoff);
  const selectedBuyback = data.buyback.filter(([timestamp]) => timestamp >= cutoff);
  const timestamps = [...selectedSell, ...selectedBuyback].map(([timestamp]) => timestamp);
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);

  chart.data.datasets[0].data = selectedSell.map(([x, y]) => ({ x, y }));
  chart.data.datasets[1].data = selectedBuyback.map(([x, y]) => ({ x, y }));
  if (timestamps.length) {
    chart.options.scales.x.min = first;
    chart.options.scales.x.max = last;
  }
  chart.update();

  document.getElementById('period').textContent = timestamps.length
    ? `${dateLabel(first)} – ${dateLabel(last)}`
    : 'Tidak ada data pada rentang ini';

  document.querySelectorAll('[data-days]').forEach(button => {
    const active = Number(button.dataset.days) === days;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function init() {
  try {
    const response = await fetch('./data/gold-history.json');

    if (!response.ok) {
      throw new Error(`Gagal memuat JSON: HTTP ${response.status}`);
    }

    const raw = await response.json();

    data = {
      sell: validateSeries(raw.sell, 'sell'),
      buyback: validateSeries(raw.buyback, 'buyback'),
    };

    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js gagal dimuat. Periksa koneksi ke CDN.');
    }

    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Harga jual',
            data: [],
            borderColor: '#a87915',
            backgroundColor: '#a87915',
          },
          {
            label: 'Harga buyback',
            data: [],
            borderColor: '#168777',
            backgroundColor: '#168777',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        elements: {
          line: { borderWidth: 2, tension: 0 },
          point: { radius: 0, hitRadius: 12, hoverRadius: 4 },
        },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              title: items => dateLabel(items[0].parsed.x),
              label: item => `${item.dataset.label}: ${rupiah.format(item.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            bounds: 'data',
            grid: { display: false },
            ticks: {
              maxTicksLimit: 6,
              callback: value => dateLabel(value),
            },
          },
          y: {
            grid: { color: '#eef0f4' },
            ticks: {
              maxTicksLimit: 6,
              callback: value => new Intl.NumberFormat('id-ID', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(value),
            },
          },
        },
      },
    });

    renderCard('sell');
    renderCard('buyback');
    renderHistoryTable();

    document.getElementById('content').hidden = false;
    document.getElementById('status').hidden = true;
    renderRange(365);

    document.querySelectorAll('[data-days]').forEach(button => {
      button.addEventListener('click', () => renderRange(Number(button.dataset.days)));
    });

    document.getElementById('previous-page').addEventListener('click', () => {
      historyPage -= 1;
      renderHistoryPage();
    });
    document.getElementById('next-page').addEventListener('click', () => {
      historyPage += 1;
      renderHistoryPage();
    });

  } catch (error) {
    const status = document.getElementById('status');
    status.textContent = error.message;
    status.classList.add('error');
    status.setAttribute('role', 'alert');
  }
}

init();
