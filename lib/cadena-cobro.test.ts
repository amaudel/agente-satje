import { test } from "node:test";
import assert from "node:assert/strict";
import { esAccionDeCobro, esDemandanteErco } from "./cadena-cobro.js";

test("reconoce las acciones de cobro y descarta lo demas", () => {
  assert.equal(esAccionDeCobro("COBRO DE PAGARÉ A LA ORDEN"), true);
  assert.equal(esAccionDeCobro("Cobro de letra de cambio"), true);
  assert.equal(esAccionDeCobro("EJECUTIVO"), true);
  assert.equal(esAccionDeCobro("PROCEDIMIENTO MONITORIO"), true);
  assert.equal(esAccionDeCobro("ARCHIVO DE LA INVESTIGACIÓN PREVIA ART. 586"), false);
  assert.equal(esAccionDeCobro("CONSTANCIA DE PERDIDA DE DOCUMENTOS"), false);
  assert.equal(esAccionDeCobro(null), false);
  assert.equal(esAccionDeCobro(""), false);
});

test("detecta a Erco como demandante por el texto de las actuaciones", () => {
  const acts = [
    { tipo: "RAZON (RAZON)", actividad: "notifique el auto a: COOPERATIVA DE AHORRO Y CREDITO ERCO LTDA. en el casillero 916" },
    { tipo: "ESCRITO", actividad: "FePresentacion" },
  ];
  assert.equal(esDemandanteErco(acts), true);
});

test("sin mencion de Erco en un expediente con actuaciones es false", () => {
  const acts = [{ tipo: "ESCRITO", actividad: "Banco del Pacifico S.A. solicita copias" }];
  assert.equal(esDemandanteErco(acts), false);
});

test("no confunde palabras que contienen 'erco'", () => {
  const acts = [{ tipo: "RAZON", actividad: "el comercio y la mercancia fueron embargados; Sr. Percovich" }];
  assert.equal(esDemandanteErco(acts), false);
});

test("sin actuaciones no se puede saber: null", () => {
  assert.equal(esDemandanteErco([]), null);
});
