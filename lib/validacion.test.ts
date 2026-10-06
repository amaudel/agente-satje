import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarEtapa,
  compararEtapa,
  categoriaMedidaManual,
  categoriaMedidaHerramienta,
  compararMedida,
  compararFecha,
  categoriaControlAbandono,
  compararControlAbandono,
  resumirComparaciones,
  type Comparacion,
} from "./validacion.js";

describe("normalizarEtapa", () => {
  test("ignora mayusculas, tildes y espacios", () => {
    assert.equal(normalizarEtapa("04. CITACIÓN"), normalizarEtapa("04.CITACION"));
    assert.equal(normalizarEtapa("  10.  EJECUCION "), "10. ejecucion");
  });

  test("devuelve cadena vacia para vacios y 'no aplica'", () => {
    assert.equal(normalizarEtapa(null), "");
    assert.equal(normalizarEtapa(""), "");
    assert.equal(normalizarEtapa("NO APLICA"), "");
  });
});

describe("compararEtapa", () => {
  test("acierto cuando coinciden tras normalizar", () => {
    assert.equal(compararEtapa("04. CITACIÓN", "04.CITACION").resultado, "acierto");
  });

  test("discrepa cuando son distintas y conserva ambos valores", () => {
    const c = compararEtapa("10. EJECUCION", "07. SENTENCIA");
    assert.equal(c.resultado, "discrepa");
    assert.equal(c.manual, "10. EJECUCION");
    assert.equal(c.herramienta, "07. SENTENCIA");
  });

  test("sin_dato_manual si la oficial no anoto nada", () => {
    assert.equal(compararEtapa("", "07. SENTENCIA").resultado, "sin_dato_manual");
  });

  test("sin_dato_herramienta si la herramienta no devolvio nada", () => {
    assert.equal(compararEtapa("07. SENTENCIA", null).resultado, "sin_dato_herramienta");
  });
});

describe("categorias de medida", () => {
  test("lo anotado a mano se agrupa en categorias comparables", () => {
    assert.equal(categoriaMedidaManual("SIN MEDIDA PREVENTIVA"), "ninguna");
    assert.equal(categoriaMedidaManual("PROH. ENAJENAR INMUEBLES"), "inmueble");
    assert.equal(categoriaMedidaManual("PROH. ENEJENAR INMUEBLES"), "inmueble");
    assert.equal(categoriaMedidaManual("PROH. ENAJENAR MUEBLES"), "mueble");
    assert.equal(categoriaMedidaManual("EMBARGO"), "otra");
    assert.equal(categoriaMedidaManual("SECUESTRO"), "otra");
    assert.equal(categoriaMedidaManual("RETENCIÓN"), "retencion");
    assert.equal(categoriaMedidaManual("SIN INFO"), "desconocida");
    assert.equal(categoriaMedidaManual(""), "desconocida");
  });

  test("lo detectado por la herramienta se agrupa igual", () => {
    assert.equal(categoriaMedidaHerramienta(false, "PROHIBICIÓN DE ENAJENAR / EMBARGO"), "ninguna");
    assert.equal(categoriaMedidaHerramienta(true, "PROHIBICIÓN DE ENAJENAR / EMBARGO (INMUEBLE)"), "inmueble");
    assert.equal(categoriaMedidaHerramienta(true, "EMBARGO / PROHIBICIÓN AUTOMOTOR"), "mueble");
    assert.equal(categoriaMedidaHerramienta(true, "RETENCIÓN DE CUENTAS BANCARIAS"), "retencion");
    assert.equal(categoriaMedidaHerramienta(true, "PROHIBICIÓN DE ENAJENAR / EMBARGO"), "otra");
  });
});

