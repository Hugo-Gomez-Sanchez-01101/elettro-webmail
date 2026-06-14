'use strict';

// Estado en memoria del cliente.
let allMessages = [];

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Error ' + res.status));
  return data;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

// ---------- Auth ----------
async function checkSession() {
  try {
    const me = await api('/api/me');
    showApp(me.email);
  } catch (_) {
    showLogin();
  }
}

function showLogin() {
  $('login-screen').classList.remove('hidden');
  $('app').classList.add('hidden');
}

function showApp(email) {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-email').textContent = email;
  loadMessages();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Conectando…';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('login-email').value.trim(),
        password: $('login-password').value,
      }),
    });
    showApp(data.email);
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('login-btn').disabled = false;
    $('login-btn').textContent = 'Entrar';
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  allMessages = [];
  showLogin();
});

// ---------- Lista de mensajes ----------
async function loadMessages() {
  $('list-status').textContent = 'Cargando mensajes…';
  $('message-list').innerHTML = '';
  showList();
  try {
    const data = await api('/api/messages?limit=30');
    allMessages = data.messages || [];
    $('inbox-count').textContent = data.total ? data.total : '';
    renderList(allMessages);
  } catch (err) {
    $('list-status').textContent = 'Error: ' + err.message;
  }
}

function renderList(messages) {
  const ul = $('message-list');
  ul.innerHTML = '';
  if (!messages.length) {
    $('list-status').textContent = 'No hay mensajes.';
    return;
  }
  $('list-status').textContent = '';
  for (const m of messages) {
    const li = document.createElement('li');
    li.className = 'message-item';
    li.innerHTML =
      '<div class="mi-from">' + escapeHtml(m.from || '(desconocido)') + '</div>' +
      '<div class="mi-main"><span class="mi-subject">' + escapeHtml(m.subject) + '</span>' +
      ' <span class="mi-snippet">— ' + escapeHtml(m.snippet) + '</span></div>' +
      '<div class="mi-date">' + formatDate(m.date) + '</div>';
    li.addEventListener('click', () => openMessage(m.num));
    ul.appendChild(li);
  }
}

// Búsqueda en cliente.
$('search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) return renderList(allMessages);
  renderList(
    allMessages.filter((m) =>
      (m.from + ' ' + m.subject + ' ' + m.snippet).toLowerCase().includes(q)
    )
  );
});

$('refresh-btn').addEventListener('click', loadMessages);

// ---------- Lectura ----------
function showList() {
  $('list-view').classList.remove('hidden');
  $('read-view').classList.add('hidden');
}
function showRead() {
  $('list-view').classList.add('hidden');
  $('read-view').classList.remove('hidden');
}

let currentMsg = null;

async function openMessage(num) {
  showRead();
  $('read-subject').textContent = 'Cargando…';
  $('read-from').textContent = '';
  $('read-date').textContent = '';
  $('read-to').textContent = '';
  $('read-attachments').innerHTML = '';
  $('read-body').srcdoc = '';
  try {
    const m = await api('/api/messages/' + num);
    currentMsg = m;
    $('read-subject').textContent = m.subject;
    $('read-from').textContent = m.from;
    $('read-date').textContent = m.date ? new Date(m.date).toLocaleString('es-ES') : '';
    $('read-to').textContent = 'Para: ' + (m.to || '') + (m.cc ? '  ·  CC: ' + m.cc : '');
    if (m.attachments && m.attachments.length) {
      $('read-attachments').innerHTML = m.attachments
        .map((a) => '<span class="attachment-chip">📎 ' + escapeHtml(a.filename || 'adjunto') +
          ' (' + Math.round((a.size || 0) / 1024) + ' KB)</span>')
        .join('');
    }
    // El cuerpo se renderiza en un iframe sandbox (sin scripts) por seguridad.
    const body = m.html
      ? m.html
      : '<pre style="white-space:pre-wrap;font-family:inherit">' + escapeHtml(m.text) + '</pre>';
    $('read-body').srcdoc =
      '<base target="_blank"><style>body{font-family:Arial,sans-serif;color:#202124;margin:16px}</style>' + body;
  } catch (err) {
    $('read-subject').textContent = 'Error: ' + err.message;
  }
}

$('back-btn').addEventListener('click', showList);

$('delete-btn').addEventListener('click', async () => {
  if (!currentMsg || !confirm('¿Eliminar este mensaje del servidor?')) return;
  try {
    await api('/api/messages/' + currentMsg.num, { method: 'DELETE' });
    showList();
    loadMessages();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
});

$('reply-btn').addEventListener('click', () => {
  if (!currentMsg) return;
  openCompose({
    to: currentMsg.from,
    subject: (/^re:/i.test(currentMsg.subject) ? '' : 'Re: ') + currentMsg.subject,
    body: '\n\n----- Mensaje original -----\n' + (currentMsg.text || ''),
  });
});

// ---------- Redacción ----------
function openCompose(prefill = {}) {
  $('compose-modal').classList.remove('hidden');
  $('c-to').value = prefill.to || '';
  $('c-cc').value = prefill.cc || '';
  $('c-subject').value = prefill.subject || '';
  $('c-body').value = prefill.body || '';
  $('compose-status').textContent = '';
}
function closeCompose() {
  $('compose-modal').classList.add('hidden');
}

$('compose-btn').addEventListener('click', () => openCompose());
$('compose-close').addEventListener('click', closeCompose);

$('compose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('c-send').disabled = true;
  $('compose-status').textContent = 'Enviando…';
  try {
    await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({
        to: $('c-to').value.trim(),
        cc: $('c-cc').value.trim(),
        subject: $('c-subject').value.trim(),
        text: $('c-body').value,
      }),
    });
    $('compose-status').textContent = '✓ Enviado';
    setTimeout(closeCompose, 800);
  } catch (err) {
    $('compose-status').textContent = 'Error: ' + err.message;
  } finally {
    $('c-send').disabled = false;
  }
});

// ---------- Arranque ----------
checkSession();
