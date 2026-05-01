const { google } = require('googleapis');

const BASE_URL = process.env.BASE_URL || 'https://madmoiselle.vercel.app';

module.exports = async function handler(req, res) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  // Domani in ora di Roma
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

  const timeMin = romeToUTC(dateStr, '00:00:00').toISOString();
  const timeMax = romeToUTC(dateStr, '23:59:59').toISOString();

  const calendar = google.calendar({ version: 'v3', auth });
  const { data: calData } = await calendar.events.list({
    calendarId: process.env.CALENDAR_ID,
    timeMin, timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: 'Europe/Rome',
  });

  const events = calData.items || [];
  const gmail  = google.gmail({ version: 'v1', auth });
  let sent = 0;

  for (const ev of events) {
    if (!ev.start?.dateTime) continue;

    const desc       = ev.description || '';
    const emailMatch = desc.match(/^Email:\s*(.+)$/m);
    if (!emailMatch) continue;

    const clientEmail = emailMatch[1].trim();
    const nomeMatch   = desc.match(/^Cliente:\s*(\S+)/m);
    const clientNome  = nomeMatch ? nomeMatch[1] : 'Cliente';

    const startDate = new Date(ev.start.dateTime);
    const oraStr = startDate.toLocaleTimeString('it-IT', {
      timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit',
    });
    const dataStr = startDate.toLocaleDateString('it-IT', {
      timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long',
    });

    const cancelUrl = `${BASE_URL}/api/cancella?token=${ev.id}`;

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmail({
          to:      clientEmail,
          from:    process.env.GMAIL_USER,
          subject: 'Promemoria appuntamento – Mademoiselle',
          body:
`Gentile ${clientNome},

ti ricordiamo il tuo appuntamento di domani.

📅 ${dataStr}
🕐 ${oraStr}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Non puoi venire? Cancella entro stasera cliccando qui:
${cancelUrl}

⚠️  Ricorda: in caso di ritardo superiore a 10 minuti
l'appuntamento verrà automaticamente annullato.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A domani!

Mademoiselle · Salone di bellezza
Clusone, Val Seriana`,
        }),
      },
    });
    sent++;
  }

  return res.status(200).json({ ok: true, sent, date: dateStr });
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

function buildEmail({ to, from, subject, body }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const mime = [
    `To: ${to}`, `From: ${from}`, `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
