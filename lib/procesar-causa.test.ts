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
  const completa = {
    success: true,
    partialErrors: [],
    incidentes: [
      { incidente: 1, nombreJudicatura: "UNIDAD JUDICIAL CIVIL CUENCA", actuaciones: [{ codigo: 2, fecha: "2026-08-01T10:00:00.000+00:00", tipo: "CARATULA DE JUICIO" }] },
      respuestaParcial.incidentes[1],
    ],
  };
  await conFetch(completa, async () => {
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
    assert.match(r.alertaAbandonoObjeto.relojDeprecatorioInfo || "", /21 jul 2025/);
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

// Caso real 01333-2025-08870: sentencia (10-sep-2026) y razon de ejecutoria,
// pero la API marcaba VENCIDO por un deprecatorio ya devuelto cumplido.
test("con sentencia, el VENCIDO de la API no pisa el 'improcedente' local", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/abandono/riesgo")) return new Response(JSON.stringify({
      success: true, analysisStatus: "COMPLETE", partial: false,
      alertaGeneral: { ambitoMasCercano: "unidad_deprecada", diasRestantes: -5, fechaReferencialAbandono: "2026-11-11" },
      relojProcesoPrincipal: { ultimaActuacion: { fecha: "2026-09-25" } },
      relojUnidadDeprecada: { ultimaActuacion: { fecha: "2026-05-11", actividadResumen: "DEVOLUCION DEPRECATORIO POR CUMPLIMIENTO DE DILIGENCIA" } },
    }), { status: 200 });
    return new Response(JSON.stringify({ success: true, partialErrors: [], incidentes: [{ nombreJudicatura: "CUENCA", actuaciones: [
      { codigo: 3, fecha: "2026-09-25T10:00:00.000+00:00", tipo: "RAZON DE EJECUTORIA" },
      { codigo: 2, fecha: "2026-09-10T10:00:00.000+00:00", tipo: "SENTENCIA" },
      { codigo: 1, fecha: "2025-06-01T10:00:00.000+00:00", tipo: "CARATULA DE JUICIO" },
    ] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const r: any = await procesarCausaIndividual("01333-2025-08870", "https://backend.test", "k");
    assert.equal(r.poseeSentencia, true);
    assert.equal(r.alertaAbandonoObjeto.nivel, "improcedente");
    assert.doesNotMatch(r.alertaAbandonoObjeto.etiqueta, /VENCIDO/);
  } finally { globalThis.fetch = original; }
});

test("si solo responde el resumen del agente (20 actuaciones), se marca incompleto", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/abandono/riesgo")) return new Response("x", { status: 504 });
    if (u.includes("/agent/satje")) return new Response(JSON.stringify({ success: true, incidentes: [{ actuaciones: [{ fecha: "2026-09-01", tipo: "AUDIENCIA UNICA" }] }] }), { status: 200 });
    return new Response("upstream", { status: 502 });
  }) as typeof fetch;
  try {
    const r: any = await procesarCausaIndividual("01333-2025-08870", "https://backend.test", "k");
    assert.equal(r.datosIncompletos, true);
    assert.ok(r.erroresParciales.some((e: any) => e.code === "ACTUACIONES_RESUMIDAS"));
  } finally { globalThis.fetch = original; }
});

test("si el juez ya nego un abandono, la alerta lo menciona", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/abandono/riesgo")) return new Response(JSON.stringify({
      success: true, analysisStatus: "COMPLETE", partial: false,
      alertaGeneral: { ambitoMasCercano: "proceso_principal", diasRestantes: -436, fechaReferencialAbandono: "2025-09-07" },
      relojProcesoPrincipal: { ultimaActuacion: { fecha: "2025-03-06" } },
      advertencias: ["El juez ya declaro improcedente un pedido de abandono el 2025-02-25: revise si la demora sigue dependiendo del juzgado o de una diligencia deprecada."],
    }), { status: 200 });
    return new Response(JSON.stringify({ success: true, partialErrors: [], incidentes: [{ actuaciones: [{ fecha: "2025-03-06", tipo: "RAZON" }] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const r: any = await procesarCausaIndividual("01333-2023-10725", "https://backend.test", "k");
    assert.match(r.alertaAbandonoObjeto.explicacion, /improcedente un pedido de abandono el 25 feb 2025/);
  } finally { globalThis.fetch = original; }
});

test("la tarjeta toma 'inscrita' de la API cuando el Registro adjunto la razon", async () => {
  const { aplicarConfirmacionMedidaApi, esPosibleRespuestaRegistro } = await import("./procesar-causa.js");
  const local = {
    estadoCicloVida: "INSCRIPCION_NO_CONFIRMADA",
    observacion: "Posible respuesta del Registro presentada el 2023-11-30. Leer el documento...",
    fechaOrdenJudicial: "2023-11-06", fechaOficio: "2023-11-16", fechaInscripcion: null, confianza: "BAJA",
  };
  assert.equal(esPosibleRespuestaRegistro(local), true);
  const api = { data: [{ estado: "INSCRIPCION_CONFIRMADA", confianza: "MEDIA", fechaInscripcion: null,
    evidencia: { origen: "documento_hba", fechaActuacionSatje: "2023-11-30T16:51:06Z", nombreArchivo: "FE PRESENTACION_59820127" } }] };
  const r = aplicarConfirmacionMedidaApi(local, api);
  assert.equal(r.estadoCicloVida, "INSCRIPCION_CONFIRMADA");
  assert.equal(r.confianza, "MEDIA");
  assert.equal(r.fechaOficio, "2023-11-16");
  assert.match(r.evidenciaTextual, /2023-11-30/);
  // Si la API no tiene un documento que lo pruebe, no se cambia nada.
  const sinDoc = { data: [{ estado: "INSCRIPCION_CONFIRMADA", evidencia: { origen: "actuacion" } }] };
  assert.equal(aplicarConfirmacionMedidaApi(local, sinDoc), local);
  assert.equal(aplicarConfirmacionMedidaApi(local, { data: [] }), local);
});

test("falta el juzgado principal: solo hay actuaciones del incidente 2", async () => {
  const { faltaJuzgadoPrincipal } = await import("./procesar-causa.js");
  assert.equal(faltaJuzgadoPrincipal([{ incidente: 2 }, { incidente: 2 }]), true);
  assert.equal(faltaJuzgadoPrincipal([{ incidente: 1 }, { incidente: 2 }]), false);
  assert.equal(faltaJuzgadoPrincipal([{ incidente: 2 }, {}]), false); // sin numeracion completa no se juzga
  assert.equal(faltaJuzgadoPrincipal([]), false);
});

test("SATJE devuelve solo el deprecatorio: se marca incompleto aunque no lo reporte", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/abandono/riesgo")) return new Response("x", { status: 504 });
    return new Response(JSON.stringify({ success: true, partialErrors: [], incidentes: [
      { incidente: 2, nombreJudicatura: "EL GUABO", actuaciones: [{ codigo: 1, fecha: "2025-07-21T10:00:00Z", tipo: "OFICIO" }] },
    ] }), { status: 200 });
  }) as typeof fetch;
  try {
    const r: any = await procesarCausaIndividual("01333-2023-10725", "https://backend.test", "k");
    assert.equal(r.datosIncompletos, true);
    assert.ok(r.erroresParciales.some((e: any) => e.code === "FALTA_JUZGADO_PRINCIPAL"));
  } finally { globalThis.fetch = original; }
});
