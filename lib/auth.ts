import type { VercelRequest } from "@vercel/node";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "satje_session";

export function sessionTokenFor(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
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
  if (!provided) return false;
  const expected = sessionTokenFor(authPassword);
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
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
