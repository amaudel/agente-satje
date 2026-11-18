// "Resumen en 10 segundos": lo que la abogada necesita saber de un vistazo y
// el siguiente paso sugerido. Se arma con reglas a partir de los mismos datos
// de las tarjetas (no usa IA), para que sea inmediato y no contradiga nada.

export type Tono = "favor" | "curso" | "revisar" | "riesgo" | "neutral";

export interface FilaResumen {
  tono: Tono;
  etiqueta: string;
  tema: string;
  texto: string;
}

export interface ResumenRapido {
  filas: FilaResumen[];
  siguientePaso: { texto: string; promptChat: string };
}

export const ETIQUETA_TONO: Record<Tono, string> = {
  favor: "A favor",
  curso: "En curso",
  revisar: "Revisar",
  riesgo: "Riesgo",
  neutral: "Sin datos",
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2023-11-30T16:51:06.000+00:00" -> "30 nov 2023, 11:51" (hora de Ecuador). Sin hora si no la trae. */
export function fechaLegible(valor: unknown, conHora = true): string {
  const texto = String(valor ?? "").trim();
  if (!texto) return "";
  const soloDia = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soloDia) return `${Number(soloDia[3])} ${MESES[Number(soloDia[2]) - 1]} ${soloDia[1]}`;
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return texto;
  const ec = new Date(d.getTime() - 5 * 3600 * 1000); // Ecuador: UTC-5, sin horario de verano
  const dia = `${ec.getUTCDate()} ${MESES[ec.getUTCMonth()]} ${ec.getUTCFullYear()}`;
  if (!conHora || !/T\d{2}:\d{2}/.test(texto)) return dia;
  return `${dia}, ${String(ec.getUTCHours()).padStart(2, "0")}:${String(ec.getUTCMinutes()).padStart(2, "0")}`;
}

function limpiarEtapa(texto: unknown): string {
  return String(texto ?? "").replace(/^\s*\d+(\.\d+)*\.?\s*/, "").replace(/\s+/g, " ").trim();
}

export function juezNegoAbandono(abandono: any): boolean {
  return /improcedente un pedido de abandono/i.test(String(abandono?.explicacion || ""));
}

