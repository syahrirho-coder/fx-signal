import { getEvents, buildSignals, isDue, formatSignal, sendTelegram } from '../lib/engine.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET belum diset' });
  const ok = req.headers.authorization === `Bearer ${secret}` || req.query.secret === secret;
  if (!ok) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (req.query.test) {
      await sendTelegram('✅ <b>fx-signal</b> terhubung ke Telegram.');
      return res.json({ sent: 'test' });
    }
    const { source, events } = await getEvents({ gate: true });
    const due = buildSignals(events).filter(s => isDue(s) && (!process.env.FMP_API_KEY || s.mode === 'actual'));
    if (!req.query.dry) for (const s of due) await sendTelegram(formatSignal(s));
    res.json({ source, checked: events.length, sent: req.query.dry ? 0 : due.length, due: due.map(s => s.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
