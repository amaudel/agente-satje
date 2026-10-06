import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarEtapaPorHitos, sanitizarTipo } from "./etapa-por-hitos.js";

// Cada caso es la secuencia real de TIPOS de actuacion (sin textos ni nombres),
// de la mas reciente a la mas antigua, tomada de la bitacora de la oficial.
const act = (fecha: string, tipo: string) => ({ fecha: `${fecha}T10:00:00.000+00:00`, tipo });

test("un abandono declarado manda: lo administrativo posterior no lo cambia", () => {
  const r = clasificarEtapaPorHitos([
    act("2026-04-20", "ATENDER PETICION (RAZON DE NOTIFICACION)"),
    act("2026-04-15", "ESCRITO"),
    act("2026-04-08", "ABANDONO POR FALTA DE IMPULSO PROCESAL ART. 245 (AUTO INTERLOCUTORIO)"),
    act("2026-04-07", "RAZON (RAZON)"),
    act("2025-03-01", "DISPONER CUMPLIMIENTO DE DILIGENCIA DEPRECADA (AUTO)"),
  ]);
  assert.equal(r?.etapaGeneral, "12. ARCHIVADO");
  assert.match(r!.etapaEspecifica, /^12\.3\./);
  assert.equal(r?.fechaEtapa, "2026-04-08");
});

test("el archivo es terminal: devoluciones de deprecatorio posteriores no lo reabren", () => {
  const r = clasificarEtapaPorHitos([
    act("2025-04-25", "NOTIFICACION (AUTO DE SUSTANCIACION)"),
    act("2025-04-15", "RAZON (RAZON)"),
    act("2025-02-07", "DEVOLUCIÓN DEPRECATORIO POR CUMPLIMIENTO DE DILIGENCIA (AUTO)"),
    act("2025-01-10", "RAZON ENVIO A CITACIONES (NOMBRE CITADO)"),
    act("2024-09-10", "ABANDONO POR FALTA DE IMPULSO PROCESAL ART. 245 (AUTO)"),
    act("2023-06-01", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)"),
  ]);
  assert.equal(r?.etapaGeneral, "12. ARCHIVADO");
  assert.equal(r?.fechaEtapa, "2024-09-10");
});

test("un mandamiento de ejecucion posterior al archivo si prevalece (se reactivo)", () => {
  const r = clasificarEtapaPorHitos([
    act("2026-02-01", "MANDAMIENTO DE EJECUCION (AUTO INTERLOCUTORIO)"),
    act("2025-05-01", "ARCHIVO POR NO COMPLETAR DEMANDA (AUTO)"),
  ]);
  assert.equal(r?.etapaGeneral, "10. EJECUCION");
});

test("distingue las subetapas de archivo por el tipo de actuacion", () => {
  const sub = (tipo: string) => clasificarEtapaPorHitos([act("2025-01-01", tipo)])!.etapaEspecifica.slice(0, 4);
  assert.equal(sub("ARCHIVO POR NO COMPLETAR DEMANDA (AUTO INTERLOCUTORIO)"), "12.2");
  assert.equal(sub("ARCHIVO POR RETIRO DE LA DEMANDA (AUTO INTERLOCUTORIO)"), "12.1");
  assert.equal(sub("INADMISION DE LA DEMANDA ART. 350 (AUTO INTERLOCUTORIO)"), "12.1");
  assert.equal(sub("SOLUCION O PAGO Y/O EXTINCION DE LA OBLIGACION (AUTO)"), "12.4");
  assert.equal(sub("CONCLUSION DE LA EJECUCION Y ARCHIVO DEL PROCESO (AUTO)"), "12.4");
});

test("una razon de ejecutoria posterior a un abandono sigue siendo archivado", () => {
  const r = clasificarEtapaPorHitos([
    act("2024-12-17", "RAZON DE EJECUTORIA (RAZON)"),
    act("2024-12-10", "SENTAR RAZON (RAZON DE NOTIFICACION)"),
    act("2024-10-01", "ABANDONO POR FALTA DE IMPULSO PROCESAL ART. 245 (AUTO)"),
  ]);
  assert.equal(r?.etapaGeneral, "12. ARCHIVADO");
});

test("sentencia y luego razon de ejecutoria es 08, no ejecucion", () => {
  const r = clasificarEtapaPorHitos([
    act("2026-09-29", "RAZON DE EJECUTORIA (RAZON)"),
    act("2026-09-14", "SENTENCIA (RAZON DE NOTIFICACION)"),
    act("2026-09-14", "SENTENCIA (RESOLUCION)"),
    act("2026-08-25", "CITACION REALIZADA (RAZON)"),
  ]);
  assert.equal(r?.etapaGeneral, "08. RAZON DE EJECUTORIA");
  assert.equal(r?.fechaEtapa, "2026-09-29");
});

test("sentencia sin ejecutoria todavia es 07", () => {
  const r = clasificarEtapaPorHitos([
    act("2026-10-06", "SENTENCIA (RAZON DE NOTIFICACION)"),
    act("2026-10-06", "SENTENCIA (RESOLUCION)"),
    act("2026-09-16", "FALTA DE CONTESTACIÓN DE LA DEMANDA ART. 352 (AUTO)"),
    act("2026-09-14", "CITACION REALIZADA (RAZON)"),
  ]);
  assert.equal(r?.etapaGeneral, "07. SENTENCIA");
});

