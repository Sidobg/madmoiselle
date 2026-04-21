const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data } = req.query;

  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ error: 'Parametro ?data=YYYY-MM-DD richiesto.' });
  }

  // ─── Auth OAuth2 ───────────────────────────────────────────────
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  // ─── Leggi eventi del giorno ───────────────────────────────────
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date(`${data}T00:00:00+01:00`).toISOString();
  const timeMax = new Date(`${data}T23:59:59+01:00`).toISOString();

  const { data: calData } = await calendar.events.list({
    calendarId: process.env.CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: 'Europe/Rome',
  });

  const events = calData.items || [];

  // ─── Calcola slot occupati ─────────────────────────────────────
  // Un slot HH:MM (durata 30 min) è occupato se qualsiasi evento
  // si sovrappone all'intervallo [slotStart, slotStart + 30 min).
  const SLOT_MIN = 30 * 60 * 1000; // 30 minuti in ms

  // Costruiamo tutti gli slot possibili (07:00–22:00, ogni 30 min)
  // e verifichiamo sovrapposizione con gli eventi del giorno.
  const occupied = [];

  for (let h = 7; h < 22; h++) {
    for (const m of [0, 30]) {
      const slotStart = new Date(`${data}T${pad(h)}:${pad(m)}:00`);
      const slotEnd   = new Date(slotStart.getTime() + SLOT_MIN);

      const isOccupied = events.some(ev => {
        // Gestisci eventi tutto-il-giorno (nessun orario)
        if (!ev.start?.dateTime) return false;
        const evStart = new Date(ev.start.dateTime);
        const evEnd   = new Date(ev.end.dateTime);
        // Sovrapposizione: evStart < slotEnd AND evEnd > slotStart
        return evStart < slotEnd && evEnd > slotStart;
      });

      if (isOccupied) {
        occupied.push(`${pad(h)}:${pad(m)}`);
      }
    }
  }

  return res.status(200).json({ occupied });
};

function pad(n) {
  return String(n).padStart(2, '0');
}
