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

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

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
  const occupied = [];

  for (let h = 7; h < 22; h++) {
    for (const m of [0, 15, 30, 45]) {
      const slotStart = h * 60 + m;
      const slotEnd   = slotStart + 15;

      const isOccupied = events.some(ev => {
        if (!ev.start?.dateTime) return false;
        const evStart = toRomeMinutes(ev.start.dateTime);
        const evEnd   = toRomeMinutes(ev.end.dateTime);
        return evStart < slotEnd && evEnd > slotStart;
      });

      if (isOccupied) occupied.push(`${pad(h)}:${pad(m)}`);
    }
  }

  return res.status(200).json({ occupied });
};

function toRomeMinutes(dateTimeStr) {
  const date = new Date(dateTimeStr);
  const str = date.toLocaleString('en-US', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function romeToUTC(dateStr, timeStr) {
  const naive     = new Date(`${dateStr}T${timeStr}Z`);
  const offsetMin = getRomeOffsetMinutes(naive);
  return new Date(naive.getTime() - offsetMin * 60_000);
}

function getRomeOffsetMinutes(date) {
  const utcStr  = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const romeStr = date.toLocaleString('en-US', { timeZone: 'Europe/Rome' });
  return (new Date(romeStr) - new Date(utcStr)) / 60_000;
}

function pad(n) { return String(n).padStart(2, '0'); }
