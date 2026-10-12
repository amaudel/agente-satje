import {
  normalizarNumeroCausa,
  sinSeparadoresCausa,
  extraerTodasLasActuaciones,
  clasificarEtapaProcesal,
  detectorSentenciaLegal,
  detectorCicloVidaMedidaCautelar,
  calcularAlertaAbandonoProcesal,
} from "./legal-analysis.js";
import { verificarIdentidadDeprecatorio } from "./deprecatorios-identidad.js";
import { verificarDocumentosDeprecatorio } from "./deprecatorios-documentos.js";

// Presupuesto de tiempo por causa. Se reserva margen frente al maxDuration de
// la funcion serverless (60s) para poder devolver una respuesta en vez de que
// Vercel mate el proceso a mitad de camino y el usuario vea un error de red.
const PRESUPUESTO_POR_CAUSA_MS = 45000;
const TIMEOUT_AGENT_MS = 30000;
// El backend consulta SATJE en vivo (via conector Apify) y puede tardar
// bastante mas que el endpoint agent/satje, que responde de cache.
// El backend consulta SATJE en vivo (via conector) y una consulta FRIA puede
// tardar ~20 s (medido). Su peor caso, con sus 20 s de timeout y 2 reintentos
// con 1 s de espera, ronda los 41 s. 45 s deja margen sin pasar del
// maxDuration de 60 s de la funcion (el resto del render es ~1,5 s).
const TIMEOUT_ACTUACIONES_MS = 45000;
const MIN_TIMEOUT_MS = 2000;

// A partir de aqui la consulta se considera lenta y se registra su duracion
// y por que via se resolvio (o por que fallo).
const UMBRAL_LOG_MS = 8000;

