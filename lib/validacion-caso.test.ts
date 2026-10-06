import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarCaso, type Esperado } from "./validacion-caso.js";

// Misma forma que devuelve GET /api/v1/causas/{id}/actuaciones del backend.
const respuestaBackend = {
  success: true,
  idJuicio: "01333202308383",
  partialErrors: [],
  incidentes: [
    {
      idIncidenteJudicatura: 1,
      incidente: 1,
      nombreJudicatura: "UNIDAD JUDICIAL CIVIL CUENCA",
      actuaciones: [
        { codigo: 1, fecha: "2023-02-23T10:00:00.000+00:00", tipo: "CARATULA DE JUICIO", actividad: "Caratula" },
        { codigo: 2, fecha: "2023-03-01T10:00:00.000+00:00", tipo: "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO DE SUSTANCIACION)", actividad: "Se califica la demanda" },
        { codigo: 3, fecha: "2026-01-10T10:00:00.000+00:00", tipo: "PROVIDENCIA", actividad: "Se dispone el embargo del bien inmueble. Ofíciese al Registrador de la Propiedad." },
      ],
    },
    {
      idIncidenteJudicatura: 2,
      incidente: 2,
      nombreJudicatura: "UNIDAD JUDICIAL CIVIL CON SEDE EN EL CANTON AZOGUES",
      actuaciones: [
        { codigo: 9, fecha: "2023-05-15T10:00:00.000+00:00", tipo: "DILIGENCIA DEPRECATORIO", actividad: "Recibido el deprecatorio, se califica" },
        { codigo: 10, fecha: "2023-06-01T10:00:00.000+00:00", tipo: "RAZON", actividad: "Razon de citacion" },
      ],
    },
  ],
};

const esperado: Esperado = {
  juicio: "01333-2023-08383",
  etapaGeneral: "10. EJECUCION",
  etapa: "10.6. Ejec. - Embargo bien inmueble",
  medida: "EMBARGO",
  fechaInscripcion: "",
  unidadDeprecada: "UNIDAD JUDICIAL CIVIL CON SEDE EN EL CANTON AZOGUES",
  fechaCalifDeprecatorio: "2023-05-15 00:00:00",
  fechaEtapa: "2026-01-10",
  fechaGestion: "2026-08-01",
  controlAbandono: ">5M",
};

test("evalua un caso completo y devuelve una comparacion por columna", () => {
  const r = evaluarCaso(esperado, respuestaBackend, new Date("2026-10-06T12:00:00Z"));
  assert.equal(r.ok, true);
  assert.equal(r.totalActuaciones, 5);
  assert.ok(r.comparaciones.etapaGeneral);
  assert.ok(r.comparaciones.etapa);
  assert.ok(r.comparaciones.medida);
  assert.ok(r.comparaciones.fechaInscripcion);
  assert.ok(r.comparaciones.controlAbandono);
  for (const c of Object.values(r.comparaciones)) {
    assert.ok(["acierto", "discrepa", "sin_dato_manual", "sin_dato_herramienta"].includes(c.resultado));
  }
});

test("el resumen de incidentes permite estudiar la unidad deprecada sin datos personales", () => {
  const r = evaluarCaso(esperado, respuestaBackend, new Date("2026-10-06T12:00:00Z"));
  assert.equal(r.incidentes.length, 2);
  assert.equal(r.incidentes[1].judicatura, "UNIDAD JUDICIAL CIVIL CON SEDE EN EL CANTON AZOGUES");
  assert.equal(r.incidentes[1].primeraFecha, "2023-05-15");
  assert.equal(r.incidentes[1].total, 2);
  assert.ok(r.incidentes[1].tipos.length <= 3);
});

test("una respuesta con errores parciales se marca como parcial", () => {
  const parcial = { ...respuestaBackend, success: false, partialErrors: [{ code: "SATJE_TIMEOUT" }] };
  const r = evaluarCaso(esperado, parcial, new Date("2026-10-06T12:00:00Z"));
  assert.equal(r.parcial, true);
});

test("sin actuaciones no inventa datos: ok=false con motivo", () => {
  const r = evaluarCaso(esperado, { success: true, incidentes: [] }, new Date("2026-10-06T12:00:00Z"));
  assert.equal(r.ok, false);
  assert.match(r.motivo ?? "", /sin actuaciones/);
});

test("guarda las ultimas actuaciones (tipo y palabras clave, sin el texto) para estudiar la etapa", () => {
  const r = evaluarCaso(esperado, respuestaBackend, new Date("2026-10-06T12:00:00Z"));
  assert.ok(r.ultimas.length > 0 && r.ultimas.length <= 8);
  // la mas reciente primero
  assert.equal(r.ultimas[0].fecha, "2026-01-10");
  assert.equal(r.ultimas[0].tipo, "PROVIDENCIA");
  assert.ok(r.ultimas[0].claves.includes("embargo"));
  // el texto libre de la actuacion (puede traer nombres) no se guarda
  assert.ok(!JSON.stringify(r.ultimas).includes("Registrador de la Propiedad"));
});
