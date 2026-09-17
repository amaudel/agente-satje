import type { VercelRequest } from "@vercel/node";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "satje_session";

// Duracion de la sesion (7 dias). Se usa tambien en el Max-Age de la cookie.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// La clave del HMAC es la propia contrasena salvo que se configure un
// SATJE_SESSION_SECRET dedicado. Con esto, cambiar la contrasena invalida
// automaticamente todas las sesiones emitidas.
function sessionSecret(password: string): string {
  return process.env.SATJE_SESSION_SECRET || password;
}

function firmar(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Comparacion de tiempo constante sobre digests de longitud fija: no filtra
// ni el contenido ni la longitud de ninguno de los dos valores.
export function safeCompare(a: unknown, b: unknown): boolean {
  const hashA = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hashB = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// El token de sesion es "<expiracion>.<hmac>". Antes era sha256(contrasena),
// un valor deterministico y sin sal que, si se filtraba una cookie, exponia
// un hash de la contrasena verificable offline con un diccionario.
export function createSessionToken(password: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = String(exp);
  return `${payload}.${firmar(payload, sessionSecret(password))}`;
}

export function verifySessionToken(
  token: string | undefined,
  password: string,
  nowMs: number = Date.now()
): boolean {
  if (!token) return false;
  const idx = token.indexOf(".");
  if (idx <= 0) return false;

  const payload = token.slice(0, idx);
  const firma = token.slice(idx + 1);

  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp <= Math.floor(nowMs / 1000)) return false;

  return safeCompare(firma, firmar(payload, sessionSecret(password)));
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isAuthenticated(req: VercelRequest, authPassword: string | undefined): boolean {
  if (!authPassword) return false;
  const provided = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  return verifySessionToken(provided, authPassword);
}

export function generarLoginHTML(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Agente SATJE Ecuador — Acceso</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#0b0f19; --accent:#38bdf8; --text:#f8fafc; --muted:#94a3b8; --border:#334155; --danger:#f43f5e; }
    * { box-sizing: border-box; margin:0; padding:0; font-family:'Plus Jakarta Sans', sans-serif; }
    body { background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1.5rem; }
    .card { background:rgba(30,41,59,0.85); border:1px solid var(--border); border-radius:1.2rem; padding:2.5rem 2rem; max-width:400px; width:100%; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.5); }
    .logo { width:56px; height:56px; margin:0 auto 1rem; border-radius:1rem; background:linear-gradient(135deg,#38bdf8,#818cf8); display:flex; align-items:center; justify-content:center; font-size:1.7rem; }
    h1 { font-size:1.3rem; margin-bottom:0.4rem; }
    p.sub { color:var(--muted); font-size:0.9rem; margin-bottom:1.5rem; }
    input { width:100%; padding:0.85rem 1rem; background:#060911; border:1px solid var(--border); border-radius:0.6rem; color:#fff; font-size:1rem; margin-bottom:1rem; outline:none; }
    input:focus { border-color:var(--accent); }
    button { width:100%; padding:0.85rem; background:linear-gradient(135deg,#38bdf8,#818cf8); color:#0f172a; font-weight:800; border:none; border-radius:0.6rem; cursor:pointer; font-size:1rem; }
    .err { color:var(--danger); font-size:0.85rem; margin-bottom:1rem; min-height:1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚖️</div>
    <h1>Agente Judicial SATJE</h1>
    <p class="sub">Ingresa la contraseña de acceso para continuar.</p>
    <div class="err" id="loginErr"></div>
    <form id="loginForm">
      <input type="password" id="passInput" placeholder="Contraseña" required autofocus />
      <button type="submit">Ingresar</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = document.getElementById('passInput').value;
      var errBox = document.getElementById('loginErr');
      errBox.textContent = '';
      fetch('/?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', password: pass }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            window.location.reload();
          } else {
            errBox.textContent = data.error || 'Contraseña incorrecta';
          }
        })
        .catch(function () {
          errBox.textContent = 'Error de conexión, intenta de nuevo.';
        });
    });
  </script>
</body>
</html>`;
}
