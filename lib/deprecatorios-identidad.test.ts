import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarIdentidadDeprecatorio } from "./deprecatorios-identidad.js";
const principal=[{nombreJudicatura:"UNIDAD JUDICIAL CIVIL CUENCA",actividad:"COOPERATIVA DE AHORRO Y CREDITO ERCO LTDA en contra de Norma Ordoñez"}];
test("deprecatorio con actora distinta se marca discrepancia",()=>{
  const r=verificarIdentidadDeprecatorio(principal,"Cooperativa de Ahorro y Credito Once de Junio Ltda. en contra de Claro Gabriel");
  assert.equal(r.estado,"DISCREPANCIA");
});
test("actor coincidente no confirma identidad completa",()=>{
  const r=verificarIdentidadDeprecatorio(principal,"Cooperativa de Ahorro y Credito Erco Ltda. en contra de otras personas");
  assert.equal(r.estado,"COINCIDE");
});
test("sin partes suficientes no hay conclusiones",()=>{
  assert.equal(verificarIdentidadDeprecatorio(principal,"Oficio de cumplimiento").estado,"INDETERMINADO");
});
