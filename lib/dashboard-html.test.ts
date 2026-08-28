import { test } from "node:test";
import assert from "node:assert/strict";
import { generarDashboardHTML } from "./dashboard-html.js";

// A2: XSS reflejado via el parametro `causa` (normalizarNumeroCausa devuelve el
// input tal cual si no tiene 13-16 digitos, asi que un payload llega intacto al
// render del dashboard). Verificamos que se escapa en atributo, textarea, texto
// del chat y contexto JS del <script>.

test("escapa causa en el atributo value del buscador individual", () => {
  const html = generarDashboardHTML({ causa: 'x" onfocus="alert(1)' });
  assert.ok(html.includes('value="x&quot; onfocus=&quot;alert(1)"'));
  assert.ok(!html.includes('value="x" onfocus='));
});

test("escapa causa en el textarea del lote", () => {
  const html = generarDashboardHTML({ causa: '"><script>alert(1)</script>' }, true, []);
  assert.ok(!html.includes('"><script>alert(1)</script>'));
  assert.ok(html.includes("&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("escapa causa en el mensaje de bienvenida del chat", () => {
  const html = generarDashboardHTML({ causa: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("serializa causa como string JS seguro dentro del <script>", () => {
  const html = generarDashboardHTML({ causa: '";alert(1)//' });
  // Debe quedar como literal JSON valido (con comilla escapada), no como cierre
  // del string JS del dashboard.
  assert.ok(html.includes('|| "\\";alert(1)//";'));
  assert.ok(!html.includes('|| "";alert(1)//"'));
});

test("neutraliza </script> dentro del contexto JS", () => {
  const html = generarDashboardHTML({ causa: "</script><script>alert(1)</script>" });
  // jsString convierte TODOS los `<` en \u003c, asi el bloque script del
  // dashboard no puede cerrarse ni abrirse desde el valor interpolado.
  assert.ok(!html.includes('|| "</script><script>alert(1)</script>";'));
  assert.ok(html.includes("|| \"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>\";"));
});

test("no rompe el caso normal sin payload", () => {
  const html = generarDashboardHTML({ causa: "01333-2025-08870" });
  assert.ok(html.includes('value="01333-2025-08870"'));
  assert.ok(html.includes('|| "01333-2025-08870";'));
});
