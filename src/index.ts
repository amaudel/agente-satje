import OpenAI from "openai";
import {
  CATEGORIAS_INDICADORES,
  clasificarEtapaProcesal,
  detectorSentenciaLegal,
  detectorCicloVidaMedidaCautelar,
  calcularAlertaAbandonoProcesal,
} from "../lib/legal-analysis.js";

export interface Env {
  SATJE_API_BASE_URL?: string;
  SATJE_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Cabeceras CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
      "Content-Type": "application/json; charset=utf-8",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Ruta de estado / documentación de la API del agente
    if (url.pathname === "/" && !url.searchParams.has("causa")) {
      return new Response(
        JSON.stringify({
          agente: "Agente Consultor e Inteligente SATJE",
          version: "1.1.0",
          estado: "activo",
          endpoints_disponibles: [
            "GET /?causa=NUMERO_CAUSA (Análisis inteligente con IA + filtro de indicadores)",
            "GET /actuaciones?causa=NUMERO_CAUSA (Consulta directa de actuaciones)",
            "GET /resoluciones?causa=NUMERO_CAUSA (Filtro exclusivo de resoluciones y sentencias)",
            "GET /documentos?causa=NUMERO_CAUSA&actuacion=CODIGO (Obtener adjuntos/documentos)",
          ],
          ejemplo: "https://agente-satje.andresdelgado1984.workers.dev/?causa=01333202404697",
        }, null, 2),
        { headers: corsHeaders }
      );
    }

