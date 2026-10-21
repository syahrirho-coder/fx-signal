# fx-signal

Kalender ekonomi -> bias mata uang -> sinyal BUY/SELL -> Telegram. Dashboard bertema terminal amber di `/`.

## Setup (10 menit)
1. **Bot Telegram**: chat @BotFather, `/newbot`, simpan token. Tambahkan bot ke channel/grup (jadikan admin kalau channel).
2. **Chat ID**: kirim satu pesan ke bot/grup, buka `https://api.telegram.org/bot<TOKEN>/getUpdates`, ambil `chat.id` (channel publik bisa pakai `@namachannel`).
3. **Deploy**: push folder ini ke GitHub lalu Import di vercel.com (atau `npx vercel`). Framework preset: *Other*.
4. **Environment Variables** (Project Settings): isi `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET` (string acak panjang). Lihat `.env.example` untuk opsi lain. Redeploy.
5. **Tes**: buka `https://APP.vercel.app/api/cron?secret=CRON_SECRET&test=1`. Pesan "terhubung" harus masuk ke Telegram.
6. **Jadwal**: Vercel Hobby hanya mengizinkan cron 1x/hari, jadi pakai cron-job.org (gratis): panggil `https://APP.vercel.app/api/cron?secret=CRON_SECRET` **tiap 5 menit**. Di Vercel Pro, tambahkan di `vercel.json`:
   `"crons": [{ "path": "/api/cron", "schedule": "*/5 * * * *" }]` (Vercel otomatis kirim `Authorization: Bearer CRON_SECRET`).

Dengan `FMP_API_KEY`, FMP hanya dipanggil saat ada event yang baru rilis (jadwal dari feed ForexFactory), jadi kuota gratis 250/hari aman walau cron tiap 5 menit. Sinyal dikirim `ACTUAL_DELAY_MIN` menit setelah rilis, menunggu data actual muncul.

`WINDOW_MIN` harus sama dengan interval cron supaya sinyal tidak dobel/terlewat. Tambahkan `&dry=1` untuk melihat sinyal tanpa mengirim.

## Cara kerja sinyal
- Hanya event impact High (ubah lewat `IMPACT`).
- **Dengan `FMP_API_KEY`**: sinyal dikirim setelah rilis, dari actual vs forecast.
- **Tanpa key** (feed gratis ForexFactory, tidak ada nilai actual): sinyal pre-rilis `LEAD_MIN` menit sebelum event, dari forecast vs previous. Confidence lebih rendah.
- Data yang lebih tinggi = mata uang menguat, kecuali pengangguran dan jobless claims (dibalik).
- USD menguat -> SELL EURUSD/GBPUSD/XAUUSD, BUY USDJPY. Mata uang lain -> pair terkait.
- Sinyal hanya jika selisih >= 2% dan confidence >= `MIN_CONFIDENCE`.

Bukan saran keuangan. Uji dulu di akun demo.
