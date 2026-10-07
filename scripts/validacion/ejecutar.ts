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
import {
  resumirComparaciones,
  categoriaMedidaManual,
  categoriaMedidaHerramienta,
  type Comparacion,
} from "../../lib/validacion.js";

const BASE = (process.env.SATJE_API_BASE_URL || "http://127.0.0.1:8010").replace(/\/$/, "");
const API_KEY = process.env.SATJE_API_KEY || "";
const CONCURRENCIA = Number(process.env.CONCURRENCIA || 2);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 90000);
const MAX_DISCREPANCIAS = Number(process.env.MAX_DISCREPANCIAS || 5);

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
  fechaEtapa: "Fecha de la etapa",
  medida: "Medida cautelar",
  fechaInscripcion: "Fecha inscripcion de la medida",
  // "Control de abandono", "Prioridad" y "ACT" no se miden: en la bitacora son
  // formulas de Excel (>150 dias desde Fecha de Etapa, etc.), no datos de SATJE.
  // Saldran solas cuando la herramienta calcule bien la etapa y su fecha.
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
    .filter((l) => l.includes("{"))
    // La terminal web agrega marcas de pegado (^[[200~ ... ~) al inicio y al fin
    // del texto pegado: se toma solo lo que va de la primera "{" a la ultima "}".
    .map((l) => JSON.parse(l.slice(l.indexOf("{"), l.lastIndexOf("}") + 1)));

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
        calculado: null, comparaciones: {}, incidentes: [], ultimas: [], ms: intento.ms, error: intento.error,
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

  const tablaAcierto = (casos: typeof exitosos) => {
    for (const [campo, etiqueta] of Object.entries(ETIQUETAS)) {
      const comps: Comparacion[] = casos.map((r) => r.comparaciones[campo]).filter(Boolean);
      const r = resumirComparaciones(comps);
      p(
        `${linea(etiqueta, 34)} ${linea(r.comparables, 12)} ${linea(r.aciertos, 9)} ${linea(r.porcentajeAcierto === null ? "-" : r.porcentajeAcierto + "%", 5)} ${linea(r.discrepancias, 10)} ${linea(r.sinDatoHerramienta, 15)} ${r.sinDatoManual}`
      );
    }
  };
  tablaAcierto(exitosos);

  const completos = exitosos.filter((r) => !r.parcial);
  p();
  p(`MISMO CALCULO SOLO CON RESPUESTA COMPLETA DE SATJE (${completos.length} juicios, sin los ${exitosos.length - completos.length} parciales)`);
  tablaAcierto(completos);

  // --- Matrices: que puso la oficial (filas) contra que puso la herramienta (columnas) ---
  const porJuicio = new Map(esperados.map((e) => [e.juicio, e]));
  const codigo = (e: unknown) => {
    const m = String(e ?? "").match(/^\s*(\d{1,2})/);
    return m ? m[1].padStart(2, "0") : "--";
  };
  const matriz = (titulo: string, pares: [string, string][]) => {
    const filas = [...new Set(pares.map((x) => x[0]))].sort();
    const cols = [...new Set(pares.map((x) => x[1]))].sort();
    p();
    p(titulo);
    p(`   ${"anotado".padEnd(14)} ${cols.map((c) => c.slice(0, 7).padStart(8)).join("")}   total`);
    for (const f of filas) {
      const sub = pares.filter((x) => x[0] === f);
      p(`   ${f.slice(0, 14).padEnd(14)} ${cols.map((c) => String(sub.filter((x) => x[1] === c).length || ".").padStart(8)).join("")} ${String(sub.length).padStart(7)}`);
    }
  };
  p();
  p("Codigos de etapa: 01 revision legal, 02 sorteo, 03 calificacion, 04 citacion, 05 mediacion, 06 audiencia, 07 sentencia, 08 ejecutoria, 09 apelacion, 10 ejecucion, 12 archivado, 13 concurso, 14 insolvencia, 15 devuelto a cobranzas");
  matriz(
    "MATRIZ ETAPA GENERAL (filas: anotado por la oficial | columnas: herramienta)",
    exitosos
      .filter((r) => ["acierto", "discrepa"].includes(r.comparaciones.etapaGeneral?.resultado))
      .map((r): [string, string] => [codigo(r.comparaciones.etapaGeneral.manual), codigo(r.comparaciones.etapaGeneral.herramienta)])
  );
  matriz(
    "MATRIZ MEDIDA CAUTELAR (ninguna / inmueble / mueble / retencion / otra)",
    exitosos
      .filter((r) => r.calculado && porJuicio.get(r.juicio) && categoriaMedidaManual(porJuicio.get(r.juicio)!.medida) !== "desconocida")
      .map((r): [string, string] => [
        categoriaMedidaManual(porJuicio.get(r.juicio)!.medida),
        categoriaMedidaHerramienta(r.calculado!.medidaDetectada, r.calculado!.tipoMedida),
      ])
  );

  // Archivo compacto para estudiar las reglas de etapa fuera del servidor. Una
  // fila por juicio, SIN el numero de juicio (solo su posicion "ref" en la hoja
  // de la oficial), con las ultimas actuaciones como fecha|tipo|palabras clave.
  const fechaCorta = (v: unknown) => (String(v ?? "").match(/^\d{4}-\d{2}-\d{2}/) || [""])[0];
  const digest = resultados.map((r) => {
    const e = porJuicio.get(r.juicio);
    const acts = r.ultimas.map((u) => `${u.fecha ?? "?"}|${u.tipo.slice(0, 44)}|${u.claves.join(",")}`).join(" ;; ");
    return [
      e?.ref ?? "?",
      codigo(e?.etapaGeneral),
      String(e?.etapa ?? "").slice(0, 5),
      fechaCorta(e?.fechaEtapa),
      codigo(r.calculado?.etapaGeneral),
      r.parcial ? 1 : 0,
      r.ok ? 1 : 0,
      acts,
    ].join("\t");
  });
  writeFileSync(`${carpeta}/digest.tsv`, "ref\tetapa_anotada\tsubetapa\tfecha_etapa\tetapa_herramienta\tparcial\tok\tultimas_actuaciones\n" + digest.join("\n") + "\n");

  // --- Que senales hay en la ultima actuacion de cada etapa anotada por la oficial ---
  p();
  p("ULTIMA ACTUACION SEGUN LA ETAPA QUE ANOTO LA OFICIAL (tipos mas frecuentes | palabras clave de las 2 ultimas)");
  const porEtapa = new Map<string, typeof exitosos>();
  for (const r of exitosos) {
    const e = porJuicio.get(r.juicio);
    if (!e || codigo(e.etapaGeneral) === "--") continue;
    const k = codigo(e.etapaGeneral);
    porEtapa.set(k, [...(porEtapa.get(k) ?? []), r]);
  }
  const top = (valores: string[], n: number) => {
    const c = new Map<string, number>();
    for (const v of valores) c.set(v, (c.get(v) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, k]) => `${k}x ${v}`);
  };
  for (const [k, casos] of [...porEtapa.entries()].sort()) {
    p(`   ${k} (n=${casos.length}) tipos: ${top(casos.map((r) => (r.ultimas[0]?.tipo || "?").slice(0, 36)), 3).join(" ; ")}`);
    p(`        claves: ${top(casos.flatMap((r) => r.ultimas.slice(0, 2).flatMap((u) => u.claves)), 6).join(", ")}`);
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