export function construirResumenRapido(d: {
  etapa: any;
  poseeSentencia: boolean;
  fechaSentencia?: string | null;
  cautelar: any;
  abandono: any;
}): ResumenRapido {
  const filas: FilaResumen[] = [];
  const etapaGeneral = limpiarEtapa(d.etapa?.etapaGeneral);
  const etapaEspecifica = limpiarEtapa(d.etapa?.etapaEspecifica);
  const enCitacion = /citaci/i.test(`${etapaGeneral} ${etapaEspecifica}`) || String(d.etapa?.codigoEtapa || "").startsWith("04");
  const enEjecucion = /ejecuci|ejecutoria/i.test(`${etapaGeneral} ${etapaEspecifica}`);

  // 1. Etapa
  if (d.poseeSentencia) {
    filas.push({
      tono: "neutral",
      etiqueta: "Con sentencia",
      tema: "Etapa",
      texto: `${etapaGeneral || "Sentencia emitida"}${d.fechaSentencia ? ` (sentencia del ${fechaLegible(d.fechaSentencia, false)})` : ""}.`,
    });
  } else {
    filas.push({
      tono: etapaGeneral ? "curso" : "neutral",
      etiqueta: etapaGeneral ? ETIQUETA_TONO.curso : ETIQUETA_TONO.neutral,
      tema: "Etapa",
      texto: etapaGeneral ? `${etapaGeneral}${etapaEspecifica && etapaEspecifica !== etapaGeneral ? ` · ${etapaEspecifica}` : ""}.` : "No se pudo clasificar la etapa.",
    });
  }

  // 2. Medida cautelar
  const c = d.cautelar || {};
  const posibleRespuesta = String(c.observacion || "").startsWith("Posible respuesta del Registro");
  if (!c.medidaDetectada) {
    filas.push({ tono: "neutral", etiqueta: "Sin medida", tema: "Medida cautelar", texto: "No se registra medida cautelar en el expediente." });
  } else if (c.estadoCicloVida === "INSCRIPCION_CONFIRMADA") {
    const cuando = c.fechaInscripcion
      ? `inscrita el ${fechaLegible(c.fechaInscripcion, false)}`
      : c.fechaActuacionSatje ? `razón presentada el ${fechaLegible(c.fechaActuacionSatje, false)}` : "inscrita";
    filas.push({ tono: "favor", etiqueta: ETIQUETA_TONO.favor, tema: "Medida cautelar", texto: `${c.tipoMedida || "Medida"} inscrita en ${c.institucionEjecutora || "el Registro"} (${cuando}).` });
  } else if (c.estadoCicloVida === "LEVANTADA") {
    filas.push({ tono: "neutral", etiqueta: "Levantada", tema: "Medida cautelar", texto: `${c.tipoMedida || "La medida"} fue levantada.` });
  } else if (posibleRespuesta) {
    filas.push({ tono: "revisar", etiqueta: ETIQUETA_TONO.revisar, tema: "Medida cautelar", texto: `Posible respuesta del Registro el ${fechaLegible(c.fechaActuacionSatje, false)}: abrir el documento para confirmar la inscripción.` });
  } else {
    const paso = c.fechaOficio ? `oficiada el ${fechaLegible(c.fechaOficio, false)}` : c.fechaOrdenJudicial ? `ordenada el ${fechaLegible(c.fechaOrdenJudicial, false)}` : "ordenada";
    filas.push({ tono: "curso", etiqueta: ETIQUETA_TONO.curso, tema: "Medida cautelar", texto: `${c.tipoMedida || "Medida"} ${paso}; aún sin inscripción confirmada.` });
  }

  // 3. Abandono
  const a = d.abandono || {};
  const dias = Number(a.diasRestantes);
  const juez = juezNegoAbandono(a);
  if (a.nivel === "improcedente") {
    filas.push({ tono: "favor", etiqueta: "Sin riesgo", tema: "Abandono", texto: "No corre: ya hay sentencia (Art. 247 COGEP)." });
  } else if (a.nivel === "abandonada") {
    filas.push({ tono: "riesgo", etiqueta: ETIQUETA_TONO.riesgo, tema: "Abandono", texto: "El juez declaró el abandono del proceso." });
  } else if (Number.isFinite(dias) && dias <= 0) {
    filas.push(juez
      ? { tono: "revisar", etiqueta: ETIQUETA_TONO.revisar, tema: "Abandono", texto: `${Math.abs(dias)} días sobre el plazo referencial, pero el juez ya declaró improcedente un pedido de abandono: la demora depende del juzgado.` }
      : { tono: "riesgo", etiqueta: ETIQUETA_TONO.riesgo, tema: "Abandono", texto: `${Math.abs(dias)} días sobre el plazo referencial de 6 meses sin impulso.` });
  } else if (Number.isFinite(dias) && dias <= 30) {
    filas.push({ tono: "riesgo", etiqueta: ETIQUETA_TONO.riesgo, tema: "Abandono", texto: `Quedan ${dias} días del plazo referencial de 6 meses.` });
  } else if (Number.isFinite(dias) && dias <= 60) {
    filas.push({ tono: "revisar", etiqueta: ETIQUETA_TONO.revisar, tema: "Abandono", texto: `Quedan ${dias} días del plazo referencial de 6 meses.` });
  } else if (Number.isFinite(dias)) {
    filas.push({ tono: "favor", etiqueta: "Al día", tema: "Abandono", texto: `Quedan ${dias} días del plazo referencial.` });
  } else {
    filas.push({ tono: "neutral", etiqueta: ETIQUETA_TONO.neutral, tema: "Abandono", texto: "No se pudo calcular." });
  }

  // Siguiente paso: la regla mas urgente que aplique.
  let siguientePaso: ResumenRapido["siguientePaso"];
  if (a.nivel === "abandonada") {
    siguientePaso = { texto: "Revisar con la abogada el auto que declaró el abandono y si cabe algún recurso.", promptChat: "Explícame el auto que declaró el abandono de este proceso y qué opciones hay." };
  } else if (Number.isFinite(dias) && dias <= 30 && !juez && a.nivel !== "improcedente") {
    siguientePaso = { texto: "Presentar un escrito de impulso procesal cuanto antes.", promptChat: "Redacta un borrador de escrito de impulso procesal para esta causa, con los datos del expediente." };
  } else if (posibleRespuesta) {
    siguientePaso = { texto: "Abrir el documento del Registro para confirmar si la medida quedó inscrita.", promptChat: "¿La medida cautelar está inscrita? Lee el documento de la respuesta del Registro." };
  } else if (enCitacion && !d.poseeSentencia) {
    siguientePaso = { texto: "Impulsar la citación de los demandados (escrito pidiendo insistir en la diligencia).", promptChat: "Redacta un borrador de escrito pidiendo que se insista en la citación de los demandados, con los datos de este expediente." };
  } else if (d.poseeSentencia && !enEjecucion) {
    siguientePaso = { texto: "Verificar si la sentencia está ejecutoriada y preparar la ejecución.", promptChat: "¿La sentencia de esta causa está ejecutoriada? ¿Qué sigue para ejecutarla?" };
  } else if (enEjecucion) {
    siguientePaso = { texto: "Avanzar con la ejecución (liquidación, embargo o remate según corresponda).", promptChat: "¿Qué pasos siguen en la ejecución de esta causa?" };
  } else {
    siguientePaso = { texto: "Revisar las últimas actuaciones y confirmar que el proceso avanza.", promptChat: "Resume las últimas actuaciones de esta causa y dime qué debería hacer ahora." };
  }

  return { filas, siguientePaso };
}

/** Copia de la alerta para mandar a la IA, sin el 999 interno de "no aplica". */
export function alertaParaIA(alerta: any): any {
  if (!alerta || typeof alerta !== "object") return alerta;
  const dias = Number(alerta.diasRestantes);
  if (Number.isFinite(dias) && Math.abs(dias) < 900) return alerta;
  const { diasRestantes: _d, porcentajeGauge: _p, ...resto } = alerta;
  return { ...resto, diasRestantes: "no aplica" };
}
