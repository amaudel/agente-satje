import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarGuia,
  enteroEnLetras,
  extraerDatosGuia,
  extraerDeudores,
  fechaLarga,
  formatoDinero,
  leerNumeroMonto,
  montoEnLetras,
  sumarAnios,
  type DatosGuia,
} from "./guia-audiencia.js";
import { guiaADocx } from "./guia-docx.js";

// Textos con el mismo formato que el SATJE; nombres y cedulas ficticios.
const ACTUACIONES = [
  {
    idJudicatura: "01333",
    fecha: "2026-03-20T20:48:35.307+00:00",
    tipo: "ACTA DE SORTEO",
    actividad:
      "Recibido en la ciudad de Cuenca el día de hoy, viernes 20 de marzo de 2026, a las 15:48, el proceso de Civil, Tipo de procedimiento: Ejecutivo por Asunto: Cobro de pagaré a la orden, seguido por: Cooperativa de Ahorro y Credito Erco Ltda, en contra de: Perez Lopez Ana Maria, Ruiz Mora Juan Carlos.\nPor sorteo de ley la competencia se radica en la UNIDAD JUDICIAL CIVIL CUENCA, conformado por Juez(a): Quinteros Rivera Guido Geovanny. Secretaria(o): Vázquez Abad Pedro.\n1) PETICIÓN INICIAL (ORIGINAL)\n2) ADJUNTA PAGARÉ POR EL VALOR DE $6500,00 (ORIGINAL)",
  },
  {
    idJudicatura: "01333",
    fecha: "2026-03-24T15:43:44.000+00:00",
    tipo: "CALIFICACION DE SOLICITUD Y/O DEMANDA (AUTO DE SUSTANCIACION)",
    actividad:
      "VISTOS: Avoco conocimiento en calidad de Juez de la Unidad Judicial Civil del Cantón Cuenca... En lo principal la Demanda Ejecutiva propuesta por el Ing. Héctor Enerco Fajardo, en su calidad de Gerente y Representante Legal de la Cooperativa de Ahorro y Crédito “ERCO LTDA”; en contra de ANA MARIA PEREZ LOPEZ con c.c. 0100000001; y, JUAN CARLOS RUIZ MORA con c.c. 0100000002, en su calidad de Deudores Principales; una vez examinada, y por considerar que la misma cumple...",
  },
  {
    idJudicatura: "01333",
    fecha: "2026-03-24T17:06:14.943+00:00",
    tipo: "CALIFICACION DE SOLICITUD Y/O DEMANDA (RAZON DE NOTIFICACION)",
    actividad: "notifiqué el AUTO DE SUSTANCIACIÓN que antecede a: COOPERATIVA DE AHORRO Y CREDITO ERCO LTDA. en el casillero electrónico No.1 correo electrónico x@y.ec. del Dr./Ab. DIANA DEL ROCIO VERA SARAGURO; Certifico:",
  },
  {
    idJudicatura: "17230",
    fecha: "2026-05-08T20:10:00.000+00:00",
    tipo: "DEVOLUCIÓN DEPRECATORIO (AUTO INTERLOCUTORIO)",
    actividad: "VISTOS.- Avoco conocimiento de la presente causa en mi calidad de Jueza Titular de otra unidad...",
  },
  {
    idJudicatura: "01333",
    fecha: "2026-08-25T18:00:01.000+00:00",
    tipo: "CALIFICACION A LA CONTESTACION DE LA DEMANDA Y CONVOCATORIA AUDIENCIA UNICA (AUTO DE SUSTANCIACION)",
    actividad:
      "VISTOS: ... consta la citación a la parte demandada, habiendo comparecido al proceso únicamente la demandada Ana Maria Perez Lopez conforme consta de fs. 22 de los autos. Téngase en cuenta la presentación de excepciones previas; así como la presentación de excepciones de fondo. En atención a lo que dispone el Art. 354 del COGEP se convoca a Audiencia Única para EL DÍA MIÉRCOLES DIECIOCHO (18) DE NOVIEMBRE DEL 2026, A LAS 11H00 , a fin de que comparezcan... se realizará en la Sala de Audiencias Nº119, ubicada en el 1er. piso",
  },
];

test("montos en letras y formato", () => {
  assert.equal(formatoDinero(6500), "6.500,00");
  assert.equal(formatoDinero(20830.94), "20.830,94");
  assert.equal(enteroEnLetras(6500), "SEIS MIL QUINIENTOS");
  assert.equal(enteroEnLetras(35000), "TREINTA Y CINCO MIL");
  assert.equal(enteroEnLetras(21000), "VEINTIÚN MIL");
  assert.equal(enteroEnLetras(1100), "MIL CIEN");
  assert.equal(enteroEnLetras(2733), "DOS MIL SETECIENTOS TREINTA Y TRES");
  assert.equal(montoEnLetras(2733.82), "DOS MIL SETECIENTOS TREINTA Y TRES DÓLARES DE LOS ESTADOS UNIDOS DE AMÉRICA CON 82/100 (USD $ 2.733,82)");
  assert.equal(leerNumeroMonto("6500,00"), 6500);
  assert.equal(leerNumeroMonto("6.500,00"), 6500);
  assert.equal(leerNumeroMonto("6,500.00"), 6500);
  assert.equal(leerNumeroMonto("35000"), 35000);
});

