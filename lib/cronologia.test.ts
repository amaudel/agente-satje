import { test } from "node:test";
import assert from "node:assert/strict";
import { esHito, juzgadoCorto, notasDeMemoria, ordenarRecientesPrimero } from "./cronologia.js";

test("nombre corto del juzgado", () => {
  assert.equal(juzgadoCorto("UNIDAD JUDICIAL CIVIL CON SEDE EN EL CANTÓN MACHALA"), "Machala");
  assert.equal(juzgadoCorto("UNIDAD JUDICIAL MULTICOMPETENTE CIVIL CON SEDE EN EL CANTÓN EL GUABO"), "El Guabo");
  assert.equal(juzgadoCorto("UNIDAD JUDICIAL CIVIL CUENCA"), "Cuenca");
  assert.equal(juzgadoCorto(""), "Sin juzgado");
});

test("hitos: sentencia, inscripcion, abandono; no las razones de notificacion", () => {
  assert.equal(esHito({ tipo: "SENTENCIA", actividad: "..." }), true);
  assert.equal(esHito({ tipo: "OFICIO", actividad: "se adjunta Razón de Inscripción" }), true);
  assert.equal(esHito({ tipo: "NOTIFICACION (AUTO DE SUSTANCIACION)", actividad: "el abandono requerido resulta improcedente" }), true);
  assert.equal(esHito({ tipo: "NOTIFICACION (RAZON DE NOTIFICACION)", actividad: "notifiqué la SENTENCIA" }), false);
  assert.equal(esHito({ tipo: "ESCRITO", actividad: "Escrito, FePresentacion" }), false);
});

test("orden por fecha, la mas reciente primero", () => {
  const r = ordenarRecientesPrimero([{ fecha: "2023-11-16T10:00:00Z" }, { fecha: "2025-07-21T10:00:00Z" }, { fecha: "2024-06-17T10:00:00Z" }]);
  assert.deepEqual(r.map((a: any) => a.fecha.slice(0, 4)), ["2025", "2024", "2023"]);
});

test("notas de la memoria, la mas reciente primero", () => {
  const n = notasDeMemoria("# Juicio\n\nIntro\n\n- 2026-11-17: primera\n- 2026-11-18: segunda\n");
  assert.deepEqual(n, [{ fecha: "2026-11-18", texto: "segunda" }, { fecha: "2026-11-17", texto: "primera" }]);
  assert.deepEqual(notasDeMemoria(""), []);
});
