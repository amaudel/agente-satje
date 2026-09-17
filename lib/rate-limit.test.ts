import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consultarLimite,
  registrarFallo,
  limpiarLimite,
  ipDelCliente,
  _resetLimites,
} from "./rate-limit.js";

const T0 = 1_700_000_000_000;

test("permite mientras no se alcance el maximo", () => {
  _resetLimites();
  for (let i = 0; i < 3; i++) {
    assert.equal(consultarLimite("ip:1", 3, 300, T0).permitido, true);
    registrarFallo("ip:1", T0);
  }
  const bloqueado = consultarLimite("ip:1", 3, 300, T0);
  assert.equal(bloqueado.permitido, false);
  assert.equal(bloqueado.restantes, 0);
  assert.ok(bloqueado.reintentarEnSegundos > 0);
});

test("la ventana se libera al pasar el tiempo", () => {
  _resetLimites();
  for (let i = 0; i < 3; i++) registrarFallo("ip:2", T0);
  assert.equal(consultarLimite("ip:2", 3, 300, T0).permitido, false);
  assert.equal(consultarLimite("ip:2", 3, 300, T0 + 300_001).permitido, true);
});

test("cuenta los fallos de cada clave por separado", () => {
  _resetLimites();
  for (let i = 0; i < 3; i++) registrarFallo("ip:3", T0);
  assert.equal(consultarLimite("ip:3", 3, 300, T0).permitido, false);
  assert.equal(consultarLimite("ip:4", 3, 300, T0).permitido, true);
});

test("un login exitoso limpia el contador", () => {
  _resetLimites();
  for (let i = 0; i < 3; i++) registrarFallo("ip:5", T0);
  assert.equal(consultarLimite("ip:5", 3, 300, T0).permitido, false);
  limpiarLimite("ip:5");
  assert.equal(consultarLimite("ip:5", 3, 300, T0).permitido, true);
});

test("ventana deslizante: los fallos viejos no cuentan", () => {
  _resetLimites();
  registrarFallo("ip:6", T0);
  registrarFallo("ip:6", T0 + 200_000);
  // A los 250s ambos fallos siguen dentro de la ventana de 300s
  assert.equal(consultarLimite("ip:6", 2, 300, T0 + 250_000).permitido, false);
  // Pasados los 300s el primer fallo ya salio de la ventana: queda 1 de margen
  const estado = consultarLimite("ip:6", 2, 300, T0 + 300_001);
  assert.equal(estado.permitido, true);
  assert.equal(estado.restantes, 1);
});

test("ipDelCliente toma la primera IP del X-Forwarded-For", () => {
  assert.equal(ipDelCliente({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), "1.2.3.4");
  assert.equal(ipDelCliente({ "x-forwarded-for": ["9.9.9.9", "1.1.1.1"] }), "9.9.9.9");
  assert.equal(ipDelCliente({}), "desconocida");
});
