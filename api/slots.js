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
  // timeMin/timeMax convertiti da ora di Roma a UTC (gestisce CET +01 e CEST +02)
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = romeToUTC(data, '00:00:00').toISOString();
  const timeMax = romeToUTC(data, '23:59:59').toISOString();

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
  // Un slot HH:MM (durata 30 min) è occupato se un evento si sovrappone
  // all'intervallo [slotStart, slotStart + 30 min).
  // slotStart è costruito in ora di Roma → convertito a UTC per confronto corretto.
  const SLOT_MS = 30 * 60 * 1000;
  const occupied = [];

  for (let h = 7; h < 22; h++) {
    for (const m of [0, 30]) {
      const slotStart = romeToUTC(data, `${pad(h)}:${pad(m)}:00`);
      const slotEnd   = new Date(slotStart.getTime() + SLOT_MS);

      const isOccupied = events.some(ev => {
        // Ignora eventi tutto-il-giorno (senza dateTime)
        if (!ev.start?.dateTime) return false;
        // Google Calendar restituisce dateTime con offset incluso (es. 09:00:00+02:00)
        // new Date() lo converte correttamente in UTC
        const evStart = new Date(ev.start.dateTime);
        const evEnd   = new Date(ev.end.dateTime);
        return evStart < slotEnd && evEnd > slotStart;
      });

      if (isOccupied) occupied.push(`${pad(h)}:${pad(m)}`);
    }
  }

  return res.status(200).json({ occupied });
};

// ─── Helpers timezone ──────────────────────────────────────────────────────────

/**
 * Converte una data+ora espressa nel fuso Europe/Rome in un oggetto Date UTC.
 * Usa Intl per ricavare l'offset reale (CET +01:00 oppure CEST +02:00),
 * così non serve hardcodare l'offset.
 *
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {string} timeStr  "HH:MM:SS"
 * @returns {Date}
 */
function romeToUTC(dateStr, timeStr) {
  // Passo 1: crea un Date trattando la stringa come se fosse UTC (senza offset)
  const naive = new Date(`${dateStr}T${timeStr}Z`);
  // Passo 2: calcola l'offset Rome vs UTC a quell'istante approssimativo
  const offsetMin = getRomeOffsetMinutes(naive);
  // Passo 3: sottrai l'offset → ora abbiamo il vero istante UTC
  return new Date(naive.getTime() - offsetMin * 60_000);
}

/**
 * Restituisce l'offset in minuti di Europe/Rome rispetto a UTC
 * per l'istante dato (positivo = avanti di UTC, es. +60 per CET, +120 per CEST).
 *
 * @param {Date} date
 * @returns {number}
 */
function getRomeOffsetMinutes(date) {
  const utcStr  = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const romeStr = date.toLocaleString('en-US', { timeZone: 'Europe/Rome' });
  return (new Date(romeStr) - new Date(utcStr)) / 60_000;
}

function pad(n) {
  return String(n).padStart(2, '0');
}
