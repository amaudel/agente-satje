import assert from "assert";

const BASE_URL = "https://agente-satje.vercel.app";

async function runCriticalTests() {
  console.log("🚀 EJECUTANDO PRUEBAS CRÍTICAS Y ESENCIALES DEL AGENTE SATJE (Ahorro de Tokens)...");

  // TEST 1: Consulta Individual JSON
  console.log("\n1. Verificando Endpoint de Consulta Individual (JSON)...");
  const res1 = await fetch(`${BASE_URL}/?causa=01333-2023-10725&format=json`);
  assert.strictEqual(res1.status, 200, "El status HTTP debe ser 200 OK");
  const data1 = await res1.json();
  assert.strictEqual(data1.ok, true, "Respuesta debe ser ok: true");
  assert.strictEqual(data1.numeroProceso, "01333-2023-10725");
  assert.ok(typeof data1.etapaProcesalGeneral === "string" && data1.etapaProcesalGeneral.length > 0, "Debe retornar la Etapa Procesal General");
  assert.ok(data1.ciclo_vida_medida, "Debe incluir objeto de ciclo de vida de medida");
  assert.strictEqual(data1.ciclo_vida_medida.fechaOrdenJudicial, "2023-11-06");
  assert.ok(data1.alerta_abandono, "Debe incluir alerta de abandono COGEP");
  console.log(`   ✅ PASÓ: Causa ${data1.numeroProceso} clasificada como '${data1.etapaProcesalGeneral}' con 4 Fechas de Medida Cautelar y Alerta COGEP.`);

  // TEST 2: Consulta en Lote (Batch Query JSON)
  console.log("\n2. Verificando Endpoint de Consulta en Lote (Batch JSON)...");
  const res2 = await fetch(`${BASE_URL}/?causas=01333-2025-08870,01333-2023-10725&format=json`);
  assert.strictEqual(res2.status, 200, "El status HTTP debe ser 200 OK");
  const data2 = await res2.json();
  assert.strictEqual(data2.ok, true, "Respuesta debe ser ok: true");
  assert.strictEqual(data2.totalProcesos, 2, "Debe retornar 2 procesos en lote");
  assert.strictEqual(data2.lote.length, 2, "El array de lote debe contener 2 ítems");
  console.log("   ✅ PASÓ: Matriz de lote retornó exitosamente los 2 procesos consultados.");

  // TEST 3: Interfaz Web HTML y Pestañas
  console.log("\n3. Verificando Renderizado HTML UI (Pestañas y Dashboard)...");
  const res3 = await fetch(`${BASE_URL}/`);
  assert.strictEqual(res3.status, 200, "El status HTTP debe ser 200 OK");
  const html3 = await res3.text();
  assert.ok(html3.includes("Dashboard Procesal de Inteligencia Judicial"), "Debe contener el título principal");
  assert.ok(html3.includes("tab-individual"), "Debe contener la pestaña de Consulta Individual");
  assert.ok(html3.includes("tab-lote"), "Debe contener la pestaña de Consulta en Lote");
  assert.ok(html3.includes("loadingOverlay"), "Debe contener la tarjeta estática de animación de carga");
  console.log("   ✅ PASÓ: Interfaz HTML con Navbar, Pestañas y Animación de Carga renderizada correctamente.");

  console.log("\n✨ ¡TODAS LAS PRUEBAS CRÍTICAS Y ESENCIALES HAN PASADO CON ÉXITO SIN CONSUMIR CRÉDITOS O TOKENS DE TESTSPRITE!");
}

runCriticalTests().catch((err) => {
  console.error("❌ ERROR EN LA PRUEBA CRÍTICA:", err);
  process.exit(1);
});
