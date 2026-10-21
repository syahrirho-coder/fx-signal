// Mesin sinyal: kalender ekonomi -> bias mata uang -> BUY/SELL pair
const TZ = process.env.TZ_DISPLAY || 'Asia/Jakarta';
const IMPACTS = (process.env.IMPACT || 'High').split(',').map(s => s.trim().toLowerCase());
export const CFG = {
  minConf: Number(process.env.MIN_CONFIDENCE || 60),
  lead: Number(process.env.LEAD_MIN || 15),     // menit sebelum rilis (mode pre-rilis)
  window: Number(process.env.WINDOW_MIN || 5),  // = interval cron (menit)
  delay: Number(process.env.ACTUAL_DELAY_MIN || 2) // tunggu data actual muncul setelah rilis (menit)
};

// mata uang menguat (+1) -> arah pair = bias * pengali
const PAIRS = {
  USD: [['EURUSD', -1], ['GBPUSD', -1], ['USDJPY', 1], ['XAUUSD', -1]],
  EUR: [['EURUSD', 1]],
  GBP: [['GBPUSD', 1]],
  JPY: [['USDJPY', -1]],
  AUD: [['AUDUSD', 1]],
  NZD: [['NZDUSD', 1]],
  CAD: [['USDCAD', -1]],
  CHF: [['USDCHF', -1]]
};
// angka lebih tinggi = buruk bagi mata uang
const INVERSE = /unemployment|jobless|claims|layoffs/i;

export function num(v) {
  if (v == null || v === '') return null;
  const m = String(v).replace(/,/g, '').trim().match(/^(-?\d+(?:\.\d+)?)\s*([KMBT]?)/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] || 1;
  return parseFloat(m[1]) * mult;
}

const iso = d => d.toISOString().slice(0, 10);

async function fetchFF() {
  const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'user-agent': 'fx-signal/1.0' } });
  if (!r.ok) throw new Error('ForexFactory feed ' + r.status);
  const j = await r.json();
  return j.map(e => ({
    title: e.title, currency: e.country, date: new Date(e.date), impact: e.impact,
    forecast: e.forecast || null, previous: e.previous || null, actual: null
  }));
}

let fmpCache = { t: 0, data: null };
async function fetchFMP(key, fresh) {
  if (!fresh && fmpCache.data && Date.now() - fmpCache.t < 10 * 60000) return fmpCache.data;
  const from = iso(new Date(Date.now() - 864e5)), to = iso(new Date(Date.now() + 7 * 864e5));
  const r = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${key}`);
  if (!r.ok) throw new Error('FMP ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('FMP response tidak valid');
  const data = j.map(e => ({
    title: e.event, currency: e.currency, date: new Date(String(e.date).replace(' ', 'T') + 'Z'), impact: e.impact,
    forecast: e.estimate ?? null, previous: e.previous ?? null, actual: e.actual ?? null
  }));
  fmpCache = { t: Date.now(), data };
  return data;
}

const keep = e => e.currency && PAIRS[e.currency] && IMPACTS.includes(String(e.impact).toLowerCase()) && !isNaN(e.date);

// gate=true (dipakai cron): FMP hanya dipanggil saat ada event yang baru rilis,
// jadwal event diambil dari feed ForexFactory (gratis, tanpa limit). Hemat kuota 250/hari.
export async function getEvents({ gate = false } = {}) {
  const key = process.env.FMP_API_KEY;
  const ff = await fetchFF().catch(e => { console.error(e.message); return null; });
  let source = 'forexfactory', events = ff;
  if (key) {
    const now = Date.now();
    const justReleased = ff && ff.filter(keep).some(e => {
      const m = (now - e.date) / 60000;
      return m >= CFG.delay && m < CFG.delay + CFG.window;
    });
    if (!gate || !ff || justReleased) {
      try { events = await fetchFMP(key, gate); source = 'fmp'; } catch (e) { console.error(e.message); }
    }
  }
  if (!events) throw new Error('Kalender ekonomi tidak tersedia');
  return { source, events: events.filter(keep).sort((a, b) => a.date - b.date) };
}

export function analyze(ev) {
  const f = num(ev.forecast), p = num(ev.previous), a = num(ev.actual);
  let mode, ref, diff;
  if (a != null && (f != null || p != null)) { mode = 'actual'; ref = f != null ? f : p; diff = a - ref; }
  else if (f != null && p != null) { mode = 'pre'; ref = p; diff = f - p; }
  else return null;
  const rel = diff / (Math.abs(ref) || 1), mag = Math.abs(rel);
  if (mag < 0.02) return null;
  let dir = Math.sign(diff);
  if (INVERSE.test(ev.title)) dir = -dir;
  const conf = Math.round(mode === 'actual' ? 55 + Math.min(35, mag * 100) : 50 + Math.min(15, mag * 50));
  if (conf < CFG.minConf) return null;
  return {
    id: `${ev.currency}|${ev.title}|${ev.date.toISOString()}`,
    title: ev.title, currency: ev.currency, impact: ev.impact, date: ev.date.toISOString(),
    actual: ev.actual, forecast: ev.forecast, previous: ev.previous,
    mode, conf, dir,
    trades: PAIRS[ev.currency].map(([pair, m]) => ({ pair, side: dir * m > 0 ? 'BUY' : 'SELL' }))
  };
}

export function isDue(s, now = Date.now()) {
  const min = (new Date(s.date) - now) / 60000;
  if (s.mode === 'actual') { const el = -min; return el >= CFG.delay && el < CFG.delay + CFG.window; }
  return min <= CFG.lead && min > CFG.lead - CFG.window;
}

export function buildSignals(events) {
  return events.map(analyze).filter(Boolean);
}

const esc = s => String(s ?? '-').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function formatSignal(s) {
  const up = s.dir > 0;
  const when = new Date(s.date).toLocaleString('id-ID', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const lines = s.trades.map(t => `${t.side === 'BUY' ? '🟢' : '🔴'} <b>${t.side} ${t.pair}</b>`).join('\n');
  return [
    `${up ? '📈' : '📉'} <b>${s.currency} ${up ? 'menguat' : 'melemah'}</b> (${s.mode === 'actual' ? 'setelah rilis' : 'pre-rilis'})`,
    `📰 ${esc(s.title)} (${esc(s.impact)})`,
    `Actual: ${esc(s.actual)} | Forecast: ${esc(s.forecast)} | Prev: ${esc(s.previous)}`,
    '',
    lines,
    '',
    `🛡 SL 30 pips, TP 60 pips (XAUUSD: SL $8, TP $16)`,
    `🎯 Confidence ${s.conf}%`,
    `⏰ ${when} (${TZ})`,
    '',
    '<i>Bukan saran keuangan. Gunakan risk management.</i>'
  ].join('\n');
}

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diset');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const j = await r.json();
  if (!j.ok) throw new Error('Telegram: ' + j.description);
  return j;
}
