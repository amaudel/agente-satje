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

test("incluye el aviso de espera lenta y el script embebido sigue siendo valido", () => {
  const html = generarDashboardHTML({ causa: "01333-2021-04213" });
  assert.ok(html.includes('id="loadingAviso"'));
  assert.ok(html.includes("SATJE está tardando más de lo normal"));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const m of scripts) assert.doesNotThrow(() => new Function(m[1]));
});

test("los botones Ver detalle usan el estilo propio y mantienen chip-link para la navegacion SPA", () => {
  const html = generarDashboardHTML({ causa: "01333-2021-04213" });
  assert.ok(html.includes(".btn-detalle {"));
  assert.ok(html.includes("white-space: nowrap"));
  assert.ok(!html.includes("Ver Detalle ➔"));
  const contar = (s: string) => s.split('class="btn-detalle chip-link"').length - 1;
  assert.equal(contar(html), 2); // cedula y lote supervisor (se dibujan por JS)
  const conLote = generarDashboardHTML({ causa: "x" }, true, [{ causa: "01333-2021-04213", etapaProcesalGeneral: "A", etapaProcesalEspecifica: "B", poseeSentencia: false, estadoCicloVidaMedida: "X", fechaInscripcionMedida: null, alertaAbandono: "ok", alertaAbandonoObjeto: { badgeClass: "success" } }]);
  assert.equal(contar(conLote), 3); // + la tabla de lote
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
});

test("el lote supervisor muestra la columna Advertencia y las filas sin datos llevan el motivo en ella", () => {
  const html = generarDashboardHTML({ causa: "01333-2021-04213" });
  assert.ok(html.includes("<th>Advertencia</th>"));
  assert.ok(html.includes("Búsqueda incompleta"));
  assert.ok(html.includes("function htmlFilaSupervisor("));
  // 4 celdas base + 9 vacias + advertencia + accion = 15, igual que el encabezado
  assert.ok(html.includes("new Array(10).join('<td></td>')"));
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
});