describe("compararMedida", () => {
  test("acierto cuando ambas dicen que no hay medida", () => {
    assert.equal(compararMedida("SIN MEDIDA PREVENTIVA", false, "X").resultado, "acierto");
  });

  test("discrepa en presencia: ella anoto medida y la herramienta no detecto", () => {
    const c = compararMedida("PROH. ENAJENAR INMUEBLES", false, "X");
    assert.equal(c.resultado, "discrepa");
    assert.match(c.detalle ?? "", /presencia/);
  });

  test("acierto de tipo cuando ambas dicen inmueble", () => {
    assert.equal(
      compararMedida("PROH. ENAJENAR INMUEBLES", true, "PROHIBICIÓN DE ENAJENAR / EMBARGO (INMUEBLE)").resultado,
      "acierto"
    );
  });

  test("EMBARGO anotado a mano solo exige que la herramienta detecte alguna medida", () => {
    assert.equal(compararMedida("EMBARGO", true, "PROHIBICIÓN DE ENAJENAR / EMBARGO (INMUEBLE)").resultado, "acierto");
    assert.equal(compararMedida("EMBARGO", false, "X").resultado, "discrepa");
  });

  test("sin_dato_manual cuando la oficial puso SIN INFO", () => {
    assert.equal(compararMedida("SIN INFO", true, "X").resultado, "sin_dato_manual");
  });

  test("discrepa por tipo: ella inmueble, la herramienta mueble", () => {
    const c = compararMedida("PROH. ENAJENAR INMUEBLES", true, "EMBARGO / PROHIBICIÓN AUTOMOTOR");
    assert.equal(c.resultado, "discrepa");
    assert.match(c.detalle ?? "", /tipo/);
  });
});

describe("compararFecha", () => {
  test("acierto con la misma fecha aunque venga con hora", () => {
    assert.equal(compararFecha("2026-03-12 00:00:00", "2026-03-12").resultado, "acierto");
  });

  test("discrepa y informa la diferencia en dias", () => {
    const c = compararFecha("2026-03-12", "2026-03-15");
    assert.equal(c.resultado, "discrepa");
    assert.equal(c.diasDiferencia, 3);
  });

  test("ambas vacias cuenta como acierto (las dos dicen que no hay fecha)", () => {
    assert.equal(compararFecha("", null).resultado, "acierto");
    assert.equal(compararFecha("NO APLICA", null).resultado, "acierto");
  });

  test("ella tiene fecha y la herramienta no: sin_dato_herramienta", () => {
    assert.equal(compararFecha("2026-03-12", null).resultado, "sin_dato_herramienta");
  });

  test("la herramienta tiene fecha y ella no: discrepa (dato que no estaba anotado)", () => {
    const c = compararFecha("", "2026-03-12");
    assert.equal(c.resultado, "discrepa");
    assert.match(c.detalle ?? "", /no anotada/);
  });

  test("fechas absurdas de digitacion (anio 2926) se tratan como sin dato", () => {
    assert.equal(compararFecha("2926-09-08", "2026-09-08").resultado, "sin_dato_manual");
  });
});

describe("resumirComparaciones", () => {
  const c = (resultado: Comparacion["resultado"]): Comparacion => ({ resultado, manual: "a", herramienta: "b" });

  test("cuenta aciertos sobre los casos comparables, excluyendo los sin dato", () => {
    const r = resumirComparaciones([c("acierto"), c("acierto"), c("discrepa"), c("sin_dato_manual"), c("sin_dato_herramienta")]);
    assert.equal(r.aciertos, 2);
    assert.equal(r.discrepancias, 1);
    assert.equal(r.sinDatoManual, 1);
    assert.equal(r.sinDatoHerramienta, 1);
    assert.equal(r.comparables, 4);
    assert.equal(r.porcentajeAcierto, 50);
  });

  test("sin casos comparables el porcentaje es null, no 0", () => {
    assert.equal(resumirComparaciones([c("sin_dato_manual")]).porcentajeAcierto, null);
  });
});

describe("control de abandono a 5 meses", () => {
  const hoy = new Date("2026-10-06T12:00:00Z");

  test("categoria segun los meses desde la ultima actuacion", () => {
    assert.equal(categoriaControlAbandono("2026-04-01", hoy), ">5M");
    assert.equal(categoriaControlAbandono("2026-06-01", hoy), "<5M");
    assert.equal(categoriaControlAbandono("2026-05-06", hoy), "<5M"); // justo 5 meses
    assert.equal(categoriaControlAbandono("2026-05-05", hoy), ">5M");
  });

  test("sin fecha utilizable es NO HAY FECHA", () => {
    assert.equal(categoriaControlAbandono(null, hoy), "NO HAY FECHA");
    assert.equal(categoriaControlAbandono("N/A", hoy), "NO HAY FECHA");
  });

  test("comparacion contra lo anotado a mano", () => {
    assert.equal(compararControlAbandono(">5M", "2026-01-10", hoy).resultado, "acierto");
    assert.equal(compararControlAbandono("<5M", "2026-01-10", hoy).resultado, "discrepa");
    assert.equal(compararControlAbandono("#VALUE!", "2026-01-10", hoy).resultado, "sin_dato_manual");
    assert.equal(compararControlAbandono("", "2026-01-10", hoy).resultado, "sin_dato_manual");
  });
});
