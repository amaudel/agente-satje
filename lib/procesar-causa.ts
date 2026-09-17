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
  console.log(
    `[satje] inicio causa=${causaFormateada} baseUrl=${baseUrl} presupuesto=${Math.max(MIN_TIMEOUT_MS, Math.min(presupuestoMs, PRESUPUESTO_POR_CAUSA_MS))}ms`
  );

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
        console.log(`[satje] ${etapa} HTTP ${res.status} (no ok)`);
        intentosBackend.push({ etapa, ok: false, detalle: `HTTP ${res.status}` });
        return null;
      }
      const datos: any = await res.json();
      const extraidas = extraerTodasLasActuaciones(datos);
      // Diagnostico: solo la FORMA de la respuesta, nunca su contenido.
      const forma = Array.isArray(datos)
        ? `array(${datos.length})`
        : `objeto{${Object.keys(datos || {}).slice(0, 12).join(",")}}`;
      console.log(`[satje] ${etapa} HTTP ${res.status} forma=${forma} extraidas=${extraidas.length}`);
      intentosBackend.push({ etapa, ok: true, detalle: `HTTP ${res.status}` });
      return extraidas;
    } catch (e: any) {
      const motivo =
        e?.name === "TimeoutError"
          ? `timeout tras ${topeEfectivo} ms`
          : e?.message || String(e);
      console.log(`[satje] ${etapa} ERROR ${motivo}`);
      intentosBackend.push({ etapa, ok: false, detalle: motivo });
      return null;
    }
  }

  const rAgent = await intentar(
    "agent/satje",
    `${baseUrl}/api/v1/agent/satje`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: causaFormateada,
        tipoBusqueda: "auto",
        incluirActuaciones: true,
        maxActuaciones: 20,
      }),
    },
    TIMEOUT_AGENT_MS
  );
  if (rAgent) actuaciones = rAgent;

  if (actuaciones.length === 0) {
    const r1 = await intentar(
      "causas/actuaciones",
      `${baseUrl}/api/v1/causas/${encodeURIComponent(causaFormateada)}/actuaciones`,
      { headers },
      TIMEOUT_ACTUACIONES_MS
    );
    if (r1) actuaciones = r1;
  }

  if (actuaciones.length === 0 && causaSinGuiones) {
    const r2 = await intentar(
      "causas/actuaciones (sin guiones)",
      `${baseUrl}/api/v1/causas/${encodeURIComponent(causaSinGuiones)}/actuaciones`,
      { headers },
      TIMEOUT_ACTUACIONES_MS
    );
    if (r2) actuaciones = r2;
  }

  // Si no hubo actuaciones Y ningun intento llego a responder con exito, es una
  // falla real de conexion/backend — no una causa genuinamente vacia. Distinguir
  // ambos casos evita que un timeout o bloqueo de red se muestre como "sin actuaciones".
  const backendError =
    actuaciones.length === 0 && intentosBackend.length > 0 && intentosBackend.every((i) => !i.ok)
      ? intentosBackend.map((i) => `${i.etapa}: ${i.detalle}`).join(" | ")
      : null;

  console.log(
    `[satje] fin causa=${causaFormateada} actuaciones=${actuaciones.length} backendError=${backendError ? "SI" : "no"} intentos=${JSON.stringify(intentosBackend)}`
  );

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
