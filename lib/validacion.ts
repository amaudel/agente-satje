// Reglas para comparar lo que anoto a mano una oficial juridica con lo que
// calcula la herramienta a partir de SATJE. Sirve para medir el porcentaje de
// acierto por columna ANTES de confiarle la carga completa.
//
// Principio: un caso solo cuenta como "acierto" si ambas fuentes dicen lo mismo;
// cuando una de las dos no tiene dato se separa en su propia categoria en vez de
// mezclarlo con aciertos o errores.

export type ResultadoComparacion =
  | "acierto"
  | "discrepa"
  | "sin_dato_manual"
  | "sin_dato_herramienta";

export interface Comparacion {
  resultado: ResultadoComparacion;
  manual: string | null;
  herramienta: string | null;
  detalle?: string;
  diasDiferencia?: number;
}

function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const VALORES_VACIOS = new Set(["", "no aplica", "n/a", "na", "sin info", "#value!", "#ref!", "#n/a"]);

function limpiar(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function esVacio(valor: unknown): boolean {
  return VALORES_VACIOS.has(sinTildes(limpiar(valor)).toLowerCase());
}

// "04. CITACIÓN", "04.CITACION" y " 04.  citacion " son la misma etapa.
export function normalizarEtapa(valor: unknown): string {
  if (esVacio(valor)) return "";
  return sinTildes(limpiar(valor))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.\s*(?=\S)/g, ". ")
    .trim();
}

export function compararEtapa(manual: unknown, herramienta: unknown): Comparacion {
  const m = normalizarEtapa(manual);
  const h = normalizarEtapa(herramienta);
  const base = { manual: limpiar(manual) || null, herramienta: limpiar(herramienta) || null };
  if (!m) return { ...base, resultado: "sin_dato_manual" };
  if (!h) return { ...base, resultado: "sin_dato_herramienta" };
  return { ...base, resultado: m === h ? "acierto" : "discrepa" };
}

export type CategoriaMedida = "ninguna" | "inmueble" | "mueble" | "retencion" | "otra" | "desconocida";

// Lo que la oficial escribe en MEDIDAS CAUTELARES. "EMBARGO" y "SECUESTRO" son
// acciones y no dicen sobre que bien recaen, por eso caen en "otra": solo se
// puede comprobar que exista alguna medida.
export function categoriaMedidaManual(valor: unknown): CategoriaMedida {
  const t = sinTildes(limpiar(valor)).toLowerCase();
  if (!t || t === "sin info" || t === "medidas cautelares") return "desconocida";
  if (t.includes("sin medida")) return "ninguna";
  if (/enajenar|enejenar/.test(t) && t.includes("inmueble")) return "inmueble";
  if (/enajenar|enejenar/.test(t) && t.includes("mueble")) return "mueble";
  if (t.includes("retencion")) return "retencion";
  return "otra";
}

export function categoriaMedidaHerramienta(detectada: boolean, tipoMedida: unknown): CategoriaMedida {
  if (!detectada) return "ninguna";
  const t = sinTildes(limpiar(tipoMedida)).toLowerCase();
  if (t.includes("inmueble")) return "inmueble";
  if (t.includes("automotor") || t.includes("vehicul")) return "mueble";
  if (t.includes("cuentas") || t.includes("retencion")) return "retencion";
  return "otra";
}

export function compararMedida(manual: unknown, detectada: boolean, tipoMedida: unknown): Comparacion {
  const cm = categoriaMedidaManual(manual);
  const ch = categoriaMedidaHerramienta(detectada, tipoMedida);
  const base = {
    manual: limpiar(manual) || null,
    herramienta: detectada ? limpiar(tipoMedida) || "medida detectada" : "sin medida",
  };
  if (cm === "desconocida") return { ...base, resultado: "sin_dato_manual" };

  const manualTiene = cm !== "ninguna";
  if (manualTiene !== detectada) {
    return {
      ...base,
      resultado: "discrepa",
      detalle: manualTiene ? "presencia: anotada a mano, no detectada" : "presencia: detectada, no anotada a mano",
    };
  }
  if (!manualTiene) return { ...base, resultado: "acierto" };

  // Ambas dicen que hay medida: solo se compara el tipo cuando ambas lo conocen.
  if (cm === "otra" || ch === "otra") return { ...base, resultado: "acierto" };
  if (cm !== ch) return { ...base, resultado: "discrepa", detalle: `tipo: a mano ${cm}, herramienta ${ch}` };
  return { ...base, resultado: "acierto" };
}

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function aFecha(valor: unknown): { iso: string; ms: number } | "invalida" | null {
  if (esVacio(valor)) return null;
  const m = limpiar(valor).match(FECHA_RE);
  if (!m) return "invalida";
  const anio = Number(m[1]);
  // Errores de digitacion como 2926-09-08 no son una fecha utilizable.
  if (anio < 1990 || anio > 2100) return "invalida";
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return { iso, ms: Date.parse(`${iso}T00:00:00Z`) };
}

