import {
  normalizarNumeroCausa,
  extraerTodasLasActuaciones,
  clasificarEtapaProcesal,
  detectorSentenciaLegal,
  detectorCicloVidaMedidaCautelar,
  calcularAlertaAbandonoProcesal,
} from "./legal-analysis.js";

export async function procesarCausaIndividual(causaInput: string, baseUrl: string, apiKey: string) {
  const causaFormateada = normalizarNumeroCausa(causaInput);
  const causaSinGuiones = causaInput.replace(/\D/g, "");
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };

  let actuaciones: any[] = [];
  const intentosBackend: { etapa: string; ok: boolean; detalle: string }[] = [];

  try {
    const resAgent = await fetch(`${baseUrl}/api/v1/agent/satje`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: causaFormateada,
        tipoBusqueda: "auto",
        incluirActuaciones: true,
        maxActuaciones: 40,
      }),
    });
    intentosBackend.push({ etapa: "agent/satje", ok: resAgent.ok, detalle: `HTTP ${resAgent.status}` });
    if (resAgent.ok) {
      const dAgent: any = await resAgent.json();
      actuaciones = extraerTodasLasActuaciones(dAgent);
    }
  } catch (e: any) {
    intentosBackend.push({ etapa: "agent/satje", ok: false, detalle: e?.message || String(e) });
  }

  if (actuaciones.length === 0) {
    try {
      const res1 = await fetch(`${baseUrl}/api/v1/causas/${encodeURIComponent(causaFormateada)}/actuaciones`, { headers });
      intentosBackend.push({ etapa: "causas/actuaciones", ok: res1.ok, detalle: `HTTP ${res1.status}` });
      if (res1.ok) {
        const d1: any = await res1.json();
        actuaciones = extraerTodasLasActuaciones(d1);
      }
    } catch (e: any) {
      intentosBackend.push({ etapa: "causas/actuaciones", ok: false, detalle: e?.message || String(e) });
    }
  }

  if (actuaciones.length === 0 && causaSinGuiones) {
    try {
      const res2 = await fetch(`${baseUrl}/api/v1/causas/${encodeURIComponent(causaSinGuiones)}/actuaciones`, { headers });
      intentosBackend.push({ etapa: "causas/actuaciones (sin guiones)", ok: res2.ok, detalle: `HTTP ${res2.status}` });
      if (res2.ok) {
        const d2: any = await res2.json();
        actuaciones = extraerTodasLasActuaciones(d2);
      }
    } catch (e: any) {
      intentosBackend.push({ etapa: "causas/actuaciones (sin guiones)", ok: false, detalle: e?.message || String(e) });
    }
  }

  // Si no hubo actuaciones Y ningun intento llego a responder con exito, es una
  // falla real de conexion/backend — no una causa genuinamente vacia. Distinguir
  // ambos casos evita que un timeout o bloqueo de red se muestre como "sin actuaciones".
  const backendError =
    actuaciones.length === 0 && intentosBackend.length > 0 && intentosBackend.every((i) => !i.ok)
      ? intentosBackend.map((i) => `${i.etapa}: ${i.detalle}`).join(" | ")
      : null;

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
