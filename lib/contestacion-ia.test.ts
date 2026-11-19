import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contenidoUsuarioContestacion,
  costoEstimado,
  interpretarRespuestaContestacion,
  validarArchivos,
} from "./contestacion-ia.js";
import { armarGuia, sanearDatosGuia } from "./guia-audiencia.js";
import { guiaADocx } from "./guia-docx.js";

test("archivos: tipos, cantidad y tamano", () => {
  assert.match(validarArchivos([]) ?? "", /ningún archivo/);
  assert.match(validarArchivos([{ tipo: "text/plain", datos: "QUJD" }]) ?? "", /PDF o fotos/);
  assert.match(validarArchivos([{ tipo: "application/pdf", datos: "QUJD" }, { tipo: "application/pdf", datos: "QUJD" }]) ?? "", /un solo PDF/);
  assert.match(validarArchivos([{ tipo: "application/pdf", datos: "QUJD" }, { tipo: "image/jpeg", datos: "QUJD" }]) ?? "", /no ambos/);
  assert.match(validarArchivos([{ tipo: "application/pdf", datos: "A".repeat(4_500_000) }]) ?? "", /3 MB/);
  assert.match(validarArchivos([{ tipo: "image/jpeg", datos: "<script>" }]) ?? "", /dañado/);
  assert.equal(validarArchivos([{ tipo: "application/pdf", datos: "JVBERi0xLjQ=" }]), null);
  assert.equal(validarArchivos([{ tipo: "image/jpeg", datos: "QUJD" }, { tipo: "image/png", datos: "QUJD" }]), null);
});

test("el PDF va como archivo y las fotos como imagenes", () => {
  const c = contenidoUsuarioContestacion([{ nombre: "c.pdf", tipo: "application/pdf", datos: "JVBERi0=" }]);
  assert.equal(c[1].type, "file");
  assert.equal(c[1].file.file_data, "data:application/pdf;base64,JVBERi0=");
  const f = contenidoUsuarioContestacion([{ nombre: "p1.jpg", tipo: "image/jpeg", datos: "QUJD" }]);
  assert.equal(f[1].type, "image_url");
  assert.equal(f[1].image_url.url, "data:image/jpeg;base64,QUJD");
});

test("costo estimado", () => {
  assert.equal(costoEstimado("gpt-4.1-mini", 30000, 2000), 0.0152);
  assert.equal(costoEstimado("gpt-4o-mini", 100000, 1000), 0.0156);
});

test("la respuesta de la IA se limpia y valida", () => {
  const r = interpretarRespuestaContestacion({
    esContestacion: true,
    quienContesta: "  Ana Perez  ",
    excepciones: { legitimacion: "true", faltaLugarPago: true, falsedad: false, prescripcion: "si", otras: [{ nombre: "Pago parcial", resumen: "dice que pagó", pagina: "3" }, { nombre: "" }] },
    pruebaDeudor: { pericia: true, detalle: ["Pericia grafotécnica", null] },
    reconoceDeuda: true,
    datosCredito: { numeroPagare: 198870, montoPagare: "6.500,00", fechaMora: "2025-02-30", fechaSuscripcion: "2023-05-24", tasa: "17,5%", saldoCapital: 9000, plazo: "60" },
    puntosARebatir: [{ argumento: "El pagaré no tiene lugar de pago", pagina: 4, respuesta: "Art. 188 del Código de Comercio..." }, { argumento: "sin respuesta" }],
    contradicciones: [{ texto: "Ofrece como prueba el mismo pagaré", pagina: 9 }],
  });
  assert.equal(r.quienContesta, "Ana Perez");
  assert.equal(r.excepciones.legitimacion, true);
  assert.equal(r.excepciones.requisitos, true, "faltaLugarPago implica requisitos");
  assert.equal(r.excepciones.prescripcion, false, "'si' no es un booleano valido");
  assert.deepEqual(r.excepciones.otras, [{ nombre: "Pago parcial", resumen: "dice que pagó", pagina: 3 }]);
  assert.deepEqual(r.pruebaDeudor.detalle, ["Pericia grafotécnica"]);
  assert.equal(r.datosCredito.numeroPagare, "198870");
  assert.equal(r.datosCredito.montoPagare, 6500);
  assert.equal(r.datosCredito.fechaMora, undefined, "fecha imposible");
  assert.equal(r.datosCredito.tasa, "17.5");
  assert.equal(r.datosCredito.plazo, 60);
  assert.equal(r.puntosARebatir.length, 1);
  assert.ok(r.advertencias.some((a) => a.includes("mayor que el monto")));
});

test("documento que no es contestacion: aviso", () => {
  const r = interpretarRespuestaContestacion({ esContestacion: false });
  assert.equal(r.esContestacion, false);
  assert.ok(r.advertencias[0].includes("no parece una contestación"));
});

test("la guia incluye lo sugerido por IA marcado aparte", async () => {
  const d = sanearDatosGuia({
    causa: "01333-2026-03148",
    deudores: [{ nombre: "Ana Perez", rol: "principal" }],
    modulos: { requisitos: true },
    ia: {
      puntos: [{ argumento: "El pagaré no tiene lugar de pago.", pagina: 4, respuesta: "El art. 188 suple esa omisión." }, { argumento: "", respuesta: "x" }],
      contradicciones: [{ texto: "Ofrece como prueba propia el pagaré que impugna", pagina: 9 }],
      otrasExcepciones: [{ nombre: "Pago parcial", resumen: "dice que abonó", pagina: 3 }],
    },
  });
  assert.equal(d.ia?.puntos.length, 1);
  const g = armarGuia(d);
  const trozos = g.bloques.flatMap((b) => ("trozos" in b ? b.trozos : "items" in b ? b.items.flat() : []));
  const ia = trozos.filter((t) => t.ia).map((t) => t.t).join(" ");
  assert.ok(ia.includes("La parte demandada alega que el pagaré no tiene lugar de pago (pág. 4 de la contestación)."));
  assert.ok(ia.includes("El art. 188 suple esa omisión."));
  assert.ok(ia.includes("Ofrece como prueba propia el pagaré que impugna (pág. 9 de la contestación)"));
  assert.ok(ia.includes("Pago parcial: dice que abonó (pág. 3)"));
  assert.ok(g.avisos.some((a) => a.includes("MORADO")));
  assert.ok(g.avisos.some((a) => a.includes("Pago parcial")));
  const buf = Buffer.from(await guiaADocx(g), "base64");
  assert.equal(buf.subarray(0, 2).toString(), "PK");
});

test("sin aportes de IA no se agrega nada", () => {
  const d = sanearDatosGuia({ causa: "01333-2026-03148", deudores: [{ nombre: "Ana Perez" }], modulos: {}, ia: { puntos: [], contradicciones: [] } });
  assert.equal(d.ia, undefined);
  assert.ok(!armarGuia(d).avisos.some((a) => a.includes("MORADO")));
});