    // Extraer número de causa
    let numeroCausa = url.searchParams.get("causa");
    if (!numeroCausa) {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length > 0 && pathParts[0] !== "favicon.ico" && pathParts[0] !== "actuaciones") {
        numeroCausa = pathParts[pathParts.length - 1];
      }
    }

    if (!numeroCausa) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Falta el número de causa. Ejemplo de uso: /?causa=01333202404697",
        }, null, 2),
        { status: 400, headers: corsHeaders }
      );
    }

    const causaLimpia = numeroCausa.replace(/[^0-9-]/g, "");
    const baseUrl = env.SATJE_API_BASE_URL || "https://api.asitentekairon.cloud";

    const apiHeaders: Record<string, string> = {
      "Accept": "application/json",
    };
    if (env.SATJE_API_KEY) {
      apiHeaders["X-API-Key"] = env.SATJE_API_KEY;
    }

    try {
      console.log(`🔎 Agente procesando causa: ${causaLimpia} (Ruta: ${url.pathname})`);

      // ── Sub-ruta: Resoluciones ──
      if (url.pathname.includes("/resoluciones")) {
        const resUrl = `${baseUrl}/api/v1/causas/${encodeURIComponent(causaLimpia)}/resoluciones`;
        const resApi = await fetch(resUrl, { headers: apiHeaders });
        const dataRes = await resApi.json();
        return new Response(JSON.stringify(dataRes, null, 2), { headers: corsHeaders });
      }

      // ── Sub-ruta: Documentos de Actuación ──
      if (url.pathname.includes("/documentos")) {
        const codigoActuacion = url.searchParams.get("actuacion");
        if (!codigoActuacion) {
          return new Response(
            JSON.stringify({ error: "Debes proveer el parámetro &actuacion=CODIGO_ACTUACION" }),
            { status: 400, headers: corsHeaders }
          );
        }
        const docUrl = `${baseUrl}/api/v1/causas/${encodeURIComponent(causaLimpia)}/actuaciones/${encodeURIComponent(codigoActuacion)}/documentos`;
        const docApi = await fetch(docUrl, { headers: apiHeaders });
        const dataDoc = await docApi.json();
        return new Response(JSON.stringify(dataDoc, null, 2), { headers: corsHeaders });
      }

      // ── Consulta Principal: Actuaciones y Análisis con IA ──
      const apiUrl = `${baseUrl}/api/v1/causas/${encodeURIComponent(causaLimpia)}/actuaciones`;
      const responseApi = await fetch(apiUrl, { headers: apiHeaders });

      if (!responseApi.ok) {
        const errorText = await responseApi.text();
        return new Response(
          JSON.stringify({
            ok: false,
            causa: causaLimpia,
            error: `API SATJE devolvió status ${responseApi.status}`,
            detalle: errorText,
          }, null, 2),
          { status: responseApi.status, headers: corsHeaders }
        );
      }

      const datosSatje: any = await responseApi.json();

      let actuaciones: any[] = [];
      if (Array.isArray(datosSatje)) {
        actuaciones = datosSatje;
      } else if (datosSatje.actuaciones && Array.isArray(datosSatje.actuaciones)) {
        actuaciones = datosSatje.actuaciones;
      } else if (datosSatje.data && Array.isArray(datosSatje.data)) {
        actuaciones = datosSatje.data;
      }

      // Clasificación de indicadores clave
      const indicadoresEncontrados: Record<string, any[]> = {
        medidas_cautelares: [],
        resoluciones_sentencias: [],
        notificaciones_deprecatorios: [],
        riesgo_abandono: [],
      };

      for (const act of actuaciones) {
        const textoStr = JSON.stringify(act).toLowerCase();

        for (const [categoria, palabras] of Object.entries(CATEGORIAS_INDICADORES)) {
          if (palabras.some((p) => textoStr.includes(p))) {
            indicadoresEncontrados[categoria].push(act);
          }
        }
      }

      // Analisis legal compartido con el agente de Vercel (lib/legal-analysis.ts):
      // etapa procesal, sentencia, ciclo de vida de medida cautelar y alerta de abandono.
      const analisisSentencia = detectorSentenciaLegal(actuaciones);
      const clasificacionEtapa = clasificarEtapaProcesal(actuaciones);
      const cicloVidaMedida = detectorCicloVidaMedidaCautelar(actuaciones);
      const alertaAbandono = calcularAlertaAbandonoProcesal(actuaciones, analisisSentencia.poseeSentencia);

      // Análisis y Resumen con OpenAI
      let resumenIA = "Llave OPENAI_API_KEY no configurada aún. Configúrala con 'npx wrangler secret put OPENAI_API_KEY'.";

      if (env.OPENAI_API_KEY) {
        try {
          const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

          const promptSistema = `Eres un agente de inteligencia artificial experto en análisis jurídico procesal en Ecuador (SATJE).
Tu tarea es leer las actuaciones de un proceso judicial y generar un reporte sintético y preciso para abogados o ciudadanos.

Formato requerido del reporte:
1. 📌 **Resumen General**: Estado actual de la causa en 2-3 oraciones.
2. ⚠️ **Alertas e Indicadores**: Medidas cautelares, embargos, prohibición de enajenar o riesgos detectados.
3. 🗓️ **Últimas Providencias Relevantes**: Resumen de lo más reciente.
4. 💡 **Próxima Acción Sugerida**: Qué debería vigilar el abogado a continuación.`;

          const muestraActuaciones = actuaciones.slice(0, 25);

          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: promptSistema },
              {
                role: "user",
                content: `Número de Causa: ${causaLimpia}\nTotal Actuaciones: ${actuaciones.length}\n\nActuaciones recientes:\n${JSON.stringify(muestraActuaciones, null, 2)}`,
              },
            ],
            temperature: 0.2,
            max_tokens: 900,
          });

          resumenIA = completion.choices[0]?.message?.content || "Sin respuesta del modelo.";
        } catch (errOpenAi: any) {
          console.error("Error al consultar OpenAI:", errOpenAi);
          resumenIA = `Error al generar resumen IA: ${errOpenAi.message || errOpenAi}`;
        }
      }

      const respuestaFinal = {
        ok: true,
        causa: causaLimpia,
        timestamp: new Date().toISOString(),
        total_actuaciones: actuaciones.length,
        etapa_procesal_general: clasificacionEtapa.etapaGeneral,
        etapa_procesal_especifica: clasificacionEtapa.etapaEspecifica,
        clasificacion_etapa: clasificacionEtapa,
        posee_sentencia: analisisSentencia.poseeSentencia,
        fecha_sentencia: analisisSentencia.fechaSentencia,
        ciclo_vida_medida: cicloVidaMedida,
        alerta_abandono: alertaAbandono,
        resumen_ejecutivo_ia: resumenIA,
        resumen_indicadores: {
          medidas_cautelares_count: indicadoresEncontrados.medidas_cautelares.length,
          resoluciones_count: indicadoresEncontrados.resoluciones_sentencias.length,
          notificaciones_count: indicadoresEncontrados.notificaciones_deprecatorios.length,
          riesgo_abandono_count: indicadoresEncontrados.riesgo_abandono.length,
        },
        detalles_indicadores: indicadoresEncontrados,
        actuaciones_recientes: actuaciones.slice(0, 5),
      };

      return new Response(JSON.stringify(respuestaFinal, null, 2), { headers: corsHeaders });
    } catch (error: any) {
      console.error("Error en la ejecución del Worker:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          causa: causaLimpia,
          error: "Error interno al procesar la causa",
          mensaje: error.message || String(error),
        }, null, 2),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
