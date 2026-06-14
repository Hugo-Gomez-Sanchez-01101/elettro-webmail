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

## Licencia

MIT