test("fechas", () => {
  assert.equal(fechaLarga("2023-05-24"), "24 de mayo de 2023");
  assert.equal(sumarAnios("2021-11-30", 5), "2026-11-30");
  assert.equal(sumarAnios("2024-02-29", 1), "2025-02-28");
});

test("deudores principales y solidarios desde el auto de calificacion", () => {
  const ds = extraerDeudores(
    "en contra de la señora PEREZ LOPEZ ANA MARIA, en calidad de deudora principal; y, los señores RUIZ MORA JUAN CARLOS, SOTO VEGA LUISA; y, DIAZ PAZ PEDRO PABLO, en calidad de deudores solidarios, para que Su Autoridad..."
  );
  assert.deepEqual(ds, [
    { nombre: "PEREZ LOPEZ ANA MARIA", rol: "principal" },
    { nombre: "RUIZ MORA JUAN CARLOS", rol: "solidario" },
    { nombre: "SOTO VEGA LUISA", rol: "solidario" },
    { nombre: "DIAZ PAZ PEDRO PABLO", rol: "solidario" },
  ]);
});

test("prellenado desde las actuaciones del SATJE", () => {
  const r = extraerDatosGuia(ACTUACIONES, "01333-2026-03148");
  assert.deepEqual(r.deudores, [
    { nombre: "ANA MARIA PEREZ LOPEZ", rol: "principal" },
    { nombre: "JUAN CARLOS RUIZ MORA", rol: "principal" },
  ]);
  assert.equal(r.montoPagare, 6500);
  assert.equal(r.fechaPresentacionDemanda, "2026-03-20");
  assert.equal(r.juezNombre, "Quinteros Rivera Guido Geovanny");
  // La "Jueza" del deprecatorio de Quito no cuenta: es otro juzgado
  assert.equal(r.trato, "juez");
  assert.equal(r.tratoSeguro, true);
  assert.equal(r.abogada, "diana");
  assert.equal(r.audienciaFecha, "EL DÍA MIÉRCOLES DIECIOCHO (18) DE NOVIEMBRE DEL 2026".replace(/^EL DÍA /, ""));
  assert.equal(r.audienciaHora, "11H00");
  assert.equal(r.audienciaSala, "119");
  assert.equal(r.hayExcepcionesPrevias, true);
  assert.deepEqual(r.contestaron, ["ANA MARIA PEREZ LOPEZ"]);
  assert.deepEqual(r.noComparecieron, ["JUAN CARLOS RUIZ MORA"]);
});

function base(): DatosGuia {
  return {
    causa: "01333-2026-03148",
    abogada: "veronica",
    trato: "jueza",
    deudores: [
      { nombre: "Ana Maria Perez Lopez", rol: "principal" },
      { nombre: "Juan Carlos Ruiz Mora", rol: "solidario" },
    ],
    contestaron: ["Ana Maria Perez Lopez"],
    noComparecieron: ["Juan Carlos Ruiz Mora"],
    numeroPagare: "123456",
    fechaSuscripcion: "2023-05-24",
    montoPagare: 6500,
    tasa: "17.5",
    tipoCredito: "microcrédito",
    plazo: 60,
    unidadPlazo: "dividendos",
    dividendosPagados: 27,
    dividendoMora: 28,
    fechaMora: "2025-10-05",
    saldoCapital: 4319.1,
    seguroDesgravamen: true,
    fechaPresentacionDemanda: "2026-03-20",
    modulos: { legitimacion: false, requisitos: false, falsedad: false, prescripcion: false, diferimiento: false },
  };
}

function texto(g: ReturnType<typeof armarGuia>): string {
  return g.bloques
    .map((b) => ("texto" in b ? b.texto : "trozos" in b ? b.trozos.map((t) => t.t).join("") : b.items.map((i) => i.map((t) => t.t).join("")).join("\n")))
    .join("\n");
}

test("guia basica: datos completos, trato uniforme y un solo saldo", () => {
  const g = armarGuia(base());
  const t = texto(g);
  assert.equal(g.faltantes, 0);
  assert.equal(g.avisos.length, 0, g.avisos.join(" | "));
  assert.ok(t.includes("Verónica González Vásquez"));
  assert.ok(!t.includes("Señor Juez"), "con jueza no debe aparecer 'Señor Juez'");
  assert.ok(t.includes("Señora Jueza"));
  assert.ok(t.includes("USD $ 4.319,10"));
  assert.ok(!t.includes("4.738"));
  assert.ok(t.includes("CUATRO MIL TRESCIENTOS DIECINUEVE DÓLARES"));
  assert.ok(t.includes("dividendo 28 hasta el dividendo 60"));
  assert.ok(t.includes("dividendos 28 al 60"));
  assert.ok(!t.includes("EXCEPCIONES"));
});

