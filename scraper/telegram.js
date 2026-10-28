const rupiah = value => `Rp${value.toLocaleString('id-ID')}`;

function formatPrice(label, current, previous) {
  const diff = current - previous;
  const icon = diff > 0 ? '📈' : diff < 0 ? '📉' : '➖';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';

  return `${icon} ${label}: <b>${rupiah(current)}</b> (${sign}${rupiah(Math.abs(diff))})`;
}

async function sendTelegram(history) {
  console.log('[tg] Mengirim notifikasi');

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('[tg] TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diatur');
  }

  const sell = history.sell;
  const buyback = history.buyback;

  const latestSell = sell.at(-1)?.[1];
  const latestBuyback = buyback.at(-1)?.[1];

  if (latestSell == null || latestBuyback == null) {
    throw new Error('[tg] Data grafik kosong');
  }

  const previousSell = sell.at(-2)?.[1] ?? latestSell;
  const previousBuyback = buyback.at(-2)?.[1] ?? latestBuyback;

  const diff = latestSell - previousSell;
  const status = diff > 0 ? '🟢' : diff < 0 ? '🔴' : '🔵';

  const timestamp = history.sell.at(-1)[0];
  const date = new Date(timestamp).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'long',
    timeStyle: 'short',
  })

  const message = [
    `${status} <b>Notifikasi Update Harga Emas ANTAM — Logam Mulia</b>`,
    `🕐 ${date} WIB`,
    '',
    formatPrice('Jual', latestSell, previousSell),
    formatPrice('Beli', latestBuyback, previousBuyback),
  ].join('\n');

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(`[tg] Gagal mengirim notifikasi: ${result.description}`);
  } else {
    console.log(`[tg] Notifikasi berhasil terkirim`);
  }
}

module.exports = { sendTelegram };