test("nombramiento de perito, inicio o mandamiento de ejecucion son ejecucion", () => {
  const g = (tipo: string) => clasificarEtapaPorHitos([act("2025-02-04", tipo), act("2025-01-01", "SENTENCIA (RESOLUCION)")])!;
  assert.equal(g("NOMBRAMIENTO DE PERITO (AUTO DE SUSTANCIACION)").etapaGeneral, "10. EJECUCION");
  assert.match(g("NOMBRAMIENTO DE PERITO (AUTO DE SUSTANCIACION)").etapaEspecifica, /^10\.1\./);
  assert.equal(g("INICIO DE EJECUCION (AUTO DE SUSTANCIACION)").etapaGeneral, "10. EJECUCION");
  assert.match(g("MANDAMIENTO DE EJECUCION (AUTO INTERLOCUTORIO)").etapaEspecifica, /^10\.4\./);
  assert.match(g("INCUMPLIMIENTO DE MANDAMIENTO DE EJECUCION (AUTO)").etapaEspecifica, /^10\.2\./);
});

test("la apelacion y la mediacion se reconocen por su convocatoria", () => {
  assert.equal(
    clasificarEtapaPorHitos([act("2026-06-24", "CONVOCATORIA AUDIENCIA DE RECURSO DE APELACION (AUTO)"), act("2026-06-04", "CARATULA SALA DE CORTE PROVINCIAL")])!.etapaGeneral,
    "09. APELACIÓN"
  );
  assert.equal(
    clasificarEtapaPorHitos([act("2026-01-27", "DERIVACION A MEDIACION (AUTO INTERLOCUTORIO)")])!.etapaGeneral,
    "05. MEDIACION"
  );
  assert.equal(
    clasificarEtapaPorHitos([act("2026-07-16", "CONVOCATORIA AUDIENCIA DE CONCILIACION (AUTO)")])!.etapaGeneral,
    "06. AUDIENCIA DE JUICIO"
  );
});

test("citacion: subetapa deprecatorio si hay deprecatorio en el historial", () => {
  const con = clasificarEtapaPorHitos([
    act("2026-09-16", "RAZON ENVIO A CITACIONES (NOMBRE CITADO)"),
    act("2026-07-16", "CARATULA SORTEO DE DEPRECATORIOS"),
    act("2026-07-15", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)"),
  ])!;
  assert.equal(con.etapaGeneral, "04. CITACIÓN");
  assert.match(con.etapaEspecifica, /^04\.3\./);
  const sin = clasificarEtapaPorHitos([
    act("2026-09-16", "CITACIÓN: No realizada - OTROS"),
    act("2026-07-15", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)"),
  ])!;
  assert.match(sin.etapaEspecifica, /^04\.1\./);
});

test("el sorteo de un deprecatorio gana al acta de sorteo del mismo dia", () => {
  const r = clasificarEtapaPorHitos([
    act("2026-07-16", "ACTA DE SORTEO"),
    act("2026-07-16", "CARATULA SORTEO DE DEPRECATORIOS"),
    act("2026-07-15", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)"),
  ])!;
  assert.equal(r.etapaGeneral, "04. CITACIÓN");
});

test("calificacion reciente: 03 si no hay oficio de citacion, 04 si se oficio ese dia", () => {
  assert.equal(
    clasificarEtapaPorHitos([act("2026-09-30", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)"), act("2026-09-28", "ACTA DE SORTEO"), act("2026-09-28", "CARATULA DE JUICIO")])!.etapaGeneral,
    "03. CALIFICACION"
  );
  assert.equal(
    clasificarEtapaPorHitos([act("2026-07-31", "OFICIO (OFICIO)"), act("2026-07-31", "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO)"), act("2026-07-29", "ACTA DE SORTEO")])!.etapaGeneral,
    "04. CITACIÓN"
  );
});

test("solo sorteo y caratula es la etapa 02", () => {
  const r = clasificarEtapaPorHitos([act("2026-10-05", "ACTA DE SORTEO"), act("2026-10-05", "CARATULA DE JUICIO")])!;
  assert.equal(r.etapaGeneral, "02. SORTEO");
});

test("sin ningun hito reconocible devuelve null para que decida el analisis anterior", () => {
  assert.equal(clasificarEtapaPorHitos([act("2026-01-01", "ESCRITO"), act("2026-01-02", "OFICIO")]), null);
  assert.equal(clasificarEtapaPorHitos([]), null);
});

test("sanitizarTipo quita los nombres de las partes pero conserva el tipo", () => {
  assert.equal(sanitizarTipo("RAZON ENVIO A CITACIONES (PEREZ GOMEZ JUAN CARLOS"), "RAZON ENVIO A CITACIONES (...)");
  assert.equal(sanitizarTipo("ATENDER PETICION (RAZON DE NOTIFICACION)"), "ATENDER PETICION (RAZON DE NOTIFICACION)");
  assert.equal(sanitizarTipo("OFICIO (OFICIO)"), "OFICIO (OFICIO)");
  assert.equal(sanitizarTipo("ESCRITO"), "ESCRITO");
});
