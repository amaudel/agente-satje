import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarCausaIndividual } from "./procesar-causa.js";

test("consulta el backend con el identificador completo, letras incluidas", async () => {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    await procesarCausaIndividual("01U03202373295", "https://backend.test", "k");
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(urls.length > 0);
  assert.ok(
    urls.some((u) => u.endsWith("/api/v1/causas/01U03202373295/actuaciones")),
    `debe consultar las actuaciones usando el id con letras; URLs: ${urls.join(", ")}`
  );
  assert.ok(urls.every((u) => !u.includes("01032")), "no debe aparecer el numero deformado");
});

// Respuesta real del backend cuando SATJE no alcanza a contestar todo: el
// incidente principal viene vacio y solo llega el del deprecatorio.
const respuestaParcial = {
  success: false,
  partialErrors: [{ code: "SATJE_TIMEOUT", stage: "actuacionesJudiciales", retryable: true }],
  incidentes: [
    { incidente: 1, nombreJudicatura: "UNIDAD JUDICIAL CIVIL CUENCA", actuaciones: [] },
    {
      incidente: 2,
      nombreJudicatura: "UNIDAD JUDICIAL CIVIL MACHALA",
      actuaciones: [{ codigo: 1, fecha: "2026-09-01T10:00:00.000+00:00", tipo: "CARATULA SORTEO DE DEPRECATORIOS" }],
    },
  ],
};

async function conFetch(cuerpo: unknown, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("una respuesta parcial de SATJE se marca como datos incompletos", async () => {
  await conFetch(respuestaParcial, async () => {
    const r: any = await procesarCausaIndividual("01333202610304", "https://backend.test", "k");
    assert.equal(r.datosIncompletos, true);
    assert.equal(r.erroresParciales[0].code, "SATJE_TIMEOUT");
    assert.equal(r.erroresParciales[0].retryable, true);
  });
});

test("una respuesta completa no se marca como incompleta", async () => {
  await conFetch({ ...respuestaParcial, success: true, partialErrors: [] }, async () => {
    const r: any = await procesarCausaIndividual("01333202610304", "https://backend.test", "k");
    assert.equal(r.datosIncompletos, false);
    assert.deepEqual(r.erroresParciales, []);
  });
});

test("la fecha de ingreso es la de la primera actuacion del expediente", async () => {
  const cuerpo = {
    success: true,
    partialErrors: [],
    incidentes: [
      { incidente: 2, nombreJudicatura: "MACHALA", actuaciones: [{ codigo: 9, fecha: "2021-10-20T10:00:00.000+00:00", tipo: "RAZON (RAZON)" }] },
      {
        incidente: 1,
        nombreJudicatura: "CUENCA",
        actuaciones: [
          { codigo: 2, fecha: "2021-06-14T10:00:00.000+00:00", tipo: "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)" },
          { codigo: 1, fecha: "2021-06-11T10:00:00.000+00:00", tipo: "CARATULA DE JUICIO" },
        ],
      },
    ],
  };
  await conFetch(cuerpo, async () => {
    const r: any = await procesarCausaIndividual("01333202104334", "https://backend.test", "k");
    assert.equal(r.fechaIngreso, "2021-06-11");
  });
});

test("sin actuaciones no hay fecha de ingreso", async () => {
  await conFetch({ success: true, partialErrors: [], incidentes: [] }, async () => {
    const r: any = await procesarCausaIndividual("01333202104334", "https://backend.test", "k");
    assert.equal(r.fechaIngreso, null);
  });
});


test("dos relojes: usa fecha y plazo determinantes del análisis especializado", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/abandono/riesgo")) return new Response(JSON.stringify({
      success: true, analysisStatus: "COMPLETE", partial: false,
      alertaGeneral: { ambitoMasCercano: "proceso_principal", diasRestantes: -863, fechaReferencialAbandono: "2024-06-01" },
      relojProcesoPrincipal: { ultimaActuacion: { fecha: "2023-11-30" } },
      relojUnidadDeprecada: { ultimaActuacion: { fecha: "2025-07-21" } },
    }), { status: 200 });
    return new Response(JSON.stringify({ success: true, incidentes: [{ nombreJudicatura: "Cuenca", actuaciones: [{ fecha: "2025-03-06", tipo: "CALIFICACION" }] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await procesarCausaIndividual("01333-2023-10725", "https://backend.test", "k");
    assert.equal(r.alertaAbandonoObjeto.fechaUltimaActuacion, "2023-11-30");
    assert.equal(r.alertaAbandonoObjeto.diasRestantes, -863);
    assert.match(r.alertaAbandonoObjeto.relojDeprecatorioInfo || "", /2025-07-21/);
  } finally { globalThis.fetch = original; }
});

test("timeout especializado: advierte que el cálculo local es provisional", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/abandono/riesgo")) return new Response("timeout", { status: 504 });
    return new Response(JSON.stringify({ success: true, incidentes: [{ actuaciones: [{ fecha: "2025-03-06", tipo: "CALIFICACION" }] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await procesarCausaIndividual("01333-2024-12766", "https://backend.test", "k");
    assert.match(r.alertaAbandonoObjeto.etiqueta, /provisional/);
  } finally { globalThis.fetch = original; }
});
