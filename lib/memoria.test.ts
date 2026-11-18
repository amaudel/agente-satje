import { test } from "node:test";
import assert from "node:assert/strict";
import { configMemoria, guardarNotaCausa, leerNotaCausa, numeroCausaNormalizado, rutaNotaCausa } from "./memoria.js";

const CFG = { url: "https://memoria.test/mcp", clave: "mem_prueba" };

function simularMemoria(respuestas: Record<string, { texto: string; esError?: boolean } | "caida">) {
  const llamadas: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    const cuerpo = JSON.parse(init.body);
    llamadas.push({ cuerpo, clave: init.headers["X-API-Key"] });
    const r = respuestas[cuerpo.params.name];
    if (r === "caida" || !r) throw new Error("conexion rechazada");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: cuerpo.id, result: { content: [{ type: "text", text: r.texto }], isError: Boolean(r.esError) } }), { status: 200 });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

test("normaliza el numero de causa para el nombre de la nota", () => {
  assert.equal(numeroCausaNormalizado("01333202310725"), "01333-2023-10725");
  assert.equal(numeroCausaNormalizado(" 01333-2023-10725 "), "01333-2023-10725");
  assert.equal(rutaNotaCausa("01333202310725"), "juicios/01333-2023-10725.md");
  assert.throws(() => rutaNotaCausa("../../x"));
});

test("sin variables de entorno la memoria queda apagada y nada falla", async () => {
  assert.equal(configMemoria({}), null);
  assert.equal(await leerNotaCausa(null, "01333-2023-10725"), "");
  assert.equal((await guardarNotaCausa(null, "01333-2023-10725", "algo")).ok, false);
});

test("lee la nota de la causa sin la linea de version", async () => {
  const m = simularMemoria({ leer_nota: { texto: "<!-- version: abc123 -->\n# Juicio\n- 2026-11-17: jueza nego abandono" } });
  try {
    const nota = await leerNotaCausa(CFG, "01333202310725");
    assert.equal(nota, "# Juicio\n- 2026-11-17: jueza nego abandono");
    assert.equal(m.llamadas[0].cuerpo.params.arguments.ruta, "juicios/01333-2023-10725.md");
    assert.equal(m.llamadas[0].clave, "mem_prueba");
  } finally { m.restaurar(); }
});

test("si la memoria esta caida, el chat sigue sin nota", async () => {
  const m = simularMemoria({ leer_nota: "caida" });
  try { assert.equal(await leerNotaCausa(CFG, "01333-2023-10725"), ""); } finally { m.restaurar(); }
});

test("guardar crea la nota si no existe, con fecha", async () => {
  const m = simularMemoria({
    editar_nota: { texto: "No existe la nota 'juicios/01333-2023-10725.md'. Use crear_nota.", esError: true },
    crear_nota: { texto: "Nota creada" },
  });
  try {
    const r = await guardarNotaCausa(CFG, "01333202310725", "La jueza nego el abandono (actuacion 225792943).", new Date("2026-11-18T20:00:00Z"));
    assert.equal(r.ok, true);
    const creada = m.llamadas[1].cuerpo.params.arguments;
    assert.match(creada.contenido, /- 2026-11-18: La jueza nego el abandono/);
    assert.equal(creada.ruta, "juicios/01333-2023-10725.md");
  } finally { m.restaurar(); }
});

test("guardar agrega al final si la nota ya existe", async () => {
  const m = simularMemoria({ editar_nota: { texto: "Nota actualizada" } });
  try {
    const r = await guardarNotaCausa(CFG, "01333-2023-10725", "Citacion pendiente en El Guabo.");
    assert.equal(r.ok, true);
    assert.equal(m.llamadas.length, 1);
    assert.equal(m.llamadas[0].cuerpo.params.arguments.modo, "agregar");
  } finally { m.restaurar(); }
});
