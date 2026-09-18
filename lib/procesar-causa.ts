import {
  normalizarNumeroCausa,
  extraerTodasLasActuaciones,
  clasificarEtapaProcesal,
  detectorSentenciaLegal,
  detectorCicloVidaMedidaCautelar,
  calcularAlertaAbandonoProcesal,
} from "./legal-analysis.js";

// Presupuesto de tiempo por causa. Se reserva margen frente al maxDuration de
// la funcion serverless (60s) para poder devolver una respuesta en vez de que
// Vercel mate el proceso a mitad de camino y el usuario vea un error de red.
const PRESUPUESTO_POR_CAUSA_MS = 45000;
const TIMEOUT_AGENT_MS = 30000;
// El backend consulta SATJE en vivo (via conector Apify) y puede tardar
// bastante mas que el endpoint agent/satje, que responde de cache.
const TIMEOUT_ACTUACIONES_MS = 30000;
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
  const causaSinGuiones = causaInput.replace(/\D/g, "");
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };

  const inicio = Date.now();
  const fin = inicio + Math.max(MIN_TIMEOUT_MS, Math.min(presupuestoMs, PRESUPUESTO_POR_CAUSA_MS));
  const restante = () => Math.max(0, fin - Date.now());
  const signalPara = (tope: number) =>
    AbortSignal.timeout(Math.max(MIN_TIMEOUT_MS, Math.min(tope, restante())));

  let actuaciones: any[] = [];
  const intentosBackend: { etapa: string; ok: boolean; detalle: string }[] = [];

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

  const clasificacionEtapa = clasificarEtapaProcesal(actuaciones);
  const analisisSentencia = detectorSentenciaLegal(actuaciones);
  const cicloVidaMedida = detectorCicloVidaMedidaCautelar(actuaciones);
  const alertaAbandono = calcularAlertaAbandonoProcesal(actuaciones, analisisSentencia.poseeSentencia);

  return {
    causa: causaFormateada,
    backendError,
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
