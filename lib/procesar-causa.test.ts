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
    urls[0].endsWith("/api/v1/causas/01U03202373295/actuaciones"),
    `la primera consulta debia usar el id con letras y fue ${urls[0]}`
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
