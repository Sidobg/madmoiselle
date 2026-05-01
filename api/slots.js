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
  // timeMin/timeMax: mezzanotte e fine giornata in ora di Roma → UTC
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
  // Lavoriamo interamente in minuti-dalla-mezzanotte nel fuso Europe/Rome.
  // Gli orari degli eventi vengono estratti in ora locale di Roma tramite Intl,
  // quindi non dipendono da come Google li restituisce (con/senza offset, Z, ecc.).
  //
  // Uno slot HH:MM è occupato se qualsiasi evento si sovrappone a
  // [slotStart, slotStart + 30 min) in ora di Roma.

  const occupied = [];

  for (let h = 7; h < 22; h++) {
    for (const m of [0, 15, 30, 45]) {
      const slotStart = h * 60 + m;       // minuti dalla mezzanotte (ora Roma)
      const slotEnd   = slotStart + 15;

      const isOccupied = events.some(ev => {
        // Ignora eventi tutto-il-giorno (senza dateTime)
        if (!ev.start?.dateTime) return false;

        // Converte start/end dell'evento in minuti-dalla-mezzanotte di Roma
        const evStart = toRomeMinutes(ev.start.dateTime);
        const evEnd   = toRomeMinutes(ev.end.dateTime);

        return evStart < slotEnd && evEnd > slotStart;
      });

      if (isOccupied) occupied.push(`${pad(h)}:${pad(m)}`);
    }
  }

  return res.status(200).json({ occupied });
};

// ─── Helpers timezone ──────────────────────────────────────────────────────────

/**
 * Estrae l'ora di un evento (dateTimeStr ISO con o senza offset)
 * e la restituisce come minuti dalla mezzanotte nel fuso Europe/Rome.
 *
 * Usa Intl → corretto indipendentemente da come Google restituisce il campo
 * (es. "2026-04-21T14:00:00Z", "2026-04-21T16:00:00+02:00", "2026-04-21T16:00:00").
 *
 * @param {string} dateTimeStr
 * @returns {number}  es. 16:00 → 960
 */
function toRomeMinutes(dateTimeStr) {
  const date = new Date(dateTimeStr);
  // Forza interpretazione del fuso Europe/Rome
  const str = date.toLocaleString('en-US', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // str è tipo "16:00" o "09:30"
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Converte una data+ora espressa in Europe/Rome nel corrispondente Date UTC.
 * Determina CET (+01:00) o CEST (+02:00) dinamicamente tramite Intl.
 *
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {string} timeStr  "HH:MM:SS"
 * @returns {Date}
 */
function romeToUTC(dateStr, timeStr) {
  const naive     = new Date(`${dateStr}T${timeStr}Z`);
  const offsetMin = getRomeOffsetMinutes(naive);
  return new Date(naive.getTime() - offsetMin * 60_000);
}

/**
 * Offset in minuti di Europe/Rome vs UTC per l'istante dato.
 * Restituisce +60 (CET) o +120 (CEST).
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
