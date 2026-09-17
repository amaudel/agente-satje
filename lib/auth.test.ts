import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createSessionToken,
  verifySessionToken,
  sessionSecretFor,
  safeCompare,
  parseCookies,
  SESSION_TTL_SECONDS,
} from "./auth.js";

const PASSWORD = "contrasena-de-prueba";

test("un token recien emitido verifica", () => {
  const token = createSessionToken(PASSWORD);
  assert.equal(verifySessionToken(token, PASSWORD), true);
});

test("el token NO es el sha256 de la contrasena", () => {
  const token = createSessionToken(PASSWORD);
  const hashPlano = crypto.createHash("sha256").update(PASSWORD).digest("hex");
  assert.notEqual(token, hashPlano);
  assert.equal(token.includes(hashPlano), false);
});

test("una firma alterada no verifica", () => {
  const token = createSessionToken(PASSWORD);
  const [exp, firma] = token.split(".");
  const firmaMala = (firma[0] === "a" ? "b" : "a") + firma.slice(1);
  assert.equal(verifySessionToken(`${exp}.${firmaMala}`, PASSWORD), false);
});

test("una expiracion alterada no verifica", () => {
  const token = createSessionToken(PASSWORD);
  const firma = token.split(".")[1];
  const expFalsa = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS * 2;
  assert.equal(verifySessionToken(`${expFalsa}.${firma}`, PASSWORD), false);
});

test("un token expirado no verifica", () => {
  const ahora = Date.now();
  const token = createSessionToken(PASSWORD, undefined, ahora);
  assert.equal(verifySessionToken(token, PASSWORD, undefined, ahora), true);
  assert.equal(verifySessionToken(token, PASSWORD, undefined, ahora + SESSION_TTL_SECONDS * 1000 + 1000), false);
});

test("un token emitido con otra contrasena no verifica", () => {
  const token = createSessionToken("otra-contrasena");
  assert.equal(verifySessionToken(token, PASSWORD), false);
});

test("tokens invalidos o vacios no verifican", () => {
  assert.equal(verifySessionToken(undefined, PASSWORD), false);
  assert.equal(verifySessionToken("", PASSWORD), false);
  assert.equal(verifySessionToken("sinexpiracion", PASSWORD), false);
  assert.equal(verifySessionToken(".soloFirma", PASSWORD), false);
  assert.equal(verifySessionToken("no-numerico.abcdef", PASSWORD), false);
});

test("dos tokens emitidos en el mismo segundo son iguales (deterministas por exp)", () => {
  const t1 = createSessionToken(PASSWORD, undefined, 1_700_000_000_000);
  const t2 = createSessionToken(PASSWORD, undefined, 1_700_000_000_500);
  assert.equal(t1, t2);
});

test("sessionSecretFor usa el secreto explicito solo si no esta vacio", () => {
  assert.equal(sessionSecretFor("clave", "secreto"), "secreto");
  assert.equal(sessionSecretFor("clave", ""), "clave");
  assert.equal(sessionSecretFor("clave", undefined), "clave");
});

test("un token firmado con secreto explicito no verifica sin ese secreto", () => {
  const token = createSessionToken(PASSWORD, "secreto-dedicado");
  assert.equal(verifySessionToken(token, PASSWORD, "secreto-dedicado"), true);
  assert.equal(verifySessionToken(token, PASSWORD), false);
  assert.equal(verifySessionToken(token, PASSWORD, "otro-secreto"), false);
});

test("cambiar el secreto invalida las sesiones emitidas", () => {
  const token = createSessionToken(PASSWORD, "secreto-v1");
  assert.equal(verifySessionToken(token, PASSWORD, "secreto-v1"), true);
  assert.equal(verifySessionToken(token, PASSWORD, "secreto-v2"), false);
});

test("cambiar la contrasena invalida las sesiones emitidas", () => {
  const token = createSessionToken("contrasena-vieja");
  assert.equal(verifySessionToken(token, "contrasena-vieja"), true);
  assert.equal(verifySessionToken(token, "contrasena-nueva"), false);
});

test("safeCompare compara sin lanzar con longitudes distintas", () => {
  assert.equal(safeCompare("igual", "igual"), true);
  assert.equal(safeCompare("igual", "distinta"), false);
  assert.equal(safeCompare("corta", "muchisimo-mas-larga"), false);
  assert.equal(safeCompare(undefined, ""), true);
  assert.equal(safeCompare("", "algo"), false);
});

test("parseCookies lee y decodifica", () => {
  const cookies = parseCookies("a=1; satje_session=abc%2Edef; vacio=");
  assert.equal(cookies.a, "1");
  assert.equal(cookies.satje_session, "abc.def");
  assert.equal(cookies.vacio, "");
  assert.deepEqual(parseCookies(undefined), {});
});