test("faltan datos: quedan como [COMPLETAR] y se cuentan una vez", () => {
  const d = base();
  delete d.numeroPagare;
  delete d.saldoCapital;
  const g = armarGuia(d);
  const t = texto(g);
  assert.ok(t.includes("[COMPLETAR: número de pagaré]"));
  assert.ok(t.includes("[COMPLETAR: saldo de capital]"));
  assert.equal(g.faltantes, 2);
});

test("prescripcion: no usa el argumento de los 5 anios si ya pasaron desde la mora", () => {
  const d = base();
  d.modulos.prescripcion = true;
  d.fechaMora = "2018-12-30";
  d.fechaSuscripcion = "2015-06-26";
  d.fechaUltimoPago = "2021-11-30";
  d.dividendoUltimoPago = 41;
  d.dividendosPagados = 41;
  d.dividendoMora = 42;
  d.plazo = 52;
  d.fechaPresentacionDemanda = "2024-04-25";
  const g = armarGuia(d);
  const t = texto(g);
  assert.ok(t.includes("30 de noviembre de 2021"));
  assert.ok(t.includes("no han transcurrido los cinco años"), "desde el ultimo pago SI esta dentro de 5 anios");
  assert.ok(!/desde que se hizo exigible la obligación hasta/.test(t));
  assert.ok(g.avisos.some((a) => a.includes("pasaron más de 5 años") && a.includes("30 de diciembre de 2018")));
});

test("prescripcion: alerta fuerte si incluso desde el ultimo pago pasaron 5 anios", () => {
  const d = base();
  d.modulos.prescripcion = true;
  d.fechaUltimoPago = "2018-01-10";
  d.dividendoUltimoPago = 10;
  d.fechaMora = "2018-02-10";
  d.fechaSuscripcion = "2017-01-10";
  d.fechaPresentacionDemanda = "2024-04-25";
  const g = armarGuia(d);
  assert.ok(g.avisos.some((a) => a.includes("podría prosperar")));
  assert.ok(!texto(g).includes("no han transcurrido los cinco años"));
});

test("revision de coherencia de montos y dividendos", () => {
  const d = base();
  d.saldoCapital = 9000;
  d.dividendoMora = 30;
  const g = armarGuia(d);
  assert.ok(g.avisos.some((a) => a.includes("MAYOR que el monto")));
  assert.ok(g.avisos.some((a) => a.includes("lo normal sería el 28")));
});

test("modulos: endoso, requisitos, falsedad con oposicion, diferimiento", () => {
  const d = base();
  d.modulos = { legitimacion: true, requisitos: true, falsedad: true, prescripcion: false, diferimiento: true };
  d.entidadOriginal = "la Cooperativa de Ahorro y Crédito CREA Ltda. en liquidación";
  d.fechaEndoso = "2025-09-26";
  d.fechaDiferimiento = "2024-12-18";
  d.requisitoLugarPago = true;
  d.reconoceDeuda = true;
  d.oposicion = { pericia: true, testigos: true, declaracionGerente: true, oficios: false };
  const t = texto(armarGuia(d));
  assert.ok(t.includes("endoso en propiedad el 26 de septiembre de 2025"));
  assert.ok(t.includes("artículo 188"));
  assert.ok(t.includes("falsedad ideológica"));
  assert.ok(t.includes("OPOSICIÓN A LA PRUEBA"));
  assert.ok(t.includes("PREGUNTAS SUGERIDAS AL PERITO"));
  assert.ok(t.includes("TABLA DE AMORTIZACIÓN MODIFICADA"));
  // codeudor que no contesto: pedido subsidiario de pago
  assert.ok(t.includes("JUAN CARLOS RUIZ MORA, quienes a pesar de haber sido citados"));
});

test("el Word se genera", async () => {
  const d = base();
  d.modulos.prescripcion = true;
  delete d.numeroPagare;
  const buf = Buffer.from(await guiaADocx(armarGuia(d)), "base64");
  assert.ok(buf.length > 5000);
  assert.equal(buf.subarray(0, 2).toString(), "PK");
});

test("el formulario se valida en el servidor", async () => {
  const { sanearDatosGuia } = await import("./guia-audiencia.js");
  const d = sanearDatosGuia({
    causa: "01333-2026-03148",
    abogada: "otra",
    trato: "jueza",
    deudores: [{ nombre: "  Ana Perez ", rol: "x" }, { nombre: "" }],
    montoPagare: "6.500,00",
    saldoCapital: "abc",
    fechaMora: "2025-02-30",
    fechaSuscripcion: "2023-05-24",
    plazo: "60",
    modulos: { prescripcion: "on", falsedad: false },
  });
  assert.equal(d.abogada, "diana");
  assert.equal(d.trato, "jueza");
  assert.deepEqual(d.deudores, [{ nombre: "Ana Perez", rol: "principal" }]);
  assert.equal(d.montoPagare, 6500);
  assert.equal(d.saldoCapital, undefined);
  assert.equal(d.fechaMora, undefined, "30 de febrero no existe");
  assert.equal(d.fechaSuscripcion, "2023-05-24");
  assert.equal(d.plazo, 60);
  assert.equal(d.modulos.prescripcion, true);
  assert.equal(d.modulos.falsedad, false);
});
