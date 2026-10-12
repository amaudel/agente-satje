import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparMedidasCautelares } from "./medidas-dedup.js";

test("repetición del mismo bien no crea varias medidas", () => {
  const r = agruparMedidasCautelares([
    { codigoActuacion: 1, tipo: "AUTO", actividad: "Se ordena prohibición de enajenar inmueble certificado No. 10458" },
    { codigoActuacion: 2, tipo: "OFICIO", actividad: "Ofíciese respecto a prohibición de enajenar inmueble certificado No. 10458" },
    { codigoActuacion: 2, tipo: "OFICIO", actividad: "Ofíciese respecto a prohibición de enajenar inmueble certificado No. 10458" },
  ]);
  assert.equal(r.totalIdentificadas, 1);
  assert.equal(r.grupos[0].actuaciones.length, 2);
  assert.equal(r.esConteoExhaustivo, false);
});
test("distingue bienes identificados y tipos de medidas", () => {
  const r = agruparMedidasCautelares([
    { actividad: "Prohibición de enajenar inmueble certificado 10458" },
    { actividad: "Prohibición de enajenar inmueble certificado 10459" },
    { actividad: "Embargo inmueble certificado 10458" },
  ]);
  assert.equal(r.totalIdentificadas, 3);
});
test("sin identificador, no inventa medidas independientes", () => {
  const r = agruparMedidasCautelares([
    { actividad: "Se ordena prohibición de enajenar" },
    { actividad: "Se libra oficio por prohibición de enajenar" },
  ]);
  assert.equal(r.totalIdentificadas, 1);
  assert.match(r.advertencia || "", /no inventario jurídico exhaustivo/);
});
test("menciones sin tipo cautelar expreso no cuentan", () => {
  assert.equal(agruparMedidasCautelares([{ actividad: "Registro de la Propiedad remite oficio" }]).totalIdentificadas, 0);
});
