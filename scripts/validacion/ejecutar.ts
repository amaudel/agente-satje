// Valida la herramienta contra lo que anoto a mano una oficial juridica.
//
// Para cada juicio de la muestra consulta el backend, calcula etapa, medida
// cautelar, etc. con el mismo analisis del dashboard y lo compara con lo
// anotado. Imprime un informe y deja los resultados en disco.
//
// Uso (en el VPS, junto al backend):
//   SATJE_API_KEY=... npx tsx scripts/validacion/ejecutar.ts muestra.jsonl [carpeta_salida]
//
// Variables opcionales:
//   SATJE_API_BASE_URL  (por defecto http://127.0.0.1:8010)
//   CONCURRENCIA        (por defecto 2: el backend solo atiende 2 llamadas a SATJE a la vez)
//   TIMEOUT_MS          (por defecto 90000)
//   MAX_DISCREPANCIAS   (por defecto 12 por columna en el informe)
//
// Los resultados contienen datos de la cartera: NO los subas a git.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { sinSeparadoresCausa } from "../../lib/legal-analysis.js";
import { evaluarCaso, type Esperado, type ResultadoCaso } from "../../lib/validacion-caso.js";
import { resumirComparaciones, type Comparacion } from "../../lib/validacion.js";

const BASE = (process.env.SATJE_API_BASE_URL || "http://127.0.0.1:8010").replace(/\/$/, "");
const API_KEY = process.env.SATJE_API_KEY || "";
const CONCURRENCIA = Number(process.env.CONCURRENCIA || 2);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 90000);
const MAX_DISCREPANCIAS = Number(process.env.MAX_DISCREPANCIAS || 12);

const [entrada, carpeta = "datos-privados/resultados"] = process.argv.slice(2);
if (!entrada) {
  console.error("Falta el archivo de la muestra (.jsonl). Uso: npx tsx scripts/validacion/ejecutar.ts muestra.jsonl");
  process.exit(2);
}
if (!API_KEY) {
  console.error("Falta SATJE_API_KEY en el entorno.");
  process.exit(2);
}

const ETIQUETAS: Record<string, string> = {
  etapaGeneral: "Etapa procesal general",
  etapa: "Etapa procesal (especifica)",
  medida: "Medida cautelar",
  fechaInscripcion: "Fecha inscripcion de la medida",
  controlAbandono: "Control de abandono (5 meses)",
};

interface Intento {
  data?: any;
  error?: string;
  ms: number;
}

