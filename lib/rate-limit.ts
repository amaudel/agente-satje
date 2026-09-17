// Limitador de intentos fallidos en memoria (best-effort).
//
// ALCANCE REAL: en Vercel cada instancia serverless tiene memoria propia y
// efimera, asi que esto NO es una garantia dura. Frena la fuerza bruta desde
// una misma IP contra una instancia caliente y encarece mucho el ataque, pero
// un atacante que rote IPs o que pegue a instancias frias puede esquivarlo.
// Para una garantia real hace falta un store compartido (Upstash Redis /
// Vercel KV). Se deja asi a proposito para no agregar infraestructura sin
// decidirlo: frente a "sin ningun limite" la mejora es grande.

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 5000;

function podar(lista: number[], corte: number): number[] {
  let i = 0;
  while (i < lista.length && lista[i] <= corte) i++;
  return i === 0 ? lista : lista.slice(i);
}

function acotarMemoria(): void {
  if (buckets.size < MAX_BUCKETS) return;
  const primera = buckets.keys().next().value;
  if (primera !== undefined) buckets.delete(primera);
}

export interface EstadoLimite {
  permitido: boolean;
  restantes: number;
  reintentarEnSegundos: number;
}

// Consulta el estado SIN registrar nada: solo se registran los fallos.
export function consultarLimite(
  clave: string,
  maximo: number,
  ventanaSegundos: number,
  ahoraMs: number = Date.now()
): EstadoLimite {
  const ventanaMs = ventanaSegundos * 1000;
  const lista = podar(buckets.get(clave) || [], ahoraMs - ventanaMs);

  if (lista.length === 0) {
    buckets.delete(clave);
    return { permitido: true, restantes: maximo, reintentarEnSegundos: 0 };
  }

  buckets.set(clave, lista);

  if (lista.length >= maximo) {
    const espera = Math.max(1, Math.ceil((lista[0] + ventanaMs - ahoraMs) / 1000));
    return { permitido: false, restantes: 0, reintentarEnSegundos: espera };
  }

  return { permitido: true, restantes: maximo - lista.length, reintentarEnSegundos: 0 };
}

export function registrarFallo(clave: string, ahoraMs: number = Date.now()): void {
  acotarMemoria();
  const lista = buckets.get(clave) || [];
  lista.push(ahoraMs);
  buckets.set(clave, lista);
}

export function limpiarLimite(clave: string): void {
  buckets.delete(clave);
}

// Solo para pruebas: deja el estado limpio entre casos.
export function _resetLimites(): void {
  buckets.clear();
}

// IP del cliente segun el proxy de Vercel.
export function ipDelCliente(headers: Record<string, unknown>): string {
  const crudo = headers["x-forwarded-for"];
  const valor = Array.isArray(crudo) ? String(crudo[0]) : String(crudo ?? "");
  const primera = valor.split(",")[0].trim();
  return primera || "desconocida";
}
