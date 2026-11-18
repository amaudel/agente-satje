import { procesarCausaIndividual } from "./procesar-causa.js";
import { alertaParaIA } from "./resumen-rapido.js";
import { buscarEnMemoria, guardarNotaCausa, leerNotaCausa, type ConfigMemoria } from "./memoria.js";

// Timeouts de red contra el backend SATJE: sin esto una lentitud del VPS
// cuelga la funcion serverless hasta el limite de Vercel.
const TIMEOUT_RESOLUCIONES_MS = 20000;
const TIMEOUT_DOCUMENTOS_MS = 20000;
const TIMEOUT_EXTRACT_TEXT_MS = 45000;

// Herramientas (OpenAI function calling) que le dan al Chat Legal IA acceso
// bajo demanda a endpoints del backend SATJE que no vienen precargados en el
// contexto base de la causa: resoluciones, texto de documentos adjuntos, y
// consulta de otro expediente distinto al que esta en pantalla.

export const CHAT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "obtener_resoluciones",
      description:
        "Obtiene las resoluciones y sentencias registradas en SATJE para una causa. Usar cuando el usuario pregunte por resoluciones, sentencias, autos resolutivos o fallos que no aparezcan ya en las actuaciones del contexto.",
      parameters: {
        type: "object",
        properties: {
          idJuicio: {
            type: "string",
            description: "Numero de causa/proceso. Si se omite, se usa la causa actualmente en pantalla.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "leer_documento_actuacion",
      description:
        "Busca el/los documento(s) adjunto(s) (HBA) de una actuacion especifica y extrae su texto completo. Usar cuando el usuario pida leer, resumir o citar el contenido de un oficio, providencia o documento adjunto a una actuacion concreta. Para preguntas sobre datos de las partes (demandado, actor, cuantia, tipo de procedimiento), usar la actuacion tipo 'CARATULA DE JUICIO' (normalmente la primera del proceso).",
      parameters: {
        type: "object",
        properties: {
          idJuicio: {
            type: "string",
            description: "Numero de causa/proceso. Si se omite, se usa la causa actualmente en pantalla.",
          },
          codigoActuacion: {
            type: "string",
            description: "Codigo de la actuacion cuyo documento se quiere leer (campo codigoActuacion de las actuaciones).",
          },
        },
        required: ["codigoActuacion"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buscar_otra_causa",
      description:
        "Consulta un numero de causa distinto al que esta en pantalla. Usar cuando el usuario pregunte por otro expediente durante la conversacion.",
      parameters: {
        type: "object",
        properties: {
          numeroCausa: { type: "string", description: "Numero de causa/proceso a consultar." },
        },
        required: ["numeroCausa"],
      },
    },
  },
];

// Herramientas de memoria: solo se ofrecen si la memoria esta configurada.
export const CHAT_TOOLS_MEMORIA = [
  {
    type: "function" as const,
    function: {
      name: "guardar_en_memoria",
      description:
        "Guarda en la memoria permanente un hecho CONFIRMADO o una conclusion importante sobre una causa, para recordarla en futuras consultas (ej. 'La jueza nego el abandono el 2025-02-25 (actuacion 225792943)'). Usar cuando el usuario lo pida, o cuando se verifico algo relevante leyendo un documento o detectando un error. Incluir la fuente (fecha o codigo de actuacion). No guardar suposiciones, conversaciones enteras, cedulas ni datos de contacto. Avisar al usuario lo que se guardo.",
      parameters: {
        type: "object",
        properties: {
          numeroCausa: { type: "string", description: "Numero de causa. Si se omite, se usa la causa en pantalla." },
          nota: { type: "string", description: "Hecho a recordar, en una o dos frases, con su fuente." },
        },
        required: ["nota"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buscar_en_memoria",
      description:
        "Busca en la memoria permanente notas guardadas antes sobre juicios o abogados (por palabra, nombre o numero). Usar cuando el usuario pregunte que se sabe o que se reviso antes sobre algo.",
      parameters: {
        type: "object",
        properties: { texto: { type: "string", description: "Palabras a buscar." } },
        required: ["texto"],
      },
    },
  },
];

export interface ChatToolContext {
  baseUrl: string;
  apiKey: string;
  causaActual: string;
  memoria?: ConfigMemoria | null;
}

function headersConApiKey(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
}

export async function ejecutarHerramientaChat(name: string, args: any, ctx: ChatToolContext): Promise<any> {
  const { baseUrl, apiKey, causaActual } = ctx;
  const headers = headersConApiKey(apiKey);

  try {
    if (name === "obtener_resoluciones") {
      const idJuicio = args?.idJuicio || causaActual;
      if (!idJuicio) return { error: "No hay causa seleccionada." };
      const res = await fetch(`${baseUrl}/api/v1/causas/${encodeURIComponent(idJuicio)}/resoluciones?limit=20`, { headers, signal: AbortSignal.timeout(TIMEOUT_RESOLUCIONES_MS) });
      if (!res.ok) return { error: `SATJE respondio HTTP ${res.status} al pedir resoluciones.` };
      return await res.json();
    }

    if (name === "leer_documento_actuacion") {
      const idJuicio = args?.idJuicio || causaActual;
      if (!idJuicio) return { error: "No hay causa seleccionada." };
      if (!args?.codigoActuacion) return { error: "Falta el codigo de actuacion." };

      const resDocs = await fetch(
        `${baseUrl}/api/v1/causas/${encodeURIComponent(idJuicio)}/actuaciones/${encodeURIComponent(args.codigoActuacion)}/documentos`,
        { headers, signal: AbortSignal.timeout(TIMEOUT_DOCUMENTOS_MS) }
      );
      if (!resDocs.ok) return { error: `No se encontraron documentos para esa actuacion (HTTP ${resDocs.status}).` };
      const docsData: any = await resDocs.json();
      const documentos: any[] = Array.isArray(docsData?.data) ? docsData.data : [];
      if (documentos.length === 0) return { error: "La actuacion no tiene documento adjunto disponible." };

      // Una actuacion puede traer varios documentos reales (ej. un oficio y
      // su anexo). Se leen todos en vez de solo el primero para no perder
      // informacion que este en un anexo distinto del documento principal.
      const resultados = [];
      for (const doc of documentos) {
        if (!doc?.documentoId) continue;
        const resText = await fetch(`${baseUrl}/api/v1/documentos/hba/extract-text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ documentoId: doc.documentoId }),
          signal: AbortSignal.timeout(TIMEOUT_EXTRACT_TEXT_MS),
        });
        if (!resText.ok) {
          resultados.push({ nombreArchivo: doc.nombreArchivo, error: `HTTP ${resText.status}` });
          continue;
        }
        const textData: any = await resText.json();
        resultados.push({
          documentoId: doc.documentoId,
          nombreArchivo: doc.nombreArchivo,
          paginas: textData.pages,
          metodoExtraccion: textData.extractionMethod,
          texto: String(textData.text || "").slice(0, 4000),
        });
      }
      return { totalDocumentos: documentos.length, documentos: resultados };
    }

    if (name === "buscar_otra_causa") {
      if (!args?.numeroCausa) return { error: "Falta el numero de causa." };
      const resultado = await procesarCausaIndividual(args.numeroCausa, baseUrl, apiKey);
      if (resultado.backendError) {
        return { error: `No se pudo consultar SATJE para esa causa (${resultado.backendError}).` };
      }
      const memoriaPrevia = await leerNotaCausa(ctx.memoria || null, args.numeroCausa);
      return {
        causa: resultado.causa,
        ...(memoriaPrevia ? { memoriaPrevia } : {}),
        etapaProcesalGeneral: resultado.etapaProcesalGeneral,
        etapaProcesalEspecifica: resultado.etapaProcesalEspecifica,
        poseeSentencia: resultado.poseeSentencia,
        medidaCautelar: resultado.cicloVidaMedida,
        alertaAbandono: alertaParaIA(resultado.alertaAbandonoObjeto),
        totalActuaciones: resultado.totalActuaciones,
        actuaciones: resultado.actuaciones.slice(0, 20),
      };
    }

    if (name === "guardar_en_memoria") {
      const causa = args?.numeroCausa || causaActual;
      if (!causa) return { error: "No hay causa seleccionada para guardar la nota." };
      const r = await guardarNotaCausa(ctx.memoria || null, causa, args?.nota);
      return r.ok ? { guardado: true, detalle: r.mensaje } : { error: r.mensaje };
    }

    if (name === "buscar_en_memoria") {
      return await buscarEnMemoria(ctx.memoria || null, args?.texto);
    }

    return { error: "Herramienta desconocida: " + name };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