async function consultar(juicio: string): Promise<Intento> {
  const url = `${BASE}/api/v1/causas/${encodeURIComponent(sinSeparadoresCausa(juicio))}/actuaciones`;
  const inicio = Date.now();
  let ultimoError = "";
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const res = await fetch(url, {
        headers: { "X-API-Key": API_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { data: await res.json(), ms: Date.now() - inicio };
      ultimoError = `HTTP ${res.status}`;
      if (res.status === 404 || res.status === 422) break; // no tiene sentido reintentar
    } catch (e: any) {
      ultimoError = e?.name === "TimeoutError" ? `timeout ${TIMEOUT_MS} ms` : e?.message || String(e);
    }
  }
  return { error: ultimoError, ms: Date.now() - inicio };
}

async function conConcurrencia<T, R>(items: T[], limite: number, tarea: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  async function obrero() {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      salida[i] = await tarea(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, obrero));
  return salida;
}

function linea(valor: unknown, ancho: number): string {
  const s = String(valor ?? "");
  return s.length > ancho ? s.slice(0, ancho - 1) + "…" : s.padEnd(ancho);
}

async function main() {
  const esperados: Esperado[] = readFileSync(entrada, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  console.error(`Muestra: ${esperados.length} juicios | backend ${BASE} | concurrencia ${CONCURRENCIA}`);
  const hoy = new Date();
  const t0 = Date.now();
  let hechos = 0;

  const resultados = await conConcurrencia(esperados, CONCURRENCIA, async (esp): Promise<ResultadoCaso & { ms: number; error?: string }> => {
    const intento = await consultar(esp.juicio);
    hechos++;
    if (hechos % 10 === 0 || hechos === esperados.length) {
      console.error(`  ${hechos}/${esperados.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
    if (!intento.data) {
      return {
        juicio: esp.juicio, ok: false, motivo: intento.error, parcial: false, totalActuaciones: 0,
        calculado: null, comparaciones: {}, incidentes: [], ms: intento.ms, error: intento.error,
      };
    }
    return { ...evaluarCaso(esp, intento.data, hoy), ms: intento.ms };
  });

  mkdirSync(carpeta, { recursive: true });
  writeFileSync(`${carpeta}/resultados.jsonl`, resultados.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const out: string[] = [];
  const p = (s = "") => out.push(s);

  const exitosos = resultados.filter((r) => r.ok);
  const fallidos = resultados.filter((r) => !r.ok);
  const parciales = resultados.filter((r) => r.parcial);
  const ms = resultados.map((r) => r.ms).sort((a, b) => a - b);
  p(`INFORME DE VALIDACION  (${hoy.toISOString().slice(0, 10)})`);
  p(`Juicios en la muestra: ${resultados.length} | consultados con exito: ${exitosos.length} | fallidos: ${fallidos.length} | con respuesta parcial: ${parciales.length}`);
  p(`Tiempo total: ${Math.round((Date.now() - t0) / 1000)} s | por juicio: mediana ${ms[Math.floor(ms.length / 2)]} ms, maximo ${ms[ms.length - 1]} ms`);
  p();
  p("ACIERTO POR COLUMNA (sobre los casos donde habia dato para comparar)");
  p(`${linea("Columna", 34)} ${linea("comparables", 12)} ${linea("aciertos", 9)} ${linea("%", 5)} ${linea("discrepan", 10)} ${linea("sin dato herr.", 15)} sin dato manual`);

  for (const [campo, etiqueta] of Object.entries(ETIQUETAS)) {
    const comps: Comparacion[] = exitosos.map((r) => r.comparaciones[campo]).filter(Boolean);
    const r = resumirComparaciones(comps);
    p(
      `${linea(etiqueta, 34)} ${linea(r.comparables, 12)} ${linea(r.aciertos, 9)} ${linea(r.porcentajeAcierto === null ? "-" : r.porcentajeAcierto + "%", 5)} ${linea(r.discrepancias, 10)} ${linea(r.sinDatoHerramienta, 15)} ${r.sinDatoManual}`
    );
  }

  p();
  p("DISCREPANCIAS (juicio | anotado a mano | herramienta)");
  for (const [campo, etiqueta] of Object.entries(ETIQUETAS)) {
    const malos = exitosos.filter((r) => ["discrepa", "sin_dato_herramienta"].includes(r.comparaciones[campo]?.resultado));
    if (malos.length === 0) continue;
    p(`-- ${etiqueta}: ${malos.length} caso(s)`);
    for (const r of malos.slice(0, MAX_DISCREPANCIAS)) {
      const c = r.comparaciones[campo];
      const extra = c.diasDiferencia !== undefined ? ` (${c.diasDiferencia > 0 ? "+" : ""}${c.diasDiferencia} dias)` : c.detalle ? ` [${c.detalle}]` : "";
      p(`   ${r.juicio} | ${c.manual ?? "(vacio)"} | ${c.herramienta ?? "(vacio)"}${extra}`);
    }
    if (malos.length > MAX_DISCREPANCIAS) p(`   ... y ${malos.length - MAX_DISCREPANCIAS} mas (ver resultados.jsonl)`);
  }

  if (fallidos.length) {
    p();
    p(`NO SE PUDIERON CONSULTAR (${fallidos.length})`);
    const motivos = new Map<string, number>();
    for (const f of fallidos) motivos.set(f.motivo || "?", (motivos.get(f.motivo || "?") || 0) + 1);
    for (const [m, n] of motivos) p(`   ${n} x ${m}`);
    p("   " + fallidos.slice(0, 10).map((f) => f.juicio).join(", "));
  }

  // Descubrimiento de la unidad deprecada: no se compara, solo se muestra como
  // se ven los incidentes de los juicios donde ella anoto una unidad deprecada.
  const conDeprecada = esperados.filter((e) => e.unidadDeprecada && e.unidadDeprecada.toLowerCase() !== "no aplica");
  p();
  p(`UNIDAD DEPRECADA - material para disenar la regla (${Math.min(conDeprecada.length, 25)} de ${conDeprecada.length})`);
  p("   juicio | ella: unidad / fecha calificacion | incidentes en SATJE: (n) judicatura, primera fecha, tipos");
  for (const e of conDeprecada.slice(0, 25)) {
    const r = resultados.find((x) => x.juicio === e.juicio);
    if (!r || !r.ok) continue;
    const incs = r.incidentes.map((i) => `(${i.numero}) ${i.judicatura.replace(/UNIDAD JUDICIAL /i, "UJ ").slice(0, 38)}, ${i.primeraFecha ?? "?"}, [${i.tipos.map((t) => t.slice(0, 24)).join(" ; ")}]`);
    p(`   ${e.juicio} | ${(e.unidadDeprecada || "").replace(/UNIDAD JUDICIAL /i, "UJ ").slice(0, 38)} / ${(e.fechaCalifDeprecatorio || "").slice(0, 10)} | ${incs.join(" || ")}`);
  }

  const informe = out.join("\n");
  writeFileSync(`${carpeta}/informe.txt`, informe + "\n");
  console.log(informe);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
