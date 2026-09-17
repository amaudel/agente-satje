import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import {
  CATEGORIAS_INDICADORES,
  extraerAsuntoDeCaratula,
  filtrarCandidatosReinicio,
  seleccionarJuicioVigente,
  type CausaConEstado,
} from "../lib/legal-analysis.js";
import { procesarCausaIndividual } from "../lib/procesar-causa.js";
import { generarDashboardHTML } from "../lib/dashboard-html.js";
import { upsertUpstashVector, queryUpstashVector } from "../lib/upstash.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  isAuthenticated,
  safeCompare,
  generarLoginHTML,
} from "../lib/auth.js";
import { consultarLimite, registrarFallo, limpiarLimite, ipDelCliente } from "../lib/rate-limit.js";
import { mapConcurrente } from "../lib/concurrencia.js";
import { CHAT_TOOLS, ejecutarHerramientaChat, type ChatToolContext } from "../lib/chat-tools.js";

// --- Limite de intentos fallidos de login (best-effort: ver lib/rate-limit.ts) ---
const LOGIN_VENTANA_SEGUNDOS = 300;
const LOGIN_MAX_FALLOS_POR_IP = 10;
const LOGIN_MAX_FALLOS_GLOBAL = 150;

// --- Topes de tamano, concurrencia y tiempo hacia el backend SATJE ---
const LOTE_MAX_CAUSAS = 25;
const LOTE_MAX_PERSONAS = 30;
const CONCURRENCIA_CAUSAS = 4;
const CONCURRENCIA_PERSONAS = 4;
const CONCURRENCIA_DETALLE_CAUSAS = 3;
const PRESUPUESTO_LOTE_MS = 50000;
const TIMEOUT_BUSCAR_MS = 30000;
const TIMEOUT_DOCUMENTOS_MS = 20000;
const TIMEOUT_EXTRACT_TEXT_MS = 45000;

// Presupuesto compartido por una consulta en lote: cuando se agota se dejan
// de lanzar llamadas nuevas y las filas pendientes se devuelven marcadas,
// en vez de que Vercel mate la funcion y se pierda todo el trabajo hecho.
function crearPresupuesto(msTotal: number) {
  const fin = Date.now() + msTotal;
  return {
    agotado: () => Date.now() >= fin,
    restante: () => Math.max(0, fin - Date.now()),
  };
}

