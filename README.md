# ✉️ Elettro Webmail

Cliente de correo **web, portable y estilo Gmail (versión ligera)** para el servidor
`mail.elettrorava.es`. Habla **SMTP por el puerto 25** y **POP3 por el puerto 110**,
**sin TLS ni SSL** en ningún puerto.

Un navegador no puede abrir conexiones SMTP/POP3 crudas, así que la app incluye un
pequeño backend en Node.js que hace de puente HTTP ⇄ SMTP/POP3. El frontend es una
SPA sin dependencias (HTML/CSS/JS puro).

## Funcionalidades

- 🔐 **Login** con las credenciales del correo (se validan contra el servidor POP3).
- 📥 **Bandeja de entrada**: lista de mensajes con remitente, asunto, fecha y vista previa.
- 📖 **Lectura** de mensajes (HTML renderizado en `iframe` sandbox + texto plano), con adjuntos listados.
- ✏️ **Redactar y enviar** correos (Para, CC, Asunto, cuerpo).
- ↩ **Responder** (cita el mensaje original).
- 🗑 **Eliminar** mensajes del servidor (POP3 `DELE`).
- 🔄 **Actualizar** y 🔎 **buscar** dentro de la bandeja.

> Es un cliente "tipo Gmail" deliberadamente reducido: no incluye etiquetas, carpetas
> múltiples, hilos de conversación ni adjuntos en el envío. POP3 solo expone la bandeja
> de entrada del servidor.

## Seguridad / Privacidad

- Las **credenciales solo viven en la sesión en memoria del servidor**; nunca se escriben a disco.
- El correo se renderiza en un `iframe` con `sandbox` (sin ejecución de scripts).
- ⚠️ Como el servidor exige texto plano (sin TLS/SSL), **las credenciales y los correos
  viajan sin cifrar** entre este backend y `mail.elettrorava.es`. Es un requisito del
  servidor de correo, no de esta app. Úsalo solo en una red de confianza.

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior.

## Uso (portable)

```bash
git clone https://github.com/Hugo-Gomez-Sanchez-01101/elettro-webmail.git
cd elettro-webmail
npm install
npm start
```

Abre <http://localhost:3000> e inicia sesión con tu correo `@elettrorava.es`.

### Configuración (opcional, vía variables de entorno)

| Variable         | Por defecto              | Descripción                    |
|------------------|--------------------------|--------------------------------|
| `MAIL_HOST`      | `mail.elettrorava.es`    | Host del servidor de correo    |
| `SMTP_PORT`      | `25`                     | Puerto SMTP (envío)            |
| `POP3_PORT`      | `110`                    | Puerto POP3 (recepción)        |
| `PORT`           | `3000`                   | Puerto HTTP del cliente web    |
| `SESSION_SECRET` | aleatorio                | Secreto de la cookie de sesión |

```bash
# Ejemplo: cambiar el puerto web
PORT=8080 npm start
```

### Ejecutable portable (.exe) — opcional

Para llevarlo en un USB sin necesidad de instalar Node:

```bash
npm install -g pkg
npm run build:exe   # genera dist/elettro-webmail.exe
```

## Stack

- **Backend**: Node.js, Express, [nodemailer](https://nodemailer.com/) (SMTP),
  [node-pop3](https://www.npmjs.com/package/node-pop3) (POP3),
  [mailparser](https://nodemailer.com/extras/mailparser/).
- **Frontend**: HTML + CSS + JavaScript sin frameworks.

## Cómo funciona internamente

El navegador **no puede** abrir sockets SMTP/POP3 directamente (solo habla HTTP/WebSocket),
por eso existe el backend Node.js: el frontend hace peticiones HTTP a la API REST de
`server.js`, y este traduce esas peticiones a los protocolos de correo reales contra
`mail.elettrorava.es`. Resumen del recorrido de cada operación:

### Arquitectura general

```
Navegador (SPA)  ──HTTP/JSON──►  Backend Express (server.js)  ──SMTP:25 / POP3:110──►  mail.elettrorava.es
   public/app.js                  nodemailer / node-pop3 / mailparser        (texto plano, sin TLS)
```

### Sesión y credenciales

- Al hacer login (`POST /api/login`), el backend usa **`express-session`** para crear una
  sesión en **memoria** identificada por una cookie `httpOnly`. Ahí se guardan el usuario y
  la contraseña **solo durante la sesión**; no se escriben a disco.
- Cada endpoint protegido recupera esas credenciales de `req.session` para abrir la
  conexión SMTP o POP3 correspondiente.

### Envío de correo (SMTP) — librería `nodemailer`

- En `POST /api/send` se crea un *transport* con `nodemailer.createTransport({ host, port: 25,
  secure: false, ignoreTLS: true, auth })`.
- `secure: false` indica que el puerto no es SSL, e **`ignoreTLS: true`** fuerza a nodemailer
  a **no** intentar `STARTTLS`, es decir, diálogo SMTP en **texto plano** (`EHLO` → `AUTH` →
  `MAIL FROM` → `RCPT TO` → `DATA`). nodemailer construye el mensaje MIME y lo entrega.

### Recepción de correo (POP3) — librería `node-pop3`

- Se crea un cliente `new Pop3Command({ host, port: 110, user, password, tls: false })`.
  Con `tls: false` la conexión es texto plano; al llamar al primer comando, la librería abre
  el socket y autentica automáticamente con `USER`/`PASS`.
- **Listar la bandeja** (`GET /api/messages`):
  - `STAT` → número total de mensajes.
  - `UIDL` → identificadores únicos y estables de cada mensaje.
  - `TOP n 20` por cada mensaje → descarga **solo las cabeceras + 20 líneas** (rápido, no baja
    el correo entero) para mostrar remitente, asunto, fecha y vista previa.
- **Abrir un correo** (`GET /api/messages/:num`): `RETR n` descarga el mensaje **completo**.
- **Eliminar** (`DELETE /api/messages/:num`): `DELE n`; el borrado se confirma al cerrar la
  sesión con `QUIT` (comportamiento estándar de POP3).
- Toda conexión POP3 se cierra con `QUIT` al terminar cada petición (conexiones efímeras y
  sin estado entre peticiones).

### Parseo de mensajes — librería `mailparser`

- La salida cruda de `TOP`/`RETR` es un mensaje RFC 822 en bruto. **`mailparser`
  (`simpleParser`)** lo convierte en un objeto con `from`, `to`, `subject`, `date`, `text`,
  `html` y `attachments`, que el backend envía como JSON al frontend.

### Renderizado seguro en el frontend

- El cuerpo HTML del correo se inyecta en un **`<iframe sandbox>`** (sin permiso de scripts),
  que se **recrea por cada correo** para evitar el quirk de `srcdoc` en Chromium que impedía
  recargar el contenido. El texto se escapa con `escapeHtml`.

## Licencia

MIT
