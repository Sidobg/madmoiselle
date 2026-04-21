const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nome, cognome, telefono, email, note, data, ora } = req.body || {};

  if (!nome || !telefono || !data || !ora) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti: nome, telefono, data, ora.' });
  }

  // ─── Auth OAuth2 ───────────────────────────────────────────────
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  // ─── Google Calendar ───────────────────────────────────────────
  const calendar = google.calendar({ version: 'v3', auth });

  // data: "YYYY-MM-DD", ora: "HH:MM"
  const [year, month, day] = data.split('-').map(Number);
  const [hour, min] = ora.split(':').map(Number);

  const start = new Date(year, month - 1, day, hour, min);
  const end   = new Date(start.getTime() + 60 * 60 * 1000); // durata 1 ora

  const description = [
    `Cliente: ${nome} ${cognome || ''}`.trim(),
    `Telefono: ${telefono}`,
    email ? `Email: ${email}` : null,
    note  ? `Note: ${note}`  : null,
  ].filter(Boolean).join('\n');

  await calendar.events.insert({
    calendarId: process.env.CALENDAR_ID,
    requestBody: {
      summary: `Appuntamento – ${nome}${cognome ? ' ' + cognome : ''}`,
      description,
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Rome' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Europe/Rome' },
    },
  });

  // ─── Gmail ─────────────────────────────────────────────────────
  const gmail = google.gmail({ version: 'v1', auth });

  const dataLeggibile = `${pad(day)}/${pad(month)}/${year}`;

  // Email al cliente (solo se ha fornito l'indirizzo)
  if (email) {
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

📅 Data:  ${dataLeggibile}
🕐 Ora:   ${ora}
${note ? '📝 Note:  ' + note + '\n' : ''}
Ti aspettiamo!

Mademoiselle · Salone di bellezza
Clusone, Val Seriana`,
        }),
      },
    });
  }

  // Email di notifica alla titolare
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
Data:      ${dataLeggibile}
Ora:       ${ora}
Note:      ${note || '—'}`,
      }),
    },
  });

  return res.status(200).json({ ok: true });
};

// ─── Helpers ────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Costruisce un messaggio RFC 2822 codificato in base64url
 * pronto per l'API Gmail.
 */
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