// Fila equivalente a procesarCausaIndividual() pero sin consultar nada.
function resultadoNoProcesado(causa: string, motivo: string) {
  return {
    causa,
    backendError: motivo,
    etapaProcesalGeneral: null,
    etapaProcesalEspecifica: null,
    poseeSentencia: false,
    fechaSentencia: null,
    medidaDetectada: false,
    tipoMedida: null,
    estadoCicloVidaMedida: null,
    fechaInscripcionMedida: null,
    alertaAbandono: "No procesado",
    diasRestantesAbandono: null,
    totalActuaciones: 0,
    cicloVidaMedida: { medidaDetectada: false, estadoCicloVida: null } as any,
    clasificacionEtapa: { etapaGeneral: null, etapaEspecifica: null, codigoEtapa: null, explicacion: null } as any,
    alertaAbandonoObjeto: { badgeClass: "muted", nivel: "desconocido" },
    actuaciones: [] as any[],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    const authPassword = process.env.SATJE_AUTH_PASSWORD;

    const acceptHeader = req.headers["accept"] || "";
    const wantsJson = req.query.format === "json" || acceptHeader.includes("application/json");

    // 1. ENDPOINT DE AUTENTICACIÓN (LOGIN CHECK)
    if ((req.method === "POST" || req.query.action === "login") && req.body && (req.body.action === "login" || req.body.password)) {
      if (!authPassword) {
        return res.status(500).json({ ok: false, error: "SATJE_AUTH_PASSWORD no esta configurado en el servidor." });
      }

      // Limite de intentos FALLIDOS. Solo se cuentan los fallos para no
      // castigar a varios usuarios legitimos detras de una misma IP (NAT).
      const ip = ipDelCliente(req.headers as Record<string, unknown>);
      const limiteIp = consultarLimite(`login:ip:${ip}`, LOGIN_MAX_FALLOS_POR_IP, LOGIN_VENTANA_SEGUNDOS);
      const limiteGlobal = consultarLimite("login:global", LOGIN_MAX_FALLOS_GLOBAL, LOGIN_VENTANA_SEGUNDOS);
      if (!limiteIp.permitido || !limiteGlobal.permitido) {
        const espera = Math.max(limiteIp.reintentarEnSegundos, limiteGlobal.reintentarEnSegundos);
        res.setHeader("Retry-After", String(espera));
        return res.status(429).json({
          ok: false,
          error: `Demasiados intentos fallidos. Vuelve a intentar en ${espera} segundos.`,
        });
      }

      const passVal = typeof req.body.password === "string" ? req.body.password : "";
      if (passVal && safeCompare(passVal, authPassword)) {
        limpiarLimite(`login:ip:${ip}`);
        res.setHeader(
          "Set-Cookie",
          `${SESSION_COOKIE_NAME}=${createSessionToken(authPassword)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
        );
        return res.status(200).json({ ok: true, token: "authenticated" });
      }

      registrarFallo(`login:ip:${ip}`);
      registrarFallo("login:global");

      // Retardo fijo: encarece la fuerza bruta incluso si el atacante rota
      // de IP y esquiva el limitador en memoria.
      await new Promise((r) => setTimeout(r, 400));
      return res.status(401).json({ ok: false, error: "Contraseña incorrecta" });
    }

    // 1b. GATE DE AUTENTICACIÓN — nada de lo que sigue se sirve sin sesión válida
    if (!isAuthenticated(req, authPassword)) {
      if (wantsJson) {
        return res.status(401).json({ ok: false, error: "No autenticado. Envia la contraseña a POST /?action=login primero." });
      }
      return res.setHeader("Content-Type", "text/html; charset=utf-8").status(401).send(generarLoginHTML());
    }

    let bodyData: any = req.body;
    if (typeof bodyData === "string") {
      try {
        bodyData = JSON.parse(bodyData);
      } catch (e) {
        bodyData = {};
      }
    } else if (!bodyData) {
      bodyData = {};
    }

    // 2. ENDPOINT DE CHAT LEGAL DE IA
    if (req.query.action === "chat" || bodyData.action === "chat" || (req.method === "POST" && bodyData.prompt)) {
      const promptTexto = bodyData.prompt || req.query.prompt || "";
      const causaSolicitada = bodyData.causa || bodyData.causaContext?.causa || "";

      if (!promptTexto) {
        return res.status(200).json({ ok: true, respuesta: "👋 ¡Hola! Soy tu Asistente Legal. Escribe una pregunta sobre la causa o selecciona uno de los chips de acción." });
      }

      if (!openaiKey) {
        return res.status(500).json({ ok: false, error: "API Key de OpenAI no configurada." });
      }

      const chatBaseUrl = process.env.SATJE_API_BASE_URL || "https://api.asitentekairon.cloud";
      const chatApiKey = process.env.SATJE_API_KEY || "";

      // Contexto del expediente: se re-consulta fresco contra SATJE en cada
      // mensaje (en vez de confiar en el resumen chico que arma el navegador),
      // para que el chat vea las actuaciones reales, no solo 5 campos sueltos.
      let contextoExpediente: any = { causa: causaSolicitada || "Sin causa seleccionada" };
      if (causaSolicitada) {
        try {
          const resultado = await procesarCausaIndividual(causaSolicitada, chatBaseUrl, chatApiKey);
          if (resultado.backendError) {
            contextoExpediente = {
              causa: resultado.causa,
              error: `No se pudo consultar SATJE en este momento (${resultado.backendError}). Informa esto al usuario en vez de inventar datos del expediente.`,
            };
          } else {
            contextoExpediente = {
              causa: resultado.causa,
              etapaProcesalGeneral: resultado.etapaProcesalGeneral,
              etapaProcesalEspecifica: resultado.etapaProcesalEspecifica,
              poseeSentencia: resultado.poseeSentencia,
              fechaSentencia: resultado.fechaSentencia,
              medidaCautelar: resultado.cicloVidaMedida,
              alertaAbandono: resultado.alertaAbandonoObjeto,
              totalActuaciones: resultado.totalActuaciones,
              actuaciones: resultado.actuaciones.slice(0, 30),
            };
          }
        } catch (eCtx: any) {
          contextoExpediente = { causa: causaSolicitada, error: "No se pudo cargar el expediente: " + (eCtx?.message || String(eCtx)) };
        }
      }

      try {
        const openai = new OpenAI({ apiKey: openaiKey });
        const toolCtx: ChatToolContext = { baseUrl: chatBaseUrl, apiKey: chatApiKey, causaActual: causaSolicitada };

        const messages: any[] = [
          {
            role: "system",
            content: `Eres el Asistente Legal Virtual de Inteligencia Judicial para Ecuador (Agente SATJE).
Tu función es asesorar a abogados, analizar expedientes, redactar borradores de escritos procesales (como impulso procesal del Art. 245 COGEP, revocatorias o recursos) y explicar el estado del expediente en lenguaje claro o técnico.
Responde en formato Markdown bonito, con viñetas, negritas e íconos jurídicos.
Si el contexto o el resultado de una herramienta trae un campo "error", dilo claramente al usuario en vez de inventar informacion del expediente.
Tienes herramientas para consultar resoluciones, leer el texto de los documentos adjuntos a una actuación, o consultar otra causa distinta — úsalas cuando la pregunta lo requiera en vez de decir que no tienes esa información.
Si te preguntan por datos de las partes (demandado, actor, cuantía/valor de la demanda, tipo de procedimiento, asunto), usa leer_documento_actuacion sobre la actuación tipo "CARATULA DE JUICIO" (normalmente la primera actuación del proceso, revisa el listado de actuaciones del contexto para encontrar su codigoActuacion) — ahí está la ficha estructurada del caso. Si esa carátula no trae la cuantía u otro dato puntual, dilo claramente en vez de inventarlo; ese dato puede no estar digitalizado en SATJE para ese proceso.
Si te preguntan por la fecha exacta de inscripción/registro de una medida cautelar (o cualquier dato puntual del oficio/certificado registral que no venga ya resuelto en medidaCautelar.fechaInscripcion), usa leer_documento_actuacion con el codigoActuacion de medidaCautelar.fuente.codigoActuacion (si existe en el contexto) para leer el oficio o certificado real en vez de solo el resumen. Esa actuación puede traer varios documentos (el oficio y su certificado adjunto); revisa todos los que te devuelva la herramienta antes de responder.
Contexto del Expediente en Inspección (incluye actuaciones reales, hasta 30 mas recientes):
${JSON.stringify(contextoExpediente, null, 2)}`,
          },
          { role: "user", content: String(promptTexto) },
        ];

        let respuestaIa = "Sin respuesta del modelo.";
        const MAX_TURNOS_HERRAMIENTAS = 4;

        for (let turno = 0; turno < MAX_TURNOS_HERRAMIENTAS; turno++) {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools: CHAT_TOOLS,
            temperature: 0.3,
            max_tokens: 1000,
          });

          const mensaje = completion.choices[0]?.message;
          if (!mensaje) break;

          if (mensaje.tool_calls && mensaje.tool_calls.length > 0) {
            messages.push(mensaje);
            for (const toolCall of mensaje.tool_calls) {
              let args: any = {};
              try {
                args = JSON.parse(toolCall.function.arguments || "{}");
              } catch (eArgs) {}
              const resultadoHerramienta = await ejecutarHerramientaChat(toolCall.function.name, args, toolCtx);
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(resultadoHerramienta).slice(0, 8000),
              });
            }
            continue;
          }

          respuestaIa = mensaje.content || "Sin respuesta del modelo.";
          break;
        }

        return res.status(200).json({ ok: true, respuesta: respuestaIa });
      } catch (errChat: any) {
        return res.status(500).json({ ok: false, error: errChat.message || String(errChat) });
      }
    }

    // 2b. BUSCAR POSIBLE REINICIO TRAS ABANDONO PROCESAL
    // Cuando una causa fue declarada en abandono (Art. 245 COGEP), la
    // pretension no se extingue pero el proceso termina: si el actor
    // impulsa de nuevo, SATJE le asigna un numero de proceso distinto sin
    // ningun campo que lo vincule al anterior. Se busca por cedula y se
    // compara el "asunto" de la caratula contra el `accion` de cada causa
    // encontrada, filtrando por fecha de ingreso posterior al abandono.
    if (req.query.action === "buscar-reinicio" || bodyData.action === "buscar-reinicio") {
      const causaActual = String(bodyData.causaActual || req.query.causaActual || "").trim();
      const cedula = String(bodyData.cedula || "").trim();
      if (!causaActual) return res.status(400).json({ ok: false, error: "Falta causaActual." });
      if (!cedula) return res.status(400).json({ ok: false, error: "Falta la cedula a buscar." });

      const baseUrl = process.env.SATJE_API_BASE_URL || "https://api.asitentekairon.cloud";
      const apiKey = process.env.SATJE_API_KEY;
      if (!apiKey) return res.status(500).json({ ok: false, error: "SATJE_API_KEY no esta configurado en el servidor." });
      const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey };

      try {
        const resultado = await procesarCausaIndividual(causaActual, baseUrl, apiKey);
        if (resultado.backendError) {
          return res.status(502).json({ ok: false, error: `No se pudo consultar SATJE para la causa actual (${resultado.backendError}).` });
        }

        const alerta = resultado.alertaAbandonoObjeto;
        if (!alerta || alerta.nivel !== "abandonada") {
          return res.status(400).json({ ok: false, error: "Esta causa no tiene un estado de abandono declarado; el buscador de reinicio solo aplica a causas abandonadas." });
        }

        const caratula = resultado.actuaciones.find((a: any) => String(a.tipo || "").toUpperCase().includes("CARATULA DE JUICIO"));
        if (!caratula || !caratula.codigo) {
          return res.status(404).json({ ok: false, error: "No se encontro la actuacion CARATULA DE JUICIO en el expediente para determinar el asunto." });
        }

        const idJuicioActual = String(resultado.causa).replace(/\D/g, "");

        const resDocs = await fetch(`${baseUrl}/api/v1/causas/${encodeURIComponent(idJuicioActual)}/actuaciones/${encodeURIComponent(caratula.codigo)}/documentos`, { headers, signal: AbortSignal.timeout(TIMEOUT_DOCUMENTOS_MS) });
        if (!resDocs.ok) return res.status(502).json({ ok: false, error: `No se pudo obtener el documento de la caratula (HTTP ${resDocs.status}).` });
        const docsData: any = await resDocs.json();
        const documentoId = docsData?.data?.[0]?.documentoId;
        if (!documentoId) return res.status(404).json({ ok: false, error: "La caratula no tiene documento adjunto disponible." });

        const resText = await fetch(`${baseUrl}/api/v1/documentos/hba/extract-text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ documentoId }),
          signal: AbortSignal.timeout(TIMEOUT_EXTRACT_TEXT_MS),
        });
        if (!resText.ok) return res.status(502).json({ ok: false, error: `No se pudo extraer el texto de la caratula (HTTP ${resText.status}).` });
        const textData: any = await resText.json();
        const asunto = extraerAsuntoDeCaratula(textData.text);
        if (!asunto) return res.status(404).json({ ok: false, error: "No se pudo determinar el campo 'Asunto' desde la caratula de juicio." });

        const resBuscar = await fetch(`${baseUrl}/api/v1/causas/buscar`, {
          method: "POST",
          headers,
          body: JSON.stringify({ cedula, roles: ["actor", "demandado"], incluirTodasLasPaginas: true }),
          signal: AbortSignal.timeout(TIMEOUT_BUSCAR_MS),
        });
        if (!resBuscar.ok) return res.status(502).json({ ok: false, error: `No se pudo buscar causas por cedula (HTTP ${resBuscar.status}).` });
        const buscarData: any = await resBuscar.json();
        const causasCedula = Array.isArray(buscarData?.data) ? buscarData.data : [];

        const candidatos = filtrarCandidatosReinicio(causasCedula, asunto, alerta.fechaReferencialAbandono, idJuicioActual);

        return res.status(200).json({
          ok: true,
          asuntoDetectado: asunto,
          fechaAbandono: alerta.fechaReferencialAbandono,
          totalCausasCedula: causasCedula.length,
          candidatos,
        });
      } catch (errReinicio: any) {
        return res.status(500).json({ ok: false, error: errReinicio?.message || String(errReinicio) });
      }
    }

    // 2c. CONSULTA EN LOTE TIPO SUPERVISOR (por cedula, no por numero de causa)
    // Recibe una lista de personas (cedula, nombres, apellidos, numero de
    // operacion interno de la cooperativa) y para cada una busca todas sus
    // causas en SATJE, determina cual es "el ultimo juicio vigente" (excluye
    // sentenciadas y abandonadas) y arma una fila lista para exportar a Excel
    // y migrar al sistema de gestion legal.
    if (req.query.action === "lote-supervisor" || bodyData.action === "lote-supervisor") {
      const personas: any[] = Array.isArray(bodyData.personas) ? bodyData.personas : [];
      if (personas.length === 0) {
        return res.status(400).json({ ok: false, error: "No se recibieron personas para la consulta en lote." });
      }
      if (personas.length > LOTE_MAX_PERSONAS) {
        return res.status(400).json({
          ok: false,
          error: `El lote supera el maximo de ${LOTE_MAX_PERSONAS} personas por consulta (recibidas ${personas.length}). Dividelo en grupos mas pequenos.`,
        });
      }

      const baseUrl = process.env.SATJE_API_BASE_URL || "https://api.asitentekairon.cloud";
      const apiKey = process.env.SATJE_API_KEY;
      if (!apiKey) return res.status(500).json({ ok: false, error: "SATJE_API_KEY no esta configurado en el servidor." });
      const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey };

      const presupuesto = crearPresupuesto(PRESUPUESTO_LOTE_MS);
      const filas = await mapConcurrente(personas, CONCURRENCIA_PERSONAS, async (persona: any) => {
          const cedula = String(persona?.cedula || "").trim();
          const nombres = String(persona?.nombres || "").trim();
          const apellidos = String(persona?.apellidos || "").trim();
          const numeroOperacion = String(persona?.numeroOperacion || "").trim();

          const filaBase = { cedula, nombres, apellidos, numeroOperacion };

          if (!cedula) {
            return { ...filaBase, error: "Falta cedula." };
          }

          if (presupuesto.agotado()) {
            return { ...filaBase, error: "No procesado: se agoto el tiempo de la consulta en lote. Divide la lista en grupos mas pequenos." };
          }

          try {
            const resBuscar = await fetch(`${baseUrl}/api/v1/causas/buscar`, {
              method: "POST",
              headers,
              body: JSON.stringify({ cedula, roles: ["actor", "demandado"], incluirTodasLasPaginas: true }),
          signal: AbortSignal.timeout(TIMEOUT_BUSCAR_MS),
            });
            if (!resBuscar.ok) {
              return { ...filaBase, error: `No se pudo buscar causas por cedula (HTTP ${resBuscar.status}).` };
            }
            const buscarData: any = await resBuscar.json();
            const causasEncontradas: any[] = Array.isArray(buscarData?.data) ? buscarData.data : [];

            if (causasEncontradas.length === 0) {
              return { ...filaBase, totalCausasEncontradas: 0, sinCausaVigente: true };
            }

            const detalles = await mapConcurrente(
              causasEncontradas,
              CONCURRENCIA_DETALLE_CAUSAS,
              (c: any) => procesarCausaIndividual(c.numeroProceso || c.idJuicio, baseUrl, apiKey, presupuesto.restante())
            );

            const causasConEstado: CausaConEstado[] = causasEncontradas.map((c: any, idx: number) => ({
              idJuicio: c.idJuicio,
              numeroProceso: c.numeroProceso,
              fechaIngreso: c.fechaIngreso,
              poseeSentencia: !!detalles[idx]?.poseeSentencia,
              nivelAbandono: detalles[idx]?.alertaAbandonoObjeto?.nivel || "normal",
            }));

            const vigente = seleccionarJuicioVigente(causasConEstado);
            if (!vigente) {
              return { ...filaBase, totalCausasEncontradas: causasEncontradas.length, sinCausaVigente: true };
            }

            const idxVigente = causasConEstado.findIndex((c) => c.idJuicio === vigente.idJuicio);
            const detalleVigente = detalles[idxVigente];

            return {
              ...filaBase,
              totalCausasEncontradas: causasEncontradas.length,
              sinCausaVigente: false,
              numeroProceso: vigente.numeroProceso,
              etapaProcesalGeneral: detalleVigente?.etapaProcesalGeneral,
              etapaProcesalEspecifica: detalleVigente?.etapaProcesalEspecifica,
              fechaInscripcionMedidaCautelar: detalleVigente?.fechaInscripcionMedida || null,
              // Campos pedidos por el requerimiento que el agente aun no calcula:
              // no se distingue rol deudor/garante ni se extrae fecha de
              // calificacion de deprecatorio. Se exponen explicitos como no
              // disponibles en vez de omitirlos u ocultar el hueco.
              unidadJudicialDeprecadaDeudor: null,
              fechaCalificacionDeprecatorioDeu: null,
              unidadJudicialDeprecadaGarante: null,
              fechaCalificacionDeprecatorioGar: null,
              fechaDeEtapa: null,
            };
          } catch (errPersona: any) {
            return { ...filaBase, error: errPersona?.message || String(errPersona) };
          }
      });

      return res.status(200).json({ ok: true, total: filas.length, filas });
    }

    // 2d. CONSULTA DE PROCESOS POR CEDULA
    // Lista todos los procesos donde una persona es actora o demandada, con su
    // estado basico (numero, judicatura, materia, accion, fecha, estado), para
    // identificar el proceso que interesa y abrirlo con ?causa=NUMERO.
    if (req.query.action === "buscar-cedula" || bodyData.action === "buscar-cedula") {
      const cedula = String(bodyData.cedula || req.query.cedula || "").trim();
      if (!cedula) return res.status(400).json({ ok: false, error: "Falta la cedula a consultar." });
      if (!/^\d{10}$/.test(cedula)) {
        return res.status(400).json({ ok: false, error: "La cedula debe tener 10 digitos numericos." });
      }

      const baseUrl = process.env.SATJE_API_BASE_URL || "https://api.asitentekairon.cloud";
      const apiKey = process.env.SATJE_API_KEY;
      if (!apiKey) return res.status(500).json({ ok: false, error: "SATJE_API_KEY no esta configurado en el servidor." });
      const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey };

      try {
        const resBuscar = await fetch(`${baseUrl}/api/v1/causas/buscar`, {
          method: "POST",
          headers,
          body: JSON.stringify({ cedula, roles: ["actor", "demandado"], incluirTodasLasPaginas: true }),
          signal: AbortSignal.timeout(TIMEOUT_BUSCAR_MS),
        });
        if (!resBuscar.ok) {
          return res.status(502).json({ ok: false, error: `No se pudo buscar procesos por cedula (HTTP ${resBuscar.status}).` });
        }
        const buscarData: any = await resBuscar.json();
        const causasRaw = Array.isArray(buscarData?.data) ? buscarData.data : [];

        const procesos = causasRaw.map((c: any) => ({
          idJuicio: c?.idJuicio || null,
          numeroProceso: c?.numeroProceso || c?.idJuicio || null,
          judicatura: c?.judicatura || null,
          materia: c?.materia || null,
          accion: c?.accion || null,
          fechaIngreso: c?.fechaIngreso || null,
          estadoActual: c?.estadoActual || null,
          rolesEncontrados: Array.isArray(c?.rolesEncontrados) ? c.rolesEncontrados : [],
        }));

        return res.status(200).json({ ok: true, cedula, total: procesos.length, procesos });
      } catch (errCedula: any) {
        return res.status(500).json({ ok: false, error: errCedula?.message || String(errCedula) });
      }
    }

    let causasRaw = "";
    let esModoLote = false;

    if (req.query && req.query.causas) {
      causasRaw = Array.isArray(req.query.causas) ? req.query.causas.join(",") : req.query.causas;
      esModoLote = true;
    } else if (req.query && req.query.causa) {
      causasRaw = Array.isArray(req.query.causa) ? req.query.causa.join(",") : req.query.causa;
    }

    if (!causasRaw && req.body && req.body.causas) {
      causasRaw = Array.isArray(req.body.causas) ? req.body.causas.join(",") : req.body.causas;
      esModoLote = true;
    }

    if (!causasRaw) {
      if (wantsJson) {
        return res.status(200).json({
          agente: "Dashboard Agente SATJE + Upstash Vector DB RAG Engine",
          version: "7.0.0",
          estado: "activo",
          uso: "Consulta Individual: ?causa=NUMERO | Consulta en Lote: ?causas=NUM1,NUM2",
        });
      }
      return res.setHeader("Content-Type", "text/html; charset=utf-8").send(generarDashboardHTML(null));
    }

    const listaCausas = causasRaw
      .split(/[\r\n,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);

    if (listaCausas.length > LOTE_MAX_CAUSAS) {
      return res.status(400).json({
        ok: false,
        error: `El lote supera el maximo de ${LOTE_MAX_CAUSAS} causas por consulta (recibidas ${listaCausas.length}). Dividelo en lotes mas pequenos.`,
      });
    }

    const baseUrl = process.env.SATJE_API_BASE_URL || "https://api.asitentekairon.cloud";
    const apiKey = process.env.SATJE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "SATJE_API_KEY no esta configurado en el servidor." });
    }

    const upstashUrl = process.env.UPSTASH_VECTOR_REST_URL || "";
    const upstashToken = process.env.UPSTASH_VECTOR_REST_TOKEN || "";

    // MODO BATCH (CONSULTA EN LOTE - PESTAÑA 2)
    if (esModoLote || listaCausas.length > 1) {
      const presupuestoLote = crearPresupuesto(PRESUPUESTO_LOTE_MS);
      const resultadosLote = await mapConcurrente(listaCausas, CONCURRENCIA_CAUSAS, (causaItem) =>
        presupuestoLote.agotado()
          ? Promise.resolve(resultadoNoProcesado(causaItem, "No procesado: se agoto el tiempo de la consulta en lote."))
          : procesarCausaIndividual(causaItem, baseUrl, apiKey, presupuestoLote.restante())
      );

      if (wantsJson) {
        return res.status(200).json({
          ok: true,
          totalProcesos: resultadosLote.length,
          timestamp: new Date().toISOString(),
          lote: resultadosLote.map((r) => ({
            numeroProceso: r.causa,
            backendError: r.backendError,
            etapaProcesalGeneral: r.etapaProcesalGeneral,
            etapaProcesalEspecifica: r.etapaProcesalEspecifica,
            poseeSentencia: r.poseeSentencia,
            fechaSentencia: r.fechaSentencia,
            medidaDetectada: r.medidaDetectada,
            tipoMedida: r.tipoMedida,
            estadoCicloVidaMedida: r.estadoCicloVidaMedida,
            fechaInscripcionMedida: r.fechaInscripcionMedida,
            alertaAbandono: r.alertaAbandono,
            diasRestantesAbandono: r.diasRestantesAbandono,
            totalActuaciones: r.totalActuaciones,
          })),
        });
      }

      return res
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .send(generarDashboardHTML({ causa: causasRaw }, true, resultadosLote));
    }

    // MODO INDIVIDUAL (PESTAÑA 1)
    const causaInput = listaCausas[0];
    const resultadoIndividual = await procesarCausaIndividual(causaInput, baseUrl, apiKey);
    const actuaciones = resultadoIndividual.actuaciones;

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

    let resumenIA = resultadoIndividual.backendError
      ? `⚠️ No se pudo consultar la API de SATJE para la causa ${resultadoIndividual.causa} (${resultadoIndividual.backendError}). Esto es una falla de conexión, no significa que la causa esté vacía — intenta de nuevo en unos minutos.`
      : `La causa número ${resultadoIndividual.causa} no registra actuaciones en la API del SATJE en este momento.`;
    if (actuaciones.length > 0 && openaiKey) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
        const promptSistema = `Eres un agente experto en análisis jurídico procesal en Ecuador (SATJE).
Analiza las actuaciones y responde con precisión:
1. Revisa e indica la ETAPA PROCESAL GENERAL Y ESPECÍFICA según la taxonomía judicial de Ecuador.
2. Revisa e indica si existe SENTENCIA emitida en el expediente.
3. Analiza la Medida Cautelar y desglosa: Fecha de Orden Judicial, Fecha de Oficio, Fecha de Inscripción Real Registral y Estado (INSCRIPCION_CONFIRMADA, ORDENADA, LEVANTADA).
4. Evalúa el riesgo de Abandono Procesal según el Art. 245-247 del COGEP.
5. Entrega un Resumen Ejecutivo del proceso (2-3 oraciones) y la próxima acción legal sugerida.`;

        const muestraActuaciones = actuaciones.slice(0, 25);
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: promptSistema },
            {
              role: "user",
              content: `Número de Causa: ${resultadoIndividual.causa}\nTotal Actuaciones: ${actuaciones.length}\nEtapa General: ${resultadoIndividual.etapaProcesalGeneral}\nEtapa Específica: ${resultadoIndividual.etapaProcesalEspecifica}\nPosee Sentencia: ${resultadoIndividual.poseeSentencia ? "SÍ" : "NO"}\nMedida Cautelar Inscrita: ${resultadoIndividual.medidaDetectada ? "SÍ" : "NO"}\nEstado Ciclo Vida: ${resultadoIndividual.cicloVidaMedida.estadoCicloVida}\nConfianza: ${resultadoIndividual.cicloVidaMedida.confianza}\nFecha Orden Judicial: ${resultadoIndividual.cicloVidaMedida.fechaOrdenJudicial}\nFecha Oficio: ${resultadoIndividual.cicloVidaMedida.fechaOficio}\nFecha Inscripción Registral: ${resultadoIndividual.fechaInscripcionMedida}\nEstrategia Sugerida: ${resultadoIndividual.cicloVidaMedida.recomendacionEstrategica}\nEstado Alerta Abandono (COGEP): ${resultadoIndividual.alertaAbandono} (${resultadoIndividual.diasRestantesAbandono} días restantes)\n\nActuaciones recientes:\n${JSON.stringify(muestraActuaciones, null, 2)}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 900,
        });

        resumenIA = completion.choices[0]?.message?.content || "Sin respuesta del modelo.";
      } catch (errOpenAi: any) {
        resumenIA = `Error al generar resumen IA: ${errOpenAi.message || errOpenAi}`;
      }
    }

    // SINCRONIZACIÓN Y BÚSQUEDA EN UPSTASH VECTOR DB (1536-dim Embedding + RAG MEDIDAS CAUTELARES)
    let vectorDbStatus = {
      activo: false,
      precedentes: [] as any[],
      recuperacionMedidaRag: false,
    };

    if (upstashUrl && upstashToken && !resultadoIndividual.backendError) {
      vectorDbStatus.activo = true;
      const textoParaVector = `Causa: ${resultadoIndividual.causa}. Etapa: ${resultadoIndividual.etapaProcesalGeneral} - ${resultadoIndividual.etapaProcesalEspecifica}. Medida: ${resultadoIndividual.tipoMedida} (${resultadoIndividual.estadoCicloVidaMedida}). ${resumenIA.slice(0, 300)}`;

      const cautelarData = resultadoIndividual.cicloVidaMedida;
      const textoMedidaVector = `Medida Cautelar Causa: ${resultadoIndividual.causa}. Tipo: ${resultadoIndividual.tipoMedida}. Institucion: ${cautelarData.institucionEjecutora}. Estado: ${resultadoIndividual.estadoCicloVidaMedida}. Fecha Orden: ${cautelarData.fechaOrdenJudicial}. Fecha Oficio: ${cautelarData.fechaOficio}. Fecha Inscripcion: ${resultadoIndividual.fechaInscripcionMedida || 'Pendiente'}. Repertorio: ${cautelarData.numeroRepertorio || 'N/A'}. Evidencia Registral: ${cautelarData.evidenciaTextual}`;

      let vector: number[] | undefined;
      let vectorMedida: number[] | undefined;

      if (openaiKey) {
        try {
          const openai = new OpenAI({ apiKey: openaiKey });
          const embRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: textoParaVector,
          });
          vector = embRes.data[0]?.embedding;

          if (cautelarData.medidaDetectada) {
            const embMedida = await openai.embeddings.create({
              model: "text-embedding-3-small",
              input: textoMedidaVector,
            });
            vectorMedida = embMedida.data[0]?.embedding;
          }
        } catch (eEmb) {}
      }

      // 1. Buscar precedentes o causas similares en Upstash Vector
      if (vector) {
        const queryResults = await queryUpstashVector(
          upstashUrl,
          upstashToken,
          { vector },
          3
        );
        vectorDbStatus.precedentes = queryResults.filter(r => r.id !== `causa-${resultadoIndividual.causa}` && r.id !== `medida-${resultadoIndividual.causa}`);

        // Indexar la causa general en Upstash Vector
        await upsertUpstashVector(upstashUrl, upstashToken, {
          id: `causa-${resultadoIndividual.causa}`,
          vector,
          metadata: {
            causa: resultadoIndividual.causa,
            etapa: resultadoIndividual.etapaProcesalGeneral,
            medida: resultadoIndividual.estadoCicloVidaMedida,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // 2. RAG ESPECIALIZADO DE MEDIDAS CAUTELARES Y RECUPERACIÓN DE FECHA DE INSCRIPCIÓN
      if (vectorMedida && cautelarData.medidaDetectada) {
        const queryMedidas = await queryUpstashVector(
          upstashUrl,
          upstashToken,
          { vector: vectorMedida },
          3
        );

        // Si la causa actual no tiene fecha de inscripción confirmada, intentar recuperar fecha de razones similares en Upstash Vector DB
        if (!resultadoIndividual.fechaInscripcionMedida) {
          const matchRegistral = queryMedidas.find(r => r.metadata?.fechaInscripcion && r.score >= 0.78);
          if (matchRegistral && matchRegistral.metadata?.fechaInscripcion) {
            resultadoIndividual.fechaInscripcionMedida = matchRegistral.metadata.fechaInscripcion;
            cautelarData.fechaInscripcion = matchRegistral.metadata.fechaInscripcion;
            cautelarData.confianza = "ALTA";
            cautelarData.observacion += ` [Recuperado vía Upstash Vector RAG desde Causa ${matchRegistral.metadata.causa}]`;
            vectorDbStatus.recuperacionMedidaRag = true;
          }
        }

        // Indexar la Medida Cautelar dedicada en Upstash Vector DB
        await upsertUpstashVector(upstashUrl, upstashToken, {
          id: `medida-${resultadoIndividual.causa}`,
          vector: vectorMedida,
          metadata: {
            tipo: "MEDIDA_CAUTELAR",
            causa: resultadoIndividual.causa,
            tipoMedida: resultadoIndividual.tipoMedida,
            institucionEjecutora: cautelarData.institucionEjecutora,
            estadoCicloVida: resultadoIndividual.estadoCicloVidaMedida,
            fechaOrdenJudicial: cautelarData.fechaOrdenJudicial,
            fechaOficio: cautelarData.fechaOficio,
            fechaInscripcion: resultadoIndividual.fechaInscripcionMedida,
            numeroRepertorio: cautelarData.numeroRepertorio,
            evidenciaTextual: cautelarData.evidenciaTextual,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const payloadRespuesta = {
      ok: true,
      causa: resultadoIndividual.causa,
      backendError: resultadoIndividual.backendError,
      timestamp: new Date().toISOString(),
      plataforma: "Vercel Serverless Production",
      numeroProceso: resultadoIndividual.causa,
      etapaProcesalGeneral: resultadoIndividual.etapaProcesalGeneral,
      etapaProcesalEspecifica: resultadoIndividual.etapaProcesalEspecifica,
      codigoEtapaProcesal: resultadoIndividual.clasificacionEtapa.codigoEtapa,
      clasificacion_etapa: resultadoIndividual.clasificacionEtapa,
      medidaDetectada: resultadoIndividual.medidaDetectada,
      tipoMedida: resultadoIndividual.tipoMedida,
      institucionEjecutora: resultadoIndividual.cicloVidaMedida.institucionEjecutora,
      estadoCicloVida: resultadoIndividual.estadoCicloVidaMedida,
      fechaOrdenJudicial: resultadoIndividual.cicloVidaMedida.fechaOrdenJudicial,
      fechaOficio: resultadoIndividual.cicloVidaMedida.fechaOficio,
      fechaInscripcion: resultadoIndividual.fechaInscripcionMedida,
      fechaActuacionSatje: resultadoIndividual.cicloVidaMedida.fechaActuacionSatje,
      numeroInscripcion: resultadoIndividual.cicloVidaMedida.numeroInscripcion,
      numeroRepertorio: resultadoIndividual.cicloVidaMedida.numeroRepertorio,
      confianza: resultadoIndividual.cicloVidaMedida.confianza,
      evidencia: resultadoIndividual.cicloVidaMedida.evidenciaTextual,
      observacion: resultadoIndividual.cicloVidaMedida.observacion,
      recomendacionEstrategica: resultadoIndividual.cicloVidaMedida.recomendacionEstrategica,
      fuente: resultadoIndividual.cicloVidaMedida.fuente,
      ciclo_vida_medida: resultadoIndividual.cicloVidaMedida,
      analisis_dashboard: {
        posee_sentencia: resultadoIndividual.poseeSentencia,
        fecha_sentencia: resultadoIndividual.fechaSentencia,
      },
      alerta_abandono: resultadoIndividual.alertaAbandonoObjeto,
      total_actuaciones: actuaciones.length,
      resumen_ejecutivo_ia: resumenIA,
      vector_db_status: vectorDbStatus,
      resumen_indicadores: {
        medidas_cautelares_count: indicadoresEncontrados.medidas_cautelares.length,
        resoluciones_count: indicadoresEncontrados.resoluciones_sentencias.length,
        notificaciones_count: indicadoresEncontrados.notificaciones_deprecatorios.length,
        riesgo_abandono_count: indicadoresEncontrados.riesgo_abandono.length,
      },
      detalles_indicadores: indicadoresEncontrados,
      actuaciones_recientes: actuaciones.slice(0, 6),
    };

    if (wantsJson) {
      return res.status(200).json(payloadRespuesta);
    }

    return res.setHeader("Content-Type", "text/html; charset=utf-8").send(generarDashboardHTML(payloadRespuesta));

  } catch (globalErr: any) {
    return res.status(500).json({
      ok: false,
      error: "Error interno en Vercel Serverless Function",
      mensaje: globalErr?.message || String(globalErr),
    });
  }
}
