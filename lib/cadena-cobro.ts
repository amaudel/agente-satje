// Reglas para armar la "cadena de juicios de cobro" de una persona: de todas
// las causas que SATJE devuelve por su cedula (investigaciones previas,
// constancias, demandas de otros acreedores...), interesan solo los cobros que
// la cooperativa presento contra ella.

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

const PALABRAS_COBRO = ["COBRO", "PAGARE", "LETRA DE CAMBIO", "EJECUTIV", "MONITORIO"];

export function esAccionDeCobro(accion: string | null | undefined): boolean {
  if (!accion) return false;
  const a = normalizar(accion);
  return PALABRAS_COBRO.some((p) => a.includes(p));
}

// SATJE no entrega las partes en la lista de busqueda. En el expediente, en
// cambio, el nombre de la cooperativa aparece en las notificaciones y razones
// ("... a: COOPERATIVA DE AHORRO Y CREDITO ERCO LTDA. en el casillero ...").
// true: aparece; false: hay actuaciones y no aparece; null: no hay de donde
// juzgar (sin actuaciones).
export function esDemandanteErco(actuaciones: any[]): boolean | null {
  if (!Array.isArray(actuaciones) || actuaciones.length === 0) return null;
  const hay = actuaciones.some((a) => /\bERCO\b/.test(normalizar(`${a?.tipo ?? ""} ${a?.actividad ?? a?.nombreActuacion ?? ""}`)));
  return hay;
}