export async function procesarCausaIndividual(
  causaInput: string,
  baseUrl: string,
  apiKey: string,
  presupuestoMs: number = PRESUPUESTO_POR_CAUSA_MS
) {
  const causaFormateada = normalizarNumeroCausa(causaInput);
  const causaSinGuiones = sinSeparadoresCausa(causaInput);
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };

  // El backend especializado separa proceso principal y unidad deprecada.
  // Se inicia en paralelo para no extender el presupuesto de la consulta.
  const riesgoEspecializadoPromise = (async (): Promise<any | null> => {
    if (!causaSinGuiones) return null;
    try {
      const res = await fetch(
        `${baseUrl}/api/v1/causas/${encodeURIComponent(causaSinGuiones)}/abandono/riesgo`,
        { headers, signal: AbortSignal.timeout(30000) }
      );
      if (!res.ok) return null;
      const data: any = await res.json();
      return data?.success === true && data?.analysisStatus === "COMPLETE" && data?.partial === false
        ? data : null;
    } catch { return null; }
  })();

  const inicio = Date.now();
  const fin = inicio + Math.max(MIN_TIMEOUT_MS, Math.min(presupuestoMs, PRESUPUESTO_POR_CAUSA_MS));
  const restante = () => Math.max(0, fin - Date.now());
  const signalPara = (tope: number) =>
    AbortSignal.timeout(Math.max(MIN_TIMEOUT_MS, Math.min(tope, restante())));

  let actuaciones: any[] = [];
  const intentosBackend: { etapa: string; ok: boolean; detalle: string }[] = [];
  // Errores parciales que el backend declara aunque responda 200 (p. ej. SATJE
  // se agoto de tiempo en un incidente): sin ellos faltan actuaciones.
  const erroresParciales: { code: string; stage?: string; retryable?: boolean }[] = [];

  // Cada intento queda acotado por el timeout del paso Y por el presupuesto
  // total de la causa: nunca puede colgarse indefinidamente.
  async function intentar(
    etapa: string,
    url: string,
    opciones: RequestInit,
    topeMs: number
  ): Promise<any[] | null> {
    if (restante() <= MIN_TIMEOUT_MS) {
      intentosBackend.push({ etapa, ok: false, detalle: "presupuesto de tiempo agotado antes de la llamada" });
      return null;
    }
    const topeEfectivo = Math.max(MIN_TIMEOUT_MS, Math.min(topeMs, restante()));
    try {
      const res = await fetch(url, { ...opciones, signal: signalPara(topeMs) });
      if (!res.ok) {
        intentosBackend.push({ etapa, ok: false, detalle: `HTTP ${res.status}` });
        return null;
      }
      const datos: any = await res.json();
      for (const e of Array.isArray(datos?.partialErrors) ? datos.partialErrors : []) {
        const code = String(e?.code ?? "ERROR_PARCIAL");
        if (!erroresParciales.some((x) => x.code === code && x.stage === e?.stage)) {
          erroresParciales.push({ code, stage: e?.stage, retryable: e?.retryable });
        }
      }
      const extraidas = extraerTodasLasActuaciones(datos);
      intentosBackend.push({ etapa, ok: true, detalle: `HTTP ${res.status}` });
      return extraidas;
    } catch (e: any) {
      const motivo =
        e?.name === "TimeoutError"
          ? `timeout tras ${topeEfectivo} ms`
          : e?.message || String(e);
      intentosBackend.push({ etapa, ok: false, detalle: motivo });
      return null;
    }
  }

  // ORDEN: primero /causas/{id}/actuaciones, que devuelve el expediente
  // COMPLETO (128 actuaciones frente a las 20 del agente) y ademas deja el
  // resultado en la cache del backend, lo que abarata las llamadas
  // siguientes. agent/satje queda como respaldo: solo devuelve un resumen,
  // que el extractor no reconoce (daba extraidas=0).
  // Ojo: este endpoint espera el id SIN guiones; con guiones da 404.
  if (causaSinGuiones) {
    const rAct = await intentar(
      "causas/actuaciones",
      `${baseUrl}/api/v1/causas/${encodeURIComponent(causaSinGuiones)}/actuaciones`,
      { headers },
      TIMEOUT_ACTUACIONES_MS
    );
    if (rAct) actuaciones = rAct;
  }

  if (actuaciones.length === 0) {
    const rAgent = await intentar(
      "agent/satje",
      `${baseUrl}/api/v1/agent/satje`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          // El backend no sabe interpretar "01333-2025-08870": su deteccion
          // automatica exige grupos de 11+ digitos y los guiones los parten,
          // asi que devolvia 422 en TODAS las consultas. Se envia el numero
          // sin guiones y con tipoBusqueda explicito.
          query: causaSinGuiones || causaFormateada,
          tipoBusqueda: "proceso",
          incluirActuaciones: true,
          maxActuaciones: 20,
        }),
      },
      TIMEOUT_AGENT_MS
    );
    if (rAgent) actuaciones = rAgent;
  }

  if (actuaciones.length === 0 && causaFormateada !== causaSinGuiones) {
    const rDashed = await intentar(
      "causas/actuaciones (con guiones)",
      `${baseUrl}/api/v1/causas/${encodeURIComponent(causaFormateada)}/actuaciones`,
      { headers },
      TIMEOUT_ACTUACIONES_MS
    );
    if (rDashed) actuaciones = rDashed;
  }

  // Si no hubo actuaciones Y ningun intento llego a responder con exito, es una
  // falla real de conexion/backend — no una causa genuinamente vacia. Distinguir
  // ambos casos evita que un timeout o bloqueo de red se muestre como "sin actuaciones".
  const backendError =
    actuaciones.length === 0 && intentosBackend.length > 0 && intentosBackend.every((i) => !i.ok)
      ? intentosBackend.map((i) => `${i.etapa}: ${i.detalle}`).join(" | ")
      : null;

  // Se registra solo si hubo fallo o si la consulta fue lenta: es la
  // informacion util para vigilar el rendimiento, sin ensuciar los logs
  // en el uso normal.
  const duracionMs = Date.now() - inicio;
  if (backendError || duracionMs > UMBRAL_LOG_MS) {
    const via = intentosBackend.filter((i) => i.ok).map((i) => i.etapa).join(" + ") || "ninguna";
    console.error(
      `[satje] causa=${causaFormateada} ${duracionMs}ms actuaciones=${actuaciones.length} via=${via}${backendError ? " FALLO " + backendError : ""}`
    );
  }

  // Fecha de ingreso: la de la primera actuacion del expediente (la caratula).
  let fechaIngreso: string | null = null;
  for (const a of actuaciones) {
    const m = String(a?.fecha ?? a?.fechaProvidencia ?? a?.fechaActuacion ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
    if (m && (fechaIngreso === null || m[1] < fechaIngreso)) fechaIngreso = m[1];
  }

  const clasificacionEtapa = clasificarEtapaProcesal(actuaciones);
  const analisisSentencia = detectorSentenciaLegal(actuaciones);
  const cicloVidaMedida = detectorCicloVidaMedidaCautelar(actuaciones);
  const alertaLocal = calcularAlertaAbandonoProcesal(actuaciones, analisisSentencia.poseeSentencia);
  const riesgo = await riesgoEspecializadoPromise;
  let alertaAbandono = alertaLocal;
  if (riesgo?.alertaGeneral && riesgo?.relojProcesoPrincipal) {
    const principal = riesgo.relojProcesoPrincipal;
    const deprecada = riesgo.relojUnidadDeprecada;
    const general = riesgo.alertaGeneral;
    const verificacion = deprecada ? verificarIdentidadDeprecatorio(actuaciones, String(deprecada?.ultimaActuacion?.actividadResumen || "")) : null;
    const discrepancia = verificacion?.estado === "DISCREPANCIA";
    const evidenciaDoc = discrepancia && deprecada?.ultimaActuacion?.codigo
      ? await verificarDocumentosDeprecatorio({
          baseUrl, causa: causaSinGuiones, codigo: String(deprecada.ultimaActuacion.codigo),
          cabeceras: headers, actorOrigen: actuaciones.filter((a:any)=>String(a?.nombreJudicatura||"").includes("CUENCA")).map((a:any)=>String(a?.actividad||"")).join(" "),
          textoActuacion: String(deprecada.ultimaActuacion.actividadResumen||""), maxMs: 4000,
        }) : null;
    const avisoDoc = evidenciaDoc?.estado === "DISCREPANCIA_DOCUMENTAL"
      ? "Discrepancia confirmada en el texto del PDF de SATJE; no determina nulidad del deprecatorio."
      : evidenciaDoc?.estado === "COINCIDENCIA_DOCUMENTAL"
      ? "Documento del oficio cotejado: coincide la parte actora y el número de causa, sin acreditar por sí solo la validez."
      : evidenciaDoc?.estado === "DOCUMENTO_INACCESIBLE"
      ? "PDF del deprecatorio inaccesible o extracción incompleta; no hay verificación documental concluyente."
      : discrepancia ? "No se obtuvo evidencia suficiente para aclarar la discrepancia de partes." : "";
    const determinante = general.ambitoMasCercano === "unidad_deprecada" ? deprecada : principal;
    const dias = Number(general.diasRestantes);
    const vencido = dias <= 0;
    if (Number.isFinite(dias)) {
      alertaAbandono = {
        ...alertaLocal,
        nivel: vencido ? "vencido" : dias <= 30 ? "critico" : dias <= 60 ? "alerta" : "normal",
        etiqueta: vencido ? "🟣 VENCIDO (Alerta preventiva)" : dias <= 30 ? "🔴 Riesgo crítico" : "🟡 Vigilancia preventiva",
        diasRestantes: dias,
        porcentajeGauge: Math.max(0, Math.min(100, Math.round(dias / 180 * 100))),
        fechaUltimaActuacion: String(determinante?.ultimaActuacion?.fecha || "N/A"),
        fechaReferencialAbandono: String(general.fechaReferencialAbandono || "N/A"),
        esDeprecatorio: Boolean(deprecada),
        relojDeprecatorioInfo: deprecada
          ? `Fuente API SATJE (dos relojes): principal ${principal?.ultimaActuacion?.fecha || "N/A"}; deprecado ${deprecada?.ultimaActuacion?.fecha || "N/A"}; determinante ${general.ambitoMasCercano}. ${discrepancia ? `⚠️ Deprecatorio con identidad procesal por verificar: el oficio menciona distinta parte actora. ${avisoDoc} No usar este reloj para conclusiones jurídicas definitivas sin validar su efecto procesal.` : ""}`
          : undefined,
        explicacion: discrepancia ? `⚠️ Deprecatorio con identidad procesal por verificar. Indicador preventivo: las partes del deprecatorio presentan discordancias. ${avisoDoc} El efecto procesal debe evaluarse por separado.` : "Indicador preventivo especializado, no declaratoria jurídica de abandono. Verificar expediente.",
      };
    }
  } else if (alertaLocal.nivel !== "abandonada" && alertaLocal.nivel !== "improcedente") {
    alertaAbandono = {
      ...alertaLocal,
      etiqueta: "⚠️ Cálculo local provisional (API especializada no disponible)",
      explicacion: "No fue posible verificar ambos relojes de abandono con la API especializada. Los días del cálculo local NO deben usarse para decidir actuaciones judiciales.",
    };
  }

  return {
    causa: causaFormateada,
    backendError,
    fechaIngreso,
    datosIncompletos: erroresParciales.length > 0,
    erroresParciales,
    etapaProcesalGeneral: clasificacionEtapa.etapaGeneral,
    etapaProcesalEspecifica: clasificacionEtapa.etapaEspecifica,
    poseeSentencia: analisisSentencia.poseeSentencia,
    fechaSentencia: analisisSentencia.fechaSentencia,
    medidaDetectada: cicloVidaMedida.medidaDetectada,
    tipoMedida: cicloVidaMedida.tipoMedida,
    estadoCicloVidaMedida: cicloVidaMedida.estadoCicloVida,
    fechaInscripcionMedida: cicloVidaMedida.fechaInscripcion,
    alertaAbandono: alertaAbandono.etiqueta,
    diasRestantesAbandono: alertaAbandono.diasRestantes,
    totalActuaciones: actuaciones.length,
    cicloVidaMedida,
    clasificacionEtapa,
    alertaAbandonoObjeto: alertaAbandono,
    actuaciones,
  };
}
