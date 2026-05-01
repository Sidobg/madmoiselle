const { google } = require('googleapis');

const BASE_URL = process.env.BASE_URL || 'https://madmoiselle.vercel.app';

const DURATE_MIN = {
  'Taglio Donna': 30,
  'Taglio Uomo': 30,
  'Piega': 15,
  'Taglio+Piega': 45,
  'Colorazione': 60,
  'Colore+Piega': 75,
  'Colore+Taglio+Piega': 90,
  'Schiariture': 180,
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nome, cognome, telefono, email, note, data, ora, servizio } = req.body || {};

  if (!nome || !telefono || !email || !data || !ora) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti: nome, telefono, email, data, ora.' });
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  const calendar = google.calendar({ version: 'v3', auth });

  const [year, month, day] = data.split('-').map(Number);
  const start    = romeToUTC(data, `${ora}:00`);
  const duratMin = DURATE_MIN[servizio] || 60;
  const end      = new Date(start.getTime() + duratMin * 60 * 1000);

  const description = [
    `Cliente: ${nome} ${cognome || ''}`.trim(),
    `Telefono: ${telefono}`,
    email    ? `Email: ${email}`       : null,
    servizio ? `Servizio: ${servizio}` : null,
    note     ? `Note: ${note}`         : null,
  ].filter(Boolean).join('\n');

  const { data: eventData } = await calendar.events.insert({
    calendarId: process.env.CALENDAR_ID,
    requestBody: {
      summary: `${servizio ? servizio + ' – ' : 'Appuntamento – '}${nome}${cognome ? ' ' + cognome : ''}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Rome' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Europe/Rome' },
    },
  });

  const cancelUrl   = `${BASE_URL}/api/cancella?token=${eventData.id}`;
  const gmail       = google.gmail({ version: 'v1', auth });
  const dataLeggibile = `${pad(day)}/${pad(month)}/${year}`;

  await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmail({
          to:      email,
          from:    process.env.GMAIL_USER,
          subject: 'Conferma appuntamento – Mademoiselle',
          body:
`Gentile ${nome},

il tuo appuntamento è confermato.

📅 Data:     ${dataLeggibile}
🕐 Ora:      ${ora}
✂️  Servizio: ${servizio || '—'}
${note ? '📝 Note:     ' + note + '\n' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISDETTA O MODIFICA APPUNTAMENTO
Puoi cancellare il tuo appuntamento cliccando qui:
${cancelUrl}

Per spostare l'appuntamento contattaci telefonicamente.

⚠️  IMPORTANTE: In caso di ritardo superiore a 10 minuti
l'appuntamento verrà automaticamente annullato.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Ti aspettiamo!

Mademoiselle · Salone di bellezza
Clusone, Val Seriana`,
        }),
      },
    });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: buildEmail({
        to:      process.env.GMAIL_USER,
        from:    process.env.GMAIL_USER,
        subject: `Nuova prenotazione – ${nome}${cognome ? ' ' + cognome : ''}`,
        body:
`Nuova prenotazione ricevuta dal sito.

Cliente:   ${nome}${cognome ? ' ' + cognome : ''}
Telefono:  ${telefono}
Email:     ${email || '—'}
Servizio:  ${servizio || '—'}
Data:      ${dataLeggibile}
Ora:       ${ora}
Note:      ${note || '—'}

Link cancellazione: ${cancelUrl}`,
      }),
    },
  });

  return res.status(200).json({ ok: true });
};

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

function buildEmail({ to, from, subject, body }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const mime = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
