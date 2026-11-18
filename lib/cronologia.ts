// Ayudas para la cronologia del dashboard: nombre corto del juzgado, que
// actuaciones son hitos, notas de la memoria y orden por fecha.

/** "UNIDAD JUDICIAL CIVIL CON SEDE EN EL CANTÓN MACHALA" -> "Machala"; "UNIDAD JUDICIAL CIVIL CUENCA" -> "Cuenca". */
export function juzgadoCorto(nombre: unknown): string {
  const t = String(nombre ?? "").trim();
  if (!t) return "Sin juzgado";
  const m = t.match(/CANT[OÓ]N\s+(.+)$/i) || t.match(/(?:CIVIL|PENAL|MULTICOMPETENTE|FAMILIA[^ ]*|TRABAJO|LABORAL)\s+(?:DE\s+|DEL\s+)?([A-ZÁÉÍÓÚÑ ]+)$/i);
  const lugar = (m ? m[1] : t.split(/\s+/).slice(-1)[0]).trim();
  return lugar.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

const PATRONES_HITO = [
  /calificaci[oó]n de (la )?(solicitud|demanda)/i,
  /\bsentencia\b/i,
  /ejecutori/i,
  /raz[oó]n de inscripci[oó]n/i,
  /devoluci[oó]n deprecatorio por cumplimiento/i,
  /\babandono\b/i,
  /audiencia (única|unica|preliminar|de juicio)/i,
  /citaci[oó]n:?\s*(realizada|efectiva)|se cit[oó]/i,
  /oficio a entidades/i,
  /mandamiento de ejecuci|embargo|remate/i,
];

export function esHito(a: any): boolean {
  const tipo = String(a?.tipo || "");
  const texto = `${tipo} ${String(a?.actividad || "").slice(0, 600)}`;
  // Las razones de notificacion repiten el texto del auto: no son hitos por si mismas.
  if (/RAZON DE NOTIFICACION/i.test(tipo)) return false;
  return PATRONES_HITO.some((p) => p.test(texto));
}

export function fechaDe(a: any): string {
  return String(a?.fecha || a?.fechaProvidencia || a?.fechaActuacion || "");
}

export function ordenarRecientesPrimero<T>(actuaciones: T[]): T[] {
  return [...actuaciones].sort((x: any, y: any) => (fechaDe(y) > fechaDe(x) ? 1 : fechaDe(y) < fechaDe(x) ? -1 : 0));
}

export interface NotaMemoria {
  fecha: string;
  texto: string;
}

/** Lineas "- AAAA-MM-DD: texto" de la nota del juicio, la mas reciente primero. */
export function notasDeMemoria(nota: unknown, max = 6): NotaMemoria[] {
  const salida: NotaMemoria[] = [];
  for (const linea of String(nota ?? "").split("\n")) {
    const m = linea.match(/^\s*-\s*(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
    if (m) salida.push({ fecha: m[1], texto: m[2].trim() });
  }
  return salida.reverse().slice(0, max);
}
