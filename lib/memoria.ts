// Cliente de la Memoria compartida de agentes (memoria-mcp en el VPS).
//
// El agente SATJE tiene su propia clave, limitada a las carpetas juicios/ y
// abogados/. La memoria es opcional: si no esta configurada o no responde,
// el chat funciona igual que antes (nunca se cae por la memoria).
//
// Variables de entorno (Vercel):
//   MEMORIA_MCP_URL  = https://memoria.asitentekairon.cloud/mcp
//   MEMORIA_API_KEY  = clave del agente "agente-satje"

const TIMEOUT_MEMORIA_MS = 6000;
export const MAX_CHARS_NOTA_EN_CONTEXTO = 6000;

export interface ConfigMemoria {
  url: string;
  clave: string;
}

export function configMemoria(env: Record<string, string | undefined> = process.env): ConfigMemoria | null {
  const url = (env.MEMORIA_MCP_URL || "").trim();
  const clave = (env.MEMORIA_API_KEY || "").trim();
  return url && clave ? { url, clave } : null;
}

/** "01333202310725" o "01333-2023-10725" -> "01333-2023-10725" (nombre de la nota). */
export function numeroCausaNormalizado(causa: string): string {
  const limpio = String(causa || "").trim().replace(/[^0-9A-Za-z-]/g, "");
  const digitos = limpio.replace(/-/g, "");
  if (/^\d{14}$/.test(digitos)) return `${digitos.slice(0, 5)}-${digitos.slice(5, 9)}-${digitos.slice(9)}`;
  return limpio.toUpperCase();
}

export function rutaNotaCausa(causa: string): string {
  const numero = numeroCausaNormalizado(causa);
  if (!/^[0-9A-Z-]{5,40}$/.test(numero)) throw new Error("Numero de causa invalido para la memoria.");
  return `juicios/${numero}.md`;
}

let siguienteId = 1;

/** Llama una herramienta del MCP de memoria. Devuelve { texto, esError }. */
export async function llamarMemoria(cfg: ConfigMemoria, herramienta: string, argumentos: Record<string, unknown>): Promise<{ texto: string; esError: boolean }> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-Key": cfg.clave },
    body: JSON.stringify({ jsonrpc: "2.0", id: siguienteId++, method: "tools/call", params: { name: herramienta, arguments: argumentos } }),
    signal: AbortSignal.timeout(TIMEOUT_MEMORIA_MS),
  });
  if (!res.ok) throw new Error(`La memoria respondio HTTP ${res.status}`);
  const data: any = await res.json();
  if (data?.error) throw new Error(String(data.error.message || "Error de la memoria"));
  const texto = (data?.result?.content || []).map((c: any) => (c?.type === "text" ? String(c.text) : "")).join("\n");
  return { texto, esError: Boolean(data?.result?.isError) };
}

function sinLineaVersion(texto: string): string {
  return texto.replace(/^<!-- version: [0-9a-f]+ -->\n?/, "");
}

/** Nota guardada de la causa, o "" si no existe / la memoria no responde. */
export async function leerNotaCausa(cfg: ConfigMemoria | null, causa: string): Promise<string> {
  if (!cfg || !causa) return "";
  try {
    const r = await llamarMemoria(cfg, "leer_nota", { ruta: rutaNotaCausa(causa) });
    if (r.esError) return "";
    const nota = sinLineaVersion(r.texto).trim();
    return nota.length > MAX_CHARS_NOTA_EN_CONTEXTO ? nota.slice(-MAX_CHARS_NOTA_EN_CONTEXTO) : nota;
  } catch {
    return "";
  }
}

function fechaHoyEcuador(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Agrega una linea fechada a la nota de la causa (la crea si no existe). */
export async function guardarNotaCausa(cfg: ConfigMemoria | null, causa: string, nota: string, ahora?: Date): Promise<{ ok: boolean; mensaje: string }> {
  if (!cfg) return { ok: false, mensaje: "La memoria no esta configurada en este servidor." };
  const texto = String(nota || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (texto.length < 5) return { ok: false, mensaje: "La nota esta vacia." };
  const ruta = rutaNotaCausa(causa);
  const linea = `- ${fechaHoyEcuador(ahora)}: ${texto}`;
  try {
    const editar = await llamarMemoria(cfg, "editar_nota", { ruta, modo: "agregar", contenido: linea });
    if (!editar.esError) return { ok: true, mensaje: `Guardado en ${ruta}` };
    if (!/No existe/i.test(editar.texto)) return { ok: false, mensaje: editar.texto };
    const crear = await llamarMemoria(cfg, "crear_nota", {
      ruta,
      contenido: `# Juicio ${numeroCausaNormalizado(causa)}\n\nNotas confirmadas por el Agente SATJE y por Andres. Lo mas reciente va al final.\n\n${linea}\n`,
    });
    return crear.esError ? { ok: false, mensaje: crear.texto } : { ok: true, mensaje: `Guardado en ${ruta}` };
  } catch (e: any) {
    return { ok: false, mensaje: `La memoria no respondio (${e?.message || e}).` };
  }
}

export async function buscarEnMemoria(cfg: ConfigMemoria | null, texto: string): Promise<any> {
  if (!cfg) return { error: "La memoria no esta configurada en este servidor." };
  try {
    const r = await llamarMemoria(cfg, "buscar_notas", { texto: String(texto || "").slice(0, 200), limite: 8 });
    return r.esError ? { error: r.texto } : { resultados: r.texto };
  } catch (e: any) {
    return { error: `La memoria no respondio (${e?.message || e}).` };
  }
}