export function compararFecha(manual: unknown, herramienta: unknown): Comparacion {
  const m = aFecha(manual);
  const h = aFecha(herramienta);
  const base = { manual: limpiar(manual) || null, herramienta: limpiar(herramienta) || null };

  if (m === "invalida") return { ...base, resultado: "sin_dato_manual", detalle: "fecha anotada no valida" };
  if (m === null && h === null) return { ...base, resultado: "acierto" };
  if (h === "invalida") return { ...base, resultado: "sin_dato_herramienta", detalle: "fecha de la herramienta no valida" };
  if (m === null && h) {
    return { ...base, resultado: "discrepa", detalle: "la herramienta encontro una fecha no anotada a mano" };
  }
  if (m && h === null) return { ...base, resultado: "sin_dato_herramienta" };
  if (m && h && typeof m === "object" && typeof h === "object") {
    if (m.iso === h.iso) return { ...base, resultado: "acierto" };
    return {
      ...base,
      resultado: "discrepa",
      diasDiferencia: Math.round((h.ms - m.ms) / 86400000),
    };
  }
  return { ...base, resultado: "sin_dato_herramienta" };
}

export interface ResumenComparaciones {
  aciertos: number;
  discrepancias: number;
  sinDatoManual: number;
  sinDatoHerramienta: number;
  comparables: number;
  porcentajeAcierto: number | null;
}

// Un caso en que la oficial anoto algo y la herramienta no pudo sacarlo cuenta
// contra la herramienta: es un dato que seguiria faltando.
export function resumirComparaciones(comparaciones: Comparacion[]): ResumenComparaciones {
  const cuenta = (r: ResultadoComparacion) => comparaciones.filter((c) => c.resultado === r).length;
  const aciertos = cuenta("acierto");
  const discrepancias = cuenta("discrepa");
  const sinDatoManual = cuenta("sin_dato_manual");
  const sinDatoHerramienta = cuenta("sin_dato_herramienta");
  const comparables = aciertos + discrepancias + sinDatoHerramienta;
  return {
    aciertos,
    discrepancias,
    sinDatoManual,
    sinDatoHerramienta,
    comparables,
    porcentajeAcierto: comparables === 0 ? null : Math.round((aciertos * 100) / comparables),
  };
}

export type CategoriaControlAbandono = ">5M" | "<5M" | "NO HAY FECHA";

// La bitacora controla el abandono con un umbral de 5 meses (antes de los 6
// legales): ">5M" si desde la ultima actuacion util pasaron mas de 5 meses.
export function categoriaControlAbandono(fechaUltimaActuacion: unknown, hoy: Date): CategoriaControlAbandono {
  const f = aFecha(fechaUltimaActuacion);
  if (f === null || f === "invalida") return "NO HAY FECHA";
  const limite = new Date(f.ms);
  limite.setUTCMonth(limite.getUTCMonth() + 5);
  return hoy.getTime() > limite.getTime() + 86400000 - 1 ? ">5M" : "<5M";
}

export function compararControlAbandono(manual: unknown, fechaUltimaActuacion: unknown, hoy: Date): Comparacion {
  const m = limpiar(manual).toUpperCase().replace(/\s+/g, " ");
  const h = categoriaControlAbandono(fechaUltimaActuacion, hoy);
  const base = { manual: limpiar(manual) || null, herramienta: h as string };
  if (m !== ">5M" && m !== "<5M" && m !== "NO HAY FECHA") return { ...base, resultado: "sin_dato_manual" };
  return { ...base, resultado: m === h ? "acierto" : "discrepa" };
}
