# 🧠 El backend por dentro (`server.js`)

Esta guía explica **cómo funciona el backend de Elettro Webmail**, de arriba abajo:
desde la idea general ("¿por qué hace falta un servidor?") hasta el detalle de los
comandos de texto que viajan por la red. Está pensada para alguien que lleva
**alrededor de un año programando**: cada concepto nuevo se explica antes de usarlo.

> El backend completo son ~240 líneas en un único archivo: [`server.js`](server.js).
> Te recomiendo tenerlo abierto al lado mientras lees.

---

## Índice

1. [¿Qué es un backend y por qué lo necesitamos aquí?](#1-qué-es-un-backend-y-por-qué-lo-necesitamos-aquí)
2. [Conceptos previos (red, puertos, protocolos)](#2-conceptos-previos-red-puertos-protocolos)
3. [Visión de alto nivel: el backend como "traductor"](#3-visión-de-alto-nivel-el-backend-como-traductor)
4. [Node.js y el modelo asíncrono](#4-nodejs-y-el-modelo-asíncrono)
5. [Express: el esqueleto del servidor](#5-express-el-esqueleto-del-servidor)
6. [Anatomía de `server.js` bloque a bloque](#6-anatomía-de-serverjs-bloque-a-bloque)
7. [Bajo nivel: los protocolos SMTP y POP3 al desnudo](#7-bajo-nivel-los-protocolos-smtp-y-pop3-al-desnudo)
8. [Las librerías por dentro](#8-las-librerías-por-dentro)
9. [Cómo es un correo por dentro (MIME / RFC 822)](#9-cómo-es-un-correo-por-dentro-mime--rfc-822)
10. [Sesiones, cookies y autenticación](#10-sesiones-cookies-y-autenticación)
11. [Manejo de errores y códigos HTTP](#11-manejo-de-errores-y-códigos-http)
12. [Seguridad: qué protegemos y qué no](#12-seguridad-qué-protegemos-y-qué-no)
13. [Recorrido completo de dos operaciones reales](#13-recorrido-completo-de-dos-operaciones-reales)
14. [Glosario rápido](#14-glosario-rápido)

---

## 1. ¿Qué es un backend y por qué lo necesitamos aquí?

Una aplicación web tiene normalmente dos mitades:

- **Frontend**: lo que se ejecuta en el navegador (el HTML, el CSS y el JavaScript de
  la carpeta `public/`). Es la parte que el usuario ve y toca.
- **Backend**: un programa que se ejecuta en un servidor (aquí, `server.js` corriendo
  con Node.js). El usuario no lo ve; hace el "trabajo pesado" entre bastidores.

¿Por qué no podemos enviar y recibir correo **directamente** desde el navegador?
Porque el navegador, por seguridad, **solo sabe hablar unos pocos protocolos**
(principalmente HTTP y WebSocket). **No puede abrir una conexión cruda** a un servidor
de correo para hablar SMTP o POP3. Si pudiera, cualquier página web maliciosa podría
conectarse a servicios internos de tu red.

La solución clásica es poner un **backend en medio**:

```
El navegador SÍ sabe hablar con nuestro backend (HTTP).
Nuestro backend SÍ sabe hablar con el servidor de correo (SMTP/POP3).
```

El backend actúa de **puente / traductor**: recibe peticiones HTTP sencillas del
navegador (por ejemplo "dame la lista de correos") y las convierte en los comandos
reales del protocolo de correo. Esa es, literalmente, la única razón de existir de
este `server.js`.

---

## 2. Conceptos previos (red, puertos, protocolos)

Antes de leer el código conviene tener claros cinco conceptos.

### 2.1. Cliente y servidor

- Un **servidor** es un programa que **espera** conexiones y responde.
- Un **cliente** es un programa que **inicia** la conexión y pide algo.

Curiosidad importante para este proyecto: nuestro `server.js` es **las dos cosas a la
vez**. Es **servidor** para el navegador (escucha en el puerto 3000), pero es
**cliente** del servidor de correo (se conecta a `mail.elettrorava.es`).

### 2.2. TCP, IP y "sockets"

Cuando dos programas se comunican por Internet, casi siempre usan **TCP/IP**:

- **IP** es la "dirección postal" de una máquina (por ejemplo, la IP de
  `mail.elettrorava.es`).
- **TCP** es el "cartero fiable": garantiza que los bytes que envías lleguen
  completos y en orden.
- Un **socket** es el "tubo" abierto entre los dos programas. Una vez abierto, puedes
  escribir bytes por un lado y salen por el otro.

Lo clave: **por un socket TCP solo viajan bytes** (normalmente texto). No hay "funciones"
ni "objetos"; solo una secuencia de caracteres. Por eso los protocolos de correo son,
como verás, **conversaciones de texto** línea a línea.

### 2.3. Puertos

Una misma máquina puede ofrecer varios servicios a la vez. Para distinguirlos se usan
**puertos**, que son simples números. Convenciones que usamos aquí:

| Puerto | Servicio | Para qué |
|-------:|----------|----------|
| 25     | SMTP     | **Enviar** correo |
| 110    | POP3     | **Descargar/leer** correo |
| 3000   | HTTP     | Nuestra web (frontend + API) |

Cuando lees `mail.elettrorava.es:25`, significa "la máquina `mail.elettrorava.es`, en
su puerto 25".

### 2.4. Protocolo

Un **protocolo** son las "reglas de la conversación": qué se puede decir, en qué orden
y qué respuestas significan qué. SMTP y POP3 son protocolos **de texto plano basados en
líneas**: el cliente manda una línea con un comando, el servidor responde con una o
varias líneas. Cada línea termina en `\r\n` (retorno de carro + salto de línea, lo que
en los ejemplos verás como el final de cada renglón).

### 2.5. Texto plano vs. TLS/SSL

- **Texto plano**: los bytes viajan **tal cual**. Si alguien "escucha" la red, puede
  leer tu usuario, tu contraseña y tus correos.
- **TLS/SSL**: añade una capa de **cifrado** encima del socket, de modo que aunque
  alguien escuche, solo vea ruido.

En este proyecto el servidor de correo **no ofrece TLS en ningún puerto** (es un
requisito dado), así que toda la conversación es en texto plano. Esto es importante de
cara a la seguridad (ver §12) y condiciona cómo configuramos las librerías.

---

## 3. Visión de alto nivel: el backend como "traductor"

Este es el mapa mental completo. Las flechas son quién habla con quién:

```
┌────────────────────┐     HTTP + JSON      ┌──────────────────────────┐   SMTP (25) / POP3 (110)   ┌──────────────────────┐
│   NAVEGADOR (SPA)  │ ───────────────────► │   BACKEND (server.js)    │ ─────────────────────────► │  mail.elettrorava.es │
│   public/app.js    │ ◄─────────────────── │   Node.js + Express      │ ◄───────────────────────── │  (servidor de correo)│
└────────────────────┘   respuestas JSON    └──────────────────────────┘     texto plano, sin TLS    └──────────────────────┘
        ▲   cliente HTTP                  servidor HTTP  +  cliente SMTP/POP3                  servidor de correo
        │
   lo que ve el usuario
```

Idea central: **el navegador nunca toca el correo directamente**. Solo pide cosas en un
lenguaje cómodo (HTTP con datos en formato JSON), y el backend se encarga de la parte
"difícil" hablando los protocolos de correo.

### La "API REST" que ofrece el backend

El backend expone un conjunto de **rutas HTTP** (lo que se llama una *API*). Cada ruta es
una combinación de un **método HTTP** (GET, POST, DELETE...) y una **dirección**:

| Método + Ruta              | Qué hace                          | Qué usa por debajo |
|----------------------------|-----------------------------------|--------------------|
| `POST /api/login`          | Inicia sesión y valida usuario    | POP3 `STAT` |
| `POST /api/logout`         | Cierra la sesión                  | (solo borra la sesión) |
| `GET  /api/me`             | Dice quién está logueado          | (lee la sesión) |
| `GET  /api/messages`       | Lista la bandeja de entrada       | POP3 `STAT`+`UIDL`+`TOP` |
| `GET  /api/messages/:num`  | Devuelve un correo completo       | POP3 `RETR` |
| `DELETE /api/messages/:num`| Borra un correo                   | POP3 `DELE`+`QUIT` |
| `POST /api/send`           | Envía un correo                   | SMTP `sendMail` |

> **REST** es, simplificando, un estilo de diseñar APIs donde cada "cosa" (un recurso,
> p. ej. *un mensaje*) tiene una ruta, y el método HTTP indica la acción (GET = leer,
> POST = crear, DELETE = borrar). No hace falta más teoría para entender este proyecto.

---

## 4. Node.js y el modelo asíncrono

### 4.1. ¿Qué es Node.js?

**Node.js** es un programa que permite ejecutar **JavaScript fuera del navegador**, en
tu ordenador o en un servidor. Gracias a Node, podemos usar el mismo lenguaje
(JavaScript) tanto en el frontend como en el backend, y además Node trae herramientas
para abrir sockets, leer archivos, etc., cosas que el navegador no permite.

### 4.2. CommonJS: `require` y módulos

En la parte de arriba de `server.js` ves líneas como:

```js
const express = require('express');
const Pop3Command = require('node-pop3');
const { simpleParser } = require('mailparser');
```

`require('...')` **importa** otro archivo o librería y te devuelve lo que ese módulo
"exporta". Es el equivalente en Node al `import` que quizá ya conozcas. Las librerías
viven en la carpeta `node_modules/` (creada por `npm install`).

La línea `const { simpleParser } = require('mailparser');` usa **desestructuración**:
del objeto que devuelve `mailparser`, saca solo la función `simpleParser`.

### 4.3. El gran detalle: Node es asíncrono y "de un solo hilo"

Esto es lo más importante para entender un backend en Node.

Hablar con la red es **lento** comparado con la velocidad de la CPU: pedir un correo a
`mail.elettrorava.es` puede tardar décimas de segundo, una eternidad para un procesador.
Si el programa se **quedara parado esperando** ("bloqueado") en cada operación de red,
no podría atender a nadie más mientras tanto.

Node resuelve esto con un modelo **asíncrono y no bloqueante**: cuando lanzas una
operación lenta (leer de la red, leer un archivo...), Node **no espera**; sigue
ejecutando otras cosas y, cuando la operación termina, ejecuta el código que pusiste
"para después". Ese mecanismo interno se llama **event loop** (bucle de eventos).

### 4.4. Promesas y `async`/`await`

Para manejar esas operaciones "que terminarán más tarde" se usan **Promesas**. Una
*Promesa* es un objeto que representa **un valor que aún no está disponible** pero que
lo estará en el futuro (o que fallará).

Escribir código con promesas "a pelo" es engorroso, así que JavaScript ofrece dos
palabras clave que lo hacen leer como código normal:

- `async`: marca una función como asíncrona (puede usar `await` dentro y siempre
  devuelve una promesa).
- `await`: **"espera aquí"** a que una promesa termine y dame su resultado, **sin
  bloquear** al resto del programa.

Compara estos dos endpoints del proyecto:

```js
// Síncrono: no hace nada lento, responde al instante.
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ email: req.session.creds.user, host: CONFIG.mailHost });
});

// Asíncrono: tiene que hablar por red con el servidor POP3, así que usa async/await.
app.get('/api/messages/:num', requireAuth, async (req, res) => {
  const raw = await pop3.RETR(num);   // <-- "espera" a que llegue el correo entero
  const parsed = await simpleParser(raw); // <-- "espera" a que se analice
  res.json({ /* ... */ });
});
```

Cada `await` es un punto donde "podríamos tardar"; el `async` de la función es lo que
nos permite escribir esos `await`. Verás este patrón en casi todos los endpoints,
porque casi todos hablan con la red.

### 4.5. `try` / `catch`: capturar errores

La red falla a menudo (servidor caído, contraseña incorrecta, tiempo de espera
agotado...). Cuando un `await` falla, **lanza una excepción**. Para que el servidor no
se caiga, envolvemos esas operaciones en `try { ... } catch (err) { ... }`: si algo
revienta dentro del `try`, el control salta al `catch`, donde respondemos con un error
ordenado en vez de morir. Lo verás en todos los endpoints que tocan la red.

---

## 5. Express: el esqueleto del servidor

**Express** es una librería que facilita crear servidores HTTP en Node. Sin Express
tendríamos que analizar a mano cada petición HTTP (un trabajo tedioso); con Express
escribimos rutas de forma declarativa.

### 5.1. `req` y `res`

Cada vez que llega una petición HTTP, Express llama a tu función pasándole dos objetos:

- `req` (**request**, la petición): contiene lo que envió el cliente. Por ejemplo:
  - `req.body` → los datos JSON enviados (p. ej. el email y la contraseña en el login).
  - `req.params` → partes variables de la ruta (en `/api/messages/:num`, `req.params.num`).
  - `req.query` → parámetros tras el `?` de la URL (en `?limit=30`, `req.query.limit`).
  - `req.session` → la sesión del usuario (ver §10).
- `res` (**response**, la respuesta): sirve para **contestar**. Por ejemplo:
  - `res.json({...})` → responde con datos en JSON.
  - `res.status(401)` → fija el código de estado HTTP (ver §11).

### 5.2. Middlewares: funciones en cadena

Un concepto central de Express es el **middleware**: una función que se ejecuta **antes**
de llegar a tu ruta, y que puede mirar o modificar `req`/`res`, o cortar la petición.
Cada petición pasa por una "cadena de montaje" de middlewares.

En `server.js` se registran middlewares con `app.use(...)`:

```js
app.use(express.json({ limit: '25mb' })); // 1) Lee el cuerpo JSON y lo deja en req.body
app.use(session({ /* ... */ }));          // 2) Carga/crea la sesión y la deja en req.session
```

- `express.json()` mira si la petición trae un cuerpo en JSON y, si es así, lo convierte
  de texto a un objeto JavaScript accesible en `req.body`. El `limit: '25mb'` permite
  cuerpos grandes (correos con contenido largo).
- `session(...)` se encarga de toda la magia de las sesiones (lo vemos en §10).

También hay middlewares **propios** de este proyecto. El más importante es
`requireAuth`, que protege las rutas privadas:

```js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.creds) {
    return res.status(401).json({ error: 'No autenticado' }); // corta aquí
  }
  next(); // todo OK: deja pasar a la siguiente función (la ruta real)
}
```

La pieza clave es `next()`: si lo llamas, la petición **continúa** hacia la ruta; si en
vez de eso respondes (como en el caso de error), la cadena **se corta**. Por eso en las
rutas privadas verás `requireAuth` en medio:

```js
app.get('/api/messages', requireAuth, async (req, res) => { /* ... */ });
//                        ▲ primero pasa por aquí; si no hay sesión, nunca llega a la ruta
```

### 5.3. Servir el frontend

Al final del archivo:

```js
app.use(express.static(path.join(__dirname, 'public')));
```

`express.static` es un middleware que **sirve archivos tal cual** desde una carpeta.
Gracias a él, cuando el navegador pide `/` o `/app.js`, Express le entrega los archivos
de `public/`. Así, **el mismo servidor** ofrece la web y la API.

`__dirname` es una variable de Node que vale "la carpeta donde está este archivo", y
`path.join(...)` une rutas de forma correcta en cualquier sistema operativo (Windows usa
`\`, Linux usa `/`; `path.join` se encarga de eso).

### 5.4. Arrancar el servidor

```js
app.listen(CONFIG.httpPort, () => {
  console.log('  URL:   http://localhost:' + CONFIG.httpPort);
});
```

`app.listen(puerto, callback)` pone al servidor a **escuchar** en ese puerto. La función
que se le pasa (el *callback*) se ejecuta una vez cuando el servidor ya está listo, y
solo la usamos para imprimir un mensajito por consola.

---

## 6. Anatomía de `server.js` bloque a bloque

Ahora recorremos el archivo en orden, conectando todo lo anterior con el código real.

### 6.1. `'use strict'` y las importaciones

```js
'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const Pop3Command = require('node-pop3');
const { simpleParser } = require('mailparser');
```

- `'use strict'` activa el **modo estricto** de JavaScript: hace que ciertos errores
  silenciosos se conviertan en errores reales. Es una buena práctica.
- Las seis líneas siguientes importan lo que vamos a usar: utilidades de rutas, el
  framework web, las sesiones, y las tres librerías de correo.

### 6.2. Configuración centralizada

```js
const CONFIG = {
  mailHost: process.env.MAIL_HOST || 'mail.elettrorava.es',
  smtpPort: Number(process.env.SMTP_PORT || 25),
  pop3Port: Number(process.env.POP3_PORT || 110),
  httpPort: Number(process.env.PORT || 3000),
  useTls: false,
};
```

Todo lo configurable está en un único objeto `CONFIG`. El patrón
`process.env.X || valorPorDefecto` significa: *"usa la variable de entorno `X` si existe;
si no, usa este valor por defecto"*.

- `process.env` es donde Node guarda las **variables de entorno** (ajustes que se pasan
  desde fuera al arrancar el programa, sin tocar el código). Por eso puedes hacer
  `PORT=8080 npm start` para cambiar el puerto sin editar nada.
- `Number(...)` convierte el texto de la variable de entorno (siempre es texto) en un
  número, porque los puertos son números.
- `useTls: false` deja claro en un sitio que **no usamos cifrado**, según el requisito.

### 6.3. Creación de la app y middlewares globales

```js
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'elettro-webmail-' + Math.random().toString(36).slice(2),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));
```

`express()` crea la aplicación. Luego se registran los dos middlewares globales ya
comentados (JSON y sesión). Los detalles de las opciones de sesión están en §10.

### 6.4. Helpers (funciones auxiliares)

Son funciones pequeñas y reutilizables para no repetir código:

- **`newPop3(creds)`** crea un cliente POP3 ya configurado (host, puerto 110,
  `tls: false`, usuario y contraseña, y un *timeout* de 30 s para no quedarnos colgados
  para siempre si el servidor no responde). Se llama una vez **por cada petición** que
  necesite leer correo.
- **`newTransport(creds)`** crea un "transport" de nodemailer para **enviar** (puerto 25,
  sin TLS). Lo detallamos en §8.1.
- **`requireAuth(req, res, next)`** es el middleware de autenticación (ya visto en §5.2).
- **`uidlToMap(uidlList)`** transforma la lista que devuelve el comando POP3 `UIDL`
  (un array de pares `[número, identificador]`) en un objeto/diccionario
  `{ número: identificador }`, más cómodo de consultar.
- **`snippetFrom(parsed)`** saca las primeras ~140 letras del texto de un correo para la
  vista previa, quitando saltos de línea y espacios sobrantes con una expresión regular
  (`replace(/\s+/g, ' ')`).
- **`addressText(addr)`** normaliza el campo de direcciones (un correo puede tener varios
  destinatarios) y lo deja como un texto legible.

Separar esto en helpers hace que los endpoints queden cortos y fáciles de leer.

### 6.5. Los endpoints (las rutas de la API)

Cada endpoint sigue el mismo esquema mental:

```
1. Leer datos de la petición (req.body / req.params / req.query)
2. Validar (si falta algo, responder error 400)
3. Abrir conexión con el servidor de correo (POP3 o SMTP)
4. Ejecutar los comandos necesarios (con await)
5. Cerrar la conexión (QUIT)
6. Responder al navegador (res.json) — o capturar el error y responder 500/401
```

Los repasamos uno a uno (la parte de **qué comandos POP3/SMTP** se usan se explica al
detalle en §7):

- **`POST /api/login`**: coge `email` y `password` de `req.body`. Para **comprobar que
  son correctos** intenta abrir una sesión POP3 real y pedir `STAT`. Si funciona, guarda
  las credenciales en `req.session.creds` y responde OK. Si falla (contraseña mala),
  cae al `catch` y responde `401`. Validar el login "intentando conectarse de verdad"
  es un truco simple y fiable: no inventamos nuestra propia comprobación, dejamos que el
  propio servidor de correo diga sí o no.

- **`POST /api/logout`**: llama a `req.session.destroy(...)`, que borra la sesión (y con
  ella las credenciales guardadas).

- **`GET /api/me`**: simplemente devuelve el email guardado en la sesión. Sirve para que
  el frontend, al recargar, sepa si ya hay alguien logueado.

- **`GET /api/messages`**: lista la bandeja. Lee `limit` de `req.query` (cuántos correos
  como máximo, tope 100). Pide `STAT` (total de mensajes), `UIDL` (identificadores) y
  luego, en un bucle **de los más nuevos a los más viejos**, hace `TOP n 20` de cada uno
  para bajar **solo las cabeceras** (rápido). Cada cabecera se analiza con `simpleParser`
  y se mete en un array `messages` que se devuelve como JSON.
  - Detalle de robustez: el `TOP` de cada mensaje va dentro de su propio `try/catch`, de
    modo que **un correo corrupto no rompe la lista entera**; simplemente se salta.

- **`GET /api/messages/:num`**: descarga **un** correo completo con `RETR`, lo analiza con
  `simpleParser` y devuelve un objeto limpio con `from`, `to`, `subject`, `date`, `html`,
  `text` y la lista de adjuntos (nombre, tipo y tamaño).

- **`DELETE /api/messages/:num`**: marca el correo para borrar con `DELE` y cierra con
  `QUIT` (en POP3, el borrado **solo se confirma al hacer `QUIT`**; ver §7.3).

- **`POST /api/send`**: coge `to`, `cc`, `subject`, `text`, `html` de `req.body`, crea un
  transport y llama a `transport.sendMail({...})`. nodemailer construye el correo y lo
  entrega por SMTP. Devuelve el `messageId` que asigna el servidor.

---

## 7. Bajo nivel: los protocolos SMTP y POP3 al desnudo

Aquí está la parte "de verdad técnica". Las librerías nos esconden estos detalles, pero
entenderlos te hace comprender **qué pasa realmente por el cable**. Recuerda: son
conversaciones de **texto**, línea a línea. En los ejemplos:

- `C:` es lo que envía el **cliente** (nuestro backend).
- `S:` es lo que responde el **servidor** de correo.

### 7.1. Cómo se leen las respuestas

- **SMTP** responde con un **número de 3 cifras** al principio de la línea:
  - `2xx` = éxito (p. ej. `250 OK`).
  - `3xx` = "continúa, te toca enviar más" (p. ej. `354` = manda ya el cuerpo).
  - `4xx`/`5xx` = error.
- **POP3** es aún más simple: responde `+OK ...` si todo bien, o `-ERR ...` si hay error.

### 7.2. SMTP: enviar un correo (puerto 25)

Esto es, paso a paso, lo que `nodemailer.sendMail(...)` provoca por debajo cuando se
ejecuta `POST /api/send`:

```
S: 220 mail.elettrorava.es ESMTP listo
C: EHLO cliente                       ← "hola, me presento" (EHLO = saludo extendido)
S: 250-mail.elettrorava.es
S: 250-AUTH LOGIN PLAIN               ← el servidor anuncia qué sabe hacer
S: 250 OK
C: AUTH LOGIN                         ← quiero autenticarme
S: 334 VXNlcm5hbWU6                   ← "dame el usuario" (texto en Base64)
C: dХVzdWFyaW8=                       ← usuario (codificado en Base64)
S: 334 UGFzc3dvcmQ6                   ← "dame la contraseña"
C: bWlfcGFzcw==                       ← contraseña (codificada en Base64)
S: 235 Authentication successful      ← autenticado
C: MAIL FROM:<yo@elettrorava.es>      ← remitente
S: 250 OK
C: RCPT TO:<destino@ejemplo.com>      ← destinatario (uno por cada RCPT TO)
S: 250 OK
C: DATA                               ← "voy a mandar el contenido"
S: 354 End data with <CR><LF>.<CR><LF>← "adelante; termina con una línea que solo tenga un punto"
C: From: yo@elettrorava.es
C: To: destino@ejemplo.com
C: Subject: Hola
C: (línea en blanco que separa cabeceras del cuerpo)
C: Este es el cuerpo del mensaje.
C: .                                  ← un punto solo = fin del mensaje
S: 250 OK: queued                     ← aceptado para envío
C: QUIT                               ← me despido
S: 221 Bye
```

Observaciones importantes para este proyecto:

- **Base64** no es cifrado: es solo una forma de representar texto/binario con caracteres
  seguros. Como **no hay TLS**, el usuario y la contraseña viajan en Base64 pero
  **legibles** para quien escuche la red (ver §12).
- En el código, `secure: false` + `ignoreTLS: true` le dicen a nodemailer:
  *"no abras una conexión SSL y no intentes `STARTTLS`; habla en texto plano"*.
  `STARTTLS` sería un comando para "subir" a cifrado en mitad de la conversación; lo
  desactivamos porque este servidor no lo soporta.

### 7.3. POP3: leer y borrar correo (puerto 110)

POP3 ("Post Office Protocol") es como ir a recoger tu correo a una oficina: te conectas,
te identificas, miras qué hay y te lo llevas o lo borras. Esta es la conversación que
provocan, juntas, las rutas `login`, `messages` y `delete`:

```
S: +OK POP3 listo
C: USER yo@elettrorava.es             ← mi usuario
S: +OK
C: PASS mi_pass                       ← mi contraseña (¡en texto plano!)
S: +OK con sesión iniciada
C: STAT                               ← ¿cuántos mensajes y cuántos bytes hay?
S: +OK 12 34567                       ← 12 mensajes, 34567 bytes en total
C: UIDL                               ← dame un identificador único por mensaje
S: +OK
S: 1 abc123
S: 2 def456
S: ...
S: .                                  ← un punto solo = fin de la lista
C: TOP 12 20                          ← cabeceras + 20 líneas del mensaje nº 12
S: +OK
S: From: alguien@ejemplo.com
S: Subject: Asunto del correo
S: Date: ...
S: (cabeceras y un trozo del cuerpo)
S: .
C: RETR 12                            ← descárgame ENTERO el mensaje nº 12
S: +OK 2048 octets
S: (el mensaje completo, crudo)
S: .
C: DELE 12                            ← marca el nº 12 para borrar
S: +OK
C: QUIT                               ← al despedirme, se CONFIRMAN los borrados
S: +OK Bye
```

Tres detalles clave que explican decisiones del código:

1. **`STAT` como prueba de login**: para validar la contraseña en `/api/login` basta con
   llegar hasta `STAT`. Si `USER`/`PASS` fallaran, el servidor habría respondido `-ERR`
   y la librería habría lanzado una excepción que cae en nuestro `catch`.
2. **`TOP` vs `RETR`**: `TOP n 20` baja **solo cabeceras + 20 líneas** (rápido, ideal para
   la lista); `RETR n` baja el **mensaje entero** (más lento, solo al abrir un correo).
   Usar `TOP` para la lista evita descargar megabytes innecesarios.
3. **El borrado se confirma con `QUIT`**: `DELE` solo **marca**. Los mensajes marcados se
   eliminan de verdad cuando la sesión termina con `QUIT`. Por eso en
   `DELETE /api/messages/:num` siempre llamamos a `QUIT` después de `DELE`.

> **Conexiones efímeras:** en este backend, **cada petición HTTP abre su propia conexión
> POP3 y la cierra al terminar** (con `QUIT`). No mantenemos una conexión permanente.
> Es más simple y evita estados raros, a cambio de un pequeño coste por reconectar cada
> vez. Para una app de este tamaño, es el equilibrio correcto.

---

## 8. Las librerías por dentro

El backend se apoya en tres librerías de correo. Esto es lo que hace cada una **por
debajo**, para que no sean "cajas mágicas".

### 8.1. `nodemailer` — enviar (SMTP)

```js
function newTransport(creds) {
  return nodemailer.createTransport({
    host: CONFIG.mailHost,
    port: CONFIG.smtpPort,   // 25
    secure: false,           // el puerto no es SSL
    ignoreTLS: true,         // no intentar STARTTLS: texto plano puro
    auth: { user: creds.user, pass: creds.password },
    tls: { rejectUnauthorized: false },
  });
}
```

`createTransport` crea un objeto reutilizable que sabe **cómo** conectarse al servidor de
envío. Cuando luego llamas a `transport.sendMail({...})`, nodemailer:

1. Abre el socket TCP al puerto 25.
2. Mantiene la conversación SMTP de §7.2 por ti (`EHLO`, `AUTH`, `MAIL FROM`, etc.).
3. **Construye el mensaje en formato MIME** (ver §9) a partir de los campos `to`,
   `subject`, `text`, `html`... que le pasaste.
4. Devuelve una promesa que se resuelve con datos del envío (incluido `messageId`).

`rejectUnauthorized: false` solo dice "no te quejes por certificados", algo irrelevante
aquí porque no hay TLS, pero evita errores si el servidor intentara negociar algo.

### 8.2. `node-pop3` — leer (POP3)

```js
const pop3 = new Pop3Command({
  host, port: 110, user, password, tls: false, timeout: 30000,
});
```

`node-pop3` traduce métodos de JavaScript en los comandos POP3 de texto de §7.3:

| Llamada en JS        | Comando POP3 que envía |
|----------------------|------------------------|
| `pop3.STAT()`        | `STAT` |
| `pop3.UIDL()`        | `UIDL` |
| `pop3.TOP(n, 20)`    | `TOP n 20` |
| `pop3.RETR(n)`       | `RETR n` |
| `pop3.DELE(n)`       | `DELE n` |
| `pop3.QUIT()`        | `QUIT` |

Un detalle de comodidad: **al llamar al primer comando, la librería abre el socket y hace
`USER`/`PASS` automáticamente** usando el usuario y la contraseña del constructor. Por eso
en el código no ves un `connect()` explícito: basta con llamar a `STAT()` o al que toque.
Cada método devuelve una **promesa**, por eso siempre van con `await`.

### 8.3. `mailparser` — entender el correo crudo

Lo que `TOP` o `RETR` devuelven es **texto crudo** en formato de correo (cabeceras +
cuerpo, posiblemente con adjuntos y codificaciones raras). Procesar eso a mano es
complicadísimo. `simpleParser(textoCrudo)` lo hace por nosotros y devuelve un objeto
ordenado:

```js
const parsed = await simpleParser(raw);
// parsed.from / parsed.to / parsed.subject / parsed.date
// parsed.text  -> versión en texto plano
// parsed.html  -> versión en HTML (si existe)
// parsed.attachments -> array de adjuntos (nombre, tipo, tamaño...)
```

Es decir: `mailparser` convierte el "lenguaje del correo" (§9) en un objeto JavaScript
cómodo que luego mandamos como JSON al navegador.

---

## 9. Cómo es un correo por dentro (MIME / RFC 822)

Cuando `RETR` te devuelve un correo, no es un objeto bonito: es texto con un formato
estándar definido en documentos llamados **RFC** (las "normas oficiales" de Internet).
Un correo sencillo tiene esta pinta:

```
From: Ana <ana@ejemplo.com>
To: yo@elettrorava.es
Subject: Reunión
Date: Sat, 14 Jun 2026 10:00:00 +0200
Content-Type: text/plain; charset=utf-8

Hola, ¿nos vemos mañana?
Un saludo,
Ana
```

Reglas básicas:

- Primero van las **cabeceras** (`Nombre: valor`), una por línea.
- Una **línea en blanco** separa las cabeceras del **cuerpo**.
- Debajo va el **cuerpo** del mensaje.

Cuando el correo tiene varias partes (texto **y** HTML, o adjuntos), se usa **MIME**
("Multipurpose Internet Mail Extensions"): el cuerpo se divide en trozos separados por
una "frontera" (`boundary`), y cada trozo declara su propio `Content-Type` (texto, HTML,
imagen adjunta...). Los adjuntos suelen ir codificados en Base64 dentro de su trozo.

Tú **no** tienes que entender todo esto en detalle: precisamente para eso usamos
`mailparser`, que lee este formato y te da `parsed.text`, `parsed.html` y
`parsed.attachments` ya digeridos. Pero saber que "un correo es texto con esta
estructura" te ayuda a entender por qué hace falta un *parser*.

---

## 10. Sesiones, cookies y autenticación

### 10.1. El problema

HTTP es **sin estado** (*stateless*): cada petición es independiente y el servidor, por
defecto, no recuerda nada de la anterior. Pero nosotros necesitamos recordar que "este
usuario ya hizo login" para no pedirle la contraseña en cada clic. Ahí entran las
**sesiones**.

### 10.2. Cómo funciona una sesión (con `express-session`)

```js
app.use(session({
  secret: process.env.SESSION_SECRET || 'elettro-webmail-' + Math.random().toString(36).slice(2),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));
```

El mecanismo, paso a paso:

1. Cuando guardamos algo en `req.session` (en el login hacemos
   `req.session.creds = creds`), `express-session` crea una **sesión en la memoria del
   servidor** y le asigna un **identificador** aleatorio.
2. Ese identificador se manda al navegador dentro de una **cookie** (un trocito de datos
   que el navegador guarda y **reenvía automáticamente** en cada petición siguiente).
3. En las peticiones posteriores, el middleware lee la cookie, busca la sesión
   correspondiente y vuelve a poner los datos en `req.session`. Así
   `req.session.creds` "reaparece" en cada petición.

Las opciones explicadas:

- **`secret`**: clave con la que se **firma** la cookie, para que el cliente no pueda
  falsificar el identificador. Aquí, si no se define una por entorno, se genera aleatoria
  al arrancar (lo que significa que al reiniciar el servidor las sesiones caducan: bien
  para una app personal).
- **`resave: false`** y **`saveUninitialized: false`**: evitan guardar sesiones que no
  han cambiado o que están vacías (más eficiente y limpio).
- **`cookie.httpOnly: true`**: la cookie **no es accesible desde JavaScript** del
  navegador, lo que la protege de robos por scripts maliciosos (ataques XSS).
- **`cookie.sameSite: 'lax'`**: limita que la cookie se envíe desde otros sitios web,
  mitigando ataques **CSRF**.
- **`cookie.maxAge: 1000 * 60 * 60 * 8`**: la sesión dura **8 horas** (el valor está en
  milisegundos: 1000 ms × 60 s × 60 min × 8 h).

### 10.3. Dónde viven las credenciales

Un punto de diseño importante: como POP3 y SMTP nos piden usuario y contraseña **en cada
conexión**, el backend guarda esas credenciales en `req.session.creds` para reutilizarlas.
Eso significa que **viven en la memoria del servidor mientras dura la sesión** y
**nunca se escriben a disco**. Al hacer logout (o al reiniciar el servidor), desaparecen.

---

## 11. Manejo de errores y códigos HTTP

Cuando el backend responde, incluye un **código de estado HTTP** que resume qué pasó.
Los que usa este proyecto:

| Código | Significado | Cuándo lo usamos |
|-------:|-------------|------------------|
| `200`  | OK | Todo fue bien (lo pone `res.json` por defecto). |
| `400`  | Bad Request | Falta un dato obligatorio (p. ej. login sin contraseña). |
| `401`  | Unauthorized | No hay sesión, o el login falló. |
| `500`  | Internal Server Error | Algo reventó al hablar con el servidor de correo. |

El patrón que se repite en cada endpoint con red es:

```js
try {
  // ... hablar con POP3/SMTP con await ...
  res.json({ ok: true /* ... */ });      // camino feliz → 200
} catch (err) {
  try { await pop3.QUIT(); } catch (_) {} // intentar cerrar la conexión pase lo que pase
  res.status(500).json({ error: err.message || String(err) });
}
```

Fíjate en el `try { await pop3.QUIT(); } catch (_) {}` dentro del `catch`: aunque algo
haya fallado, intentamos **cerrar el socket** para no dejar conexiones abiertas; y si ese
cierre también falla, lo ignoramos (`catch (_)`) para no tapar el error original. Devolver
siempre un JSON con `error` permite que el frontend muestre un mensaje útil al usuario en
lugar de quedarse colgado.

---

## 12. Seguridad: qué protegemos y qué no

Lo que **sí** hace el backend por la seguridad:

- **Credenciales solo en memoria de servidor**, nunca en disco.
- **Cookie de sesión `httpOnly` y `sameSite`**, para mitigar XSS y CSRF.
- **Rutas privadas protegidas** por el middleware `requireAuth`.
- El frontend muestra el **HTML del correo en un `<iframe sandbox>`** (sin permiso para
  ejecutar scripts), de modo que un correo malicioso no puede ejecutar código en tu sesión.

Lo que **no** se puede evitar en este montaje (y conviene tener clarísimo):

- ⚠️ **El tramo backend ↔ servidor de correo va en TEXTO PLANO**, porque el servidor no
  ofrece TLS/SSL en ningún puerto (es un requisito impuesto). Eso significa que **usuario,
  contraseña y contenido de los correos viajan sin cifrar** por ese tramo. Cualquiera con
  acceso a esa red podría leerlos. **Úsese solo en una red de confianza.** No es un fallo
  de la app; es una limitación del servicio de correo.
- El tramo navegador ↔ backend va por HTTP normal (sin HTTPS). En una máquina local
  (`localhost`) no sale a la red, pero si desplegaras esto en un servidor real, deberías
  poner HTTPS por delante.

---

## 13. Recorrido completo de dos operaciones reales

Para fijar ideas, sigamos dos acciones de principio a fin.

### 13.1. El usuario abre un correo de la lista

```
1. (Navegador)  El usuario hace clic en un correo de la lista.
2. (Navegador)  app.js hace: fetch('/api/messages/12')  → petición HTTP GET.
3. (Backend)    Express recibe la petición y la pasa por los middlewares:
                  - session: recupera req.session a partir de la cookie.
                  - requireAuth: ¿hay req.session.creds? Sí → next().
4. (Backend)    La ruta GET /api/messages/:num se ejecuta:
                  - num = 12 (de req.params.num).
                  - newPop3(creds) crea el cliente POP3.
                  - await pop3.RETR(12):
                        · abre socket TCP a mail.elettrorava.es:110
                        · USER / PASS (login automático)
                        · RETR 12 → descarga el correo crudo
                  - await pop3.QUIT()  → cierra la conexión.
                  - await simpleParser(raw) → objeto con from/subject/html/text/adjuntos.
                  - res.json({...})  → responde 200 con el correo ya digerido.
5. (Navegador)  app.js recibe el JSON y pinta el correo (el HTML, en un iframe sandbox).
```

### 13.2. El usuario envía un correo

```
1. (Navegador)  El usuario rellena el formulario y pulsa "Enviar".
2. (Navegador)  fetch('/api/send', { method:'POST', body: JSON.stringify({to,subject,text}) }).
3. (Backend)    Middlewares: express.json llena req.body; session + requireAuth comprueban sesión.
4. (Backend)    Ruta POST /api/send:
                  - Valida que haya 'to' (si no → 400).
                  - newTransport(creds) prepara la conexión SMTP.
                  - await transport.sendMail({from, to, cc, subject, text, html}):
                        · abre socket TCP a mail.elettrorava.es:25
                        · EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → cuerpo MIME → .
                        · el servidor responde 250 OK: queued
                  - res.json({ ok:true, messageId })  → 200.
5. (Navegador)  app.js muestra "✓ Enviado".
```

---

## 14. Glosario rápido

- **Backend**: programa de servidor que hace el trabajo entre bastidores.
- **Frontend**: lo que corre en el navegador (HTML/CSS/JS).
- **HTTP**: protocolo de la web; el navegador lo usa para hablar con el backend.
- **TCP/IP**: la base sobre la que viajan los datos por la red.
- **Socket**: el "tubo" abierto entre dos programas para enviarse bytes.
- **Puerto**: número que identifica un servicio dentro de una máquina (25, 110, 3000...).
- **Protocolo**: reglas de la conversación (SMTP, POP3, HTTP...).
- **SMTP**: protocolo para **enviar** correo (puerto 25 aquí).
- **POP3**: protocolo para **descargar/leer** correo (puerto 110 aquí).
- **TLS/SSL**: capa de cifrado sobre el socket (aquí **no** se usa).
- **Base64**: forma de representar datos como texto seguro (no es cifrado).
- **MIME / RFC 822**: el formato interno de un correo (cabeceras + cuerpo + partes).
- **API REST**: conjunto de rutas HTTP organizadas por recurso y método.
- **Middleware**: función que se ejecuta antes de una ruta y puede mirar/cortar la petición.
- **`req` / `res`**: la petición que llega y la respuesta que enviamos.
- **Promesa / `async` / `await`**: herramientas para trabajar con operaciones que tardan.
- **Sesión / Cookie**: cómo el servidor "recuerda" que ya iniciaste sesión.
- **Helper**: función auxiliar pequeña y reutilizable.

---

¿Te has quedado con ganas de más? El mejor siguiente paso es abrir `server.js` y, con
esta guía al lado, leerlo de arriba abajo: ahora cada línea debería tener sentido. 🚀
