'use strict';

/**
 * Elettro Webmail - backend puente HTTP <-> SMTP/POP3.
 *
 * El navegador no puede hablar SMTP/POP3 crudo, así que este servidor Express
 * hace de intermediario: envía con nodemailer (SMTP) y lee con node-pop3 (POP3).
 * Las credenciales del usuario viven SOLO en la sesión en memoria del servidor;
 * nunca se escriben a disco.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const Pop3Command = require('node-pop3');
const { simpleParser } = require('mailparser');

// ---------------------------------------------------------------------------
// Configuración (overridable por variables de entorno para portabilidad)
// ---------------------------------------------------------------------------
const CONFIG = {
  mailHost: process.env.MAIL_HOST || 'mail.elettrorava.es',
  smtpPort: Number(process.env.SMTP_PORT || 25),
  pop3Port: Number(process.env.POP3_PORT || 110),
  httpPort: Number(process.env.PORT || 3000),
  // El servidor no usa TLS/SSL en ningún puerto, según el requisito.
  useTls: false,
};

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'elettro-webmail-' + Math.random().toString(36).slice(2),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function newPop3(creds) {
  return new Pop3Command({
    host: CONFIG.mailHost,
    port: CONFIG.pop3Port,
    user: creds.user,
    password: creds.password,
    tls: CONFIG.useTls,
    timeout: 30000,
  });
}

function newTransport(creds) {
  return nodemailer.createTransport({
    host: CONFIG.mailHost,
    port: CONFIG.smtpPort,
    secure: false, // sin SSL en el puerto
    ignoreTLS: true, // fuerza texto plano: no intentar STARTTLS
    auth: { user: creds.user, pass: creds.password },
    tls: { rejectUnauthorized: false },
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.creds) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

// Convierte la salida cruda de UIDL ([[num, uid], ...]) a un mapa num->uid.
function uidlToMap(uidlList) {
  const map = {};
  for (const row of uidlList || []) {
    if (Array.isArray(row) && row.length >= 2) map[String(row[0])] = row[1];
  }
  return map;
}

function snippetFrom(parsed) {
  const text = (parsed.text || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 140);
}

function addressText(addr) {
  if (!addr) return '';
  if (Array.isArray(addr)) return addr.map((a) => a.text).join(', ');
  return addr.text || '';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// Login: valida credenciales abriendo una sesión POP3 real.
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  const creds = { user: email, password };
  const pop3 = newPop3(creds);
  try {
    await pop3.STAT(); // fuerza connect + USER/PASS
    await pop3.QUIT();
    req.session.creds = creds;
    res.json({ ok: true, email });
  } catch (err) {
    try { await pop3.QUIT(); } catch (_) {}
    res.status(401).json({ error: 'Login fallido: ' + (err.message || String(err)) });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ email: req.session.creds.user, host: CONFIG.mailHost });
});

// Lista de mensajes (cabeceras + snippet) usando TOP para no descargar todo.
app.get('/api/messages', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 30), 100);
  const pop3 = newPop3(req.session.creds);
  try {
    const stat = await pop3.STAT(); // ["count octets"] o similar
    const statStr = Array.isArray(stat) ? stat.join(' ') : String(stat);
    const total = parseInt(String(statStr).trim().split(/\s+/)[0], 10) || 0;

    let uidMap = {};
    try { uidMap = uidlToMap(await pop3.UIDL()); } catch (_) {}

    const start = Math.max(1, total - limit + 1);
    const messages = [];
    for (let n = total; n >= start; n--) {
      try {
        const raw = await pop3.TOP(n, 20);
        const parsed = await simpleParser(raw);
        messages.push({
          num: n,
          uid: uidMap[String(n)] || String(n),
          from: addressText(parsed.from),
          to: addressText(parsed.to),
          subject: parsed.subject || '(sin asunto)',
          date: parsed.date ? parsed.date.toISOString() : null,
          snippet: snippetFrom(parsed),
        });
      } catch (e) {
        // Mensaje ilegible: lo saltamos sin tumbar la lista entera.
      }
    }
    await pop3.QUIT();
    res.json({ total, messages });
  } catch (err) {
    try { await pop3.QUIT(); } catch (_) {}
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Mensaje completo.
app.get('/api/messages/:num', requireAuth, async (req, res) => {
  const num = Number(req.params.num);
  const pop3 = newPop3(req.session.creds);
  try {
    const raw = await pop3.RETR(num);
    await pop3.QUIT();
    const parsed = await simpleParser(raw);
    res.json({
      num,
      from: addressText(parsed.from),
      to: addressText(parsed.to),
      cc: addressText(parsed.cc),
      subject: parsed.subject || '(sin asunto)',
      date: parsed.date ? parsed.date.toISOString() : null,
      html: parsed.html || null,
      text: parsed.text || '',
      attachments: (parsed.attachments || []).map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      })),
    });
  } catch (err) {
    try { await pop3.QUIT(); } catch (_) {}
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Borrar mensaje (DELE; se confirma al hacer QUIT).
app.delete('/api/messages/:num', requireAuth, async (req, res) => {
  const num = Number(req.params.num);
  const pop3 = newPop3(req.session.creds);
  try {
    await pop3.DELE(num);
    await pop3.QUIT();
    res.json({ ok: true });
  } catch (err) {
    try { await pop3.QUIT(); } catch (_) {}
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Enviar correo.
app.post('/api/send', requireAuth, async (req, res) => {
  const { to, cc, subject, text, html } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Destinatario (to) requerido' });
  const transport = newTransport(req.session.creds);
  try {
    const info = await transport.sendMail({
      from: req.session.creds.user,
      to,
      cc: cc || undefined,
      subject: subject || '(sin asunto)',
      text: text || '',
      html: html || undefined,
    });
    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// Frontend estático
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(CONFIG.httpPort, () => {
  console.log('');
  console.log('  Elettro Webmail en marcha');
  console.log('  --------------------------');
  console.log('  URL:   http://localhost:' + CONFIG.httpPort);
  console.log('  SMTP:  ' + CONFIG.mailHost + ':' + CONFIG.smtpPort + ' (sin TLS)');
  console.log('  POP3:  ' + CONFIG.mailHost + ':' + CONFIG.pop3Port + ' (sin TLS)');
  console.log('');
});
