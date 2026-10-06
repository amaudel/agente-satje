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
