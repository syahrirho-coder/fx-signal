import { getEvents, analyze, isDue, CFG } from '../lib/engine.js';

export default async function handler(req, res) {
  try {
    const { source, events } = await getEvents();
    const rows = events.map(e => {
      const s = analyze(e);
      return {
        title: e.title, currency: e.currency, impact: e.impact, date: e.date.toISOString(),
        actual: e.actual, forecast: e.forecast, previous: e.previous,
        bias: s ? s.dir : 0, signal: s ? { mode: s.mode, conf: s.conf, trades: s.trades, due: isDue(s) } : null
      };
    });
    res.setHeader('cache-control', 's-maxage=120, stale-while-revalidate=300');
    res.json({ source, now: new Date().toISOString(), config: CFG, events: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
