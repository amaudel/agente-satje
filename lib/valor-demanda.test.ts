import { test } from "node:test";
import assert from "node:assert/strict";
import { elegirActuacionesParaValor, interpretarRespuestaValor, valorApareceEnTexto, type DocTexto } from "./valor-demanda.js";

const a = (codigo: number, fecha: string, tipo: string) => ({ codigo, fecha: `${fecha}T10:00:00.000+00:00`, tipo });

test("elige las actuaciones del inicio que pueden traer la cuantia, la mas antigua primero", () => {
  const acts = [
    a(9, "2026-10-01", "ESCRITO"),
    a(5, "2026-09-12", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO DE SUSTANCIACION)"),
    a(2, "2026-09-09", "ACTA DE SORTEO"),
    a(1, "2026-09-09", "CARATULA DE JUICIO"),
    a(4, "2026-09-10", "ESCRITO"),
    a(7, "2026-09-20", "RAZON (RAZON)"),
  ];
  const elegidas = elegirActuacionesParaValor(acts, 3);
  assert.deepEqual(elegidas.map((x) => x.codigo), [4, 5, 9]);
});

test("no elige actas de sorteo, caratulas ni razones", () => {
  const elegidas = elegirActuacionesParaValor([a(1, "2026-09-09", "ACTA DE SORTEO"), a(2, "2026-09-09", "CARATULA DE JUICIO"), a(3, "2026-09-10", "RAZON (RAZON)")]);
  assert.equal(elegidas.length, 0);
});

test("ignora actuaciones sin codigo (no se puede pedir su documento)", () => {
  const elegidas = elegirActuacionesParaValor([{ fecha: "2026-09-10T10:00:00.000+00:00", tipo: "ESCRITO" }]);
  assert.equal(elegidas.length, 0);
});

test("reconoce un valor en los formatos numericos habituales", () => {
  assert.equal(valorApareceEnTexto(5234.1, "la cuantia es USD 5.234,10 mas intereses"), true);
  assert.equal(valorApareceEnTexto(5234.1, "la cuantia es USD 5,234.10 mas intereses"), true);
  assert.equal(valorApareceEnTexto(5234.1, "por 5234.10 dolares"), true);
  assert.equal(valorApareceEnTexto(12000, "cuantia: $12.000"), true);
  assert.equal(valorApareceEnTexto(12000, "cuantia: $12,000.00"), true);
});

test("no da por bueno un valor que no esta en el texto", () => {
  assert.equal(valorApareceEnTexto(5234.1, "la cuantia es USD 9.999,99"), false);
  // un numero contenido en otro mayor no cuenta
  assert.equal(valorApareceEnTexto(234.1, "la cuantia es USD 5.234,10"), false);
});

const docs: DocTexto[] = [
  { codigoActuacion: 5, tipo: "CALIFICACION DE SOLICITUD Y/O DEMANDA", fecha: "2026-09-12", nombreArchivo: "calificacion.pdf", texto: "VISTOS: Se dispone que pague la cantidad de USD 5.234,10 mas intereses. La cuantia se fija en 5.234,10 dolares." },
  { codigoActuacion: 4, tipo: "ESCRITO", fecha: "2026-09-10", nombreArchivo: "escrito.pdf", texto: "Fe de presentacion" },
];

test("acepta el valor que el modelo propone cuando figura en el documento y adjunta la fuente", () => {
  const r = interpretarRespuestaValor({ encontrado: true, valor: 5234.1, moneda: "USD", concepto: "cuantia", evidencia: "La cuantia se fija en 5.234,10 dolares", documento: 0 }, docs);
  assert.equal(r.encontrado, true);
  assert.equal(r.valor, 5234.1);
  assert.equal(r.fuente?.codigoActuacion, 5);
  assert.equal(r.fuente?.nombreArchivo, "calificacion.pdf");
  assert.match(r.evidencia ?? "", /cuantia se fija/i);
});

test("rechaza un valor inventado por el modelo", () => {
  const r = interpretarRespuestaValor({ encontrado: true, valor: 8000, moneda: "USD", evidencia: "cuantia 8.000", documento: 0 }, docs);
  assert.equal(r.encontrado, false);
  assert.match(r.motivo ?? "", /no figura/i);
});

test("si el modelo no encontro nada, lo dice sin inventar", () => {
  const r = interpretarRespuestaValor({ encontrado: false, valor: null }, docs);
  assert.equal(r.encontrado, false);
  assert.ok(r.motivo);
});

test("respuestas mal formadas del modelo no rompen", () => {
  assert.equal(interpretarRespuestaValor(null as any, docs).encontrado, false);
  assert.equal(interpretarRespuestaValor({ encontrado: true, valor: "abc" } as any, docs).encontrado, false);
  assert.equal(interpretarRespuestaValor({ encontrado: true, valor: -5 } as any, docs).encontrado, false);
});

test("si la evidencia que cita el modelo no esta en el texto, no se muestra como cita", () => {
  const r = interpretarRespuestaValor({ encontrado: true, valor: 5234.1, evidencia: "frase que no existe en el documento", documento: 0 }, docs);
  assert.equal(r.encontrado, true);
  assert.equal(r.evidencia, undefined);
});
