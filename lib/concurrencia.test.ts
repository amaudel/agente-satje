import { test } from "node:test";
import assert from "node:assert/strict";
import { mapConcurrente } from "./concurrencia.js";

test("preserva el orden de los resultados", async () => {
  const items = [40, 5, 20, 1, 10];
  const salida = await mapConcurrente(items, 2, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms * 2;
  });
  assert.deepEqual(salida, [80, 10, 40, 2, 20]);
});

test("nunca supera el limite de promesas en vuelo", async () => {
  let enVuelo = 0;
  let pico = 0;
  await mapConcurrente(Array.from({ length: 25 }, (_, i) => i), 4, async () => {
    enVuelo++;
    pico = Math.max(pico, enVuelo);
    await new Promise((r) => setTimeout(r, 5));
    enVuelo--;
    return true;
  });
  assert.ok(pico <= 4, `pico fue ${pico}`);
  assert.ok(pico > 1, "deberia haber paralelismo real");
});

test("recorre todos los elementos exactamente una vez", async () => {
  const vistos = [];
  const salida = await mapConcurrente([1, 2, 3, 4, 5, 6, 7], 3, async (n, i) => {
    vistos.push(n);
    return n * 10;
  });
  assert.equal(vistos.length, 7);
  assert.deepEqual(salida, [10, 20, 30, 40, 50, 60, 70]);
});

test("maneja listas vacias y limite mayor que la lista", async () => {
  assert.deepEqual(await mapConcurrente([], 4, async () => 1), []);
  assert.deepEqual(await mapConcurrente([1, 2], 99, async (n) => n + 1), [2, 3]);
});

test("propaga el error de la funcion", async () => {
  await assert.rejects(
    mapConcurrente([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("fallo esperado");
      return n;
    }),
    /fallo esperado/
  );
});
