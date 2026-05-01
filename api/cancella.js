const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;
  if (!token) return res.status(400).send(page('Errore', 'Token mancante.'));

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    const calendar = google.calendar({ version: 'v3', auth });

    let titolo = 'il tuo appuntamento';
    let desc   = '';
    try {
      const { data } = await calendar.events.get({
        calendarId: process.env.CALENDAR_ID,
        eventId: token,
      });
      titolo = data.summary || titolo;
      desc   = data.description || '';
    } catch (_) {}

    await calendar.events.delete({
      calendarId: process.env.CALENDAR_ID,
      eventId: token,
    });

    // Notifica ad Alice
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildEmail({
          to:      process.env.GMAIL_USER,
          from:    process.env.GMAIL_USER,
          subject: `Appuntamento cancellato – ${titolo}`,
          body:
`Un cliente ha cancellato il proprio appuntamento dal sito.

Appuntamento: ${titolo}

${desc}`,
        }),
      },
    });

    return res.status(200).send(page(
      'Appuntamento cancellato ✦',
      `"${titolo}" è stato cancellato con successo.\n\nPer prenotare un nuovo appuntamento visita il nostro sito.`
    ));

  } catch (err) {
    const msg = (err.code === 404 || err.code === 410)
      ? 'Questo appuntamento è già stato cancellato o non esiste.'
      : 'Si è verificato un errore. Contattaci telefonicamente.';
    return res.status(200).send(page('Errore', msg));
  }
};

function page(title, message) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – Mademoiselle</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;600&family=Jost:wght@300;400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#080808;color:#e8ddd0;font-family:'Jost',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#111;border:1px solid #2a2015;border-radius:2px;padding:48px 40px;max-width:480px;text-align:center}
h1{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;color:#C9A96E;margin-bottom:20px;letter-spacing:2px}
p{font-size:14px;line-height:1.8;color:#b0a090;white-space:pre-line}
.div{width:40px;height:1px;background:linear-gradient(90deg,transparent,#C9A96E,transparent);margin:24px auto}
.foot{margin-top:32px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#444}
a{color:#C9A96E;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <div class="div"></div>
  <p>${message}</p>
  <div class="div"></div>
  <p><a href="https://madmoiselle.vercel.app">← Prenota un nuovo appuntamento</a></p>
  <div class="foot">Mademoiselle · Clusone · Val Seriana</div>
</div>
</body>
</html>`;
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
