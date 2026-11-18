import { test } from "node:test";
import assert from "node:assert/strict";
import { construirResumenRapido, fechaLegible } from "./resumen-rapido.js";

test("fechas legibles en hora de Ecuador", () => {
  assert.equal(fechaLegible("2023-11-30T16:51:06.000+00:00"), "30 nov 2023, 11:51");
  assert.equal(fechaLegible("2023-11-06"), "6 nov 2023");
  assert.equal(fechaLegible("2023-11-30T16:51:06Z", false), "30 nov 2023");
  assert.equal(fechaLegible(""), "");
});

test("caso 01333-2023-10725: citacion, medida inscrita, abandono a revisar", () => {
  const r = construirResumenRapido({
    etapa: { etapaGeneral: "04. CITACIÓN", etapaEspecifica: "04.3. Cita. - Deprecatorio", codigoEtapa: "04" },
    poseeSentencia: false,
    cautelar: { medidaDetectada: true, estadoCicloVida: "INSCRIPCION_CONFIRMADA", tipoMedida: "PROHIBICIÓN DE ENAJENAR", institucionEjecutora: "REGISTRO DE LA PROPIEDAD", fechaInscripcion: null, fechaActuacionSatje: "2023-11-30" },
    abandono: { nivel: "vencido", diasRestantes: -437, explicacion: "Indicador... ⚖️ El juez ya declaro improcedente un pedido de abandono el 2025-02-25: revise..." },
  });
  assert.deepEqual(r.filas.map((f) => f.tono), ["curso", "favor", "revisar"]);
  assert.match(r.filas[0].texto, /^CITACIÓN/);
  assert.match(r.filas[1].texto, /razón presentada el 30 nov 2023/);
  assert.match(r.siguientePaso.texto, /citación/);
  assert.doesNotMatch(JSON.stringify(r), /INSCRIPCION_CONFIRMADA|null|N\/A/);
});

test("abandono vencido sin decision del juez: riesgo e impulso urgente", () => {
  const r = construirResumenRapido({
    etapa: { etapaGeneral: "05. CONTESTACIÓN" }, poseeSentencia: false,
    cautelar: { medidaDetectada: false }, abandono: { nivel: "vencido", diasRestantes: -10, explicacion: "" },
  });
  assert.equal(r.filas[2].tono, "riesgo");
  assert.match(r.siguientePaso.texto, /impulso/);
});

test("con sentencia el abandono no corre", () => {
  const r = construirResumenRapido({
    etapa: { etapaGeneral: "08. RAZÓN DE EJECUTORIA" }, poseeSentencia: true, fechaSentencia: "2026-09-10",
    cautelar: { medidaDetectada: false }, abandono: { nivel: "improcedente", diasRestantes: 0 },
  });
  assert.equal(r.filas[2].tono, "favor");
  assert.match(r.siguientePaso.texto, /ejecuci/);
});
