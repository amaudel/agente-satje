/**
 * Agrupa evidencias de medidas sin confundir oficios, notificaciones y providencias
 * con medidas independientes. Un identificador de bien/certificado es necesario
 * para distinguir dos medidas del mismo tipo. Si falta, el conteo es provisional.
 */
export interface GrupoMedida {
  clave: string;
  tipo: "PROHIBICION_ENAJENAR" | "EMBARGO" | "RETENCION";
  referencia: string | null;
  actuaciones: string[];
}
export function agruparMedidasCautelares(actuaciones: any[]): {
  grupos: GrupoMedida[];
  totalIdentificadas: number;
  esConteoExhaustivo: boolean;
  advertencia: string | null;
} {
  const grupos = new Map<string, GrupoMedida>();
  let sinIdentificador = false;
  for (const act of actuaciones) {
    const texto = String(act?.actividad || act?.nombreActuacion || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const tipoAct = String(act?.tipo || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    // Exigir una referencia expresa a una medida, no palabras sueltas como propiedad.
    let tipo: GrupoMedida["tipo"] | null =
      /PROHIBICION\s+DE\s+ENAJENAR/.test(texto) ? "PROHIBICION_ENAJENAR" :
      /\bEMBARGO\b/.test(texto) ? "EMBARGO" :
      /\bRETENCION\s+DE\s+(FONDOS|CUENTAS|VALORES)\b/.test(texto) ? "RETENCION" : null;
    if (!tipo) continue;
    // Menciones en notificaciones siguen siendo evidencia, pero no nueva medida.
    const match = texto.match(/\b(?:CERTIFICADO|PREDIO|INMUEBLE|PLACA)\s*(?:N(?:RO|UMERO)?\.?\s*|NO\.?\s*|#\s*)?([A-Z0-9][A-Z0-9.\/-]{2,})\b/);
    const ref = match ? match[1].replace(/\.$/, "") : null;
    if (!ref) sinIdentificador = true;
    const clave = tipo + ":" + (ref || "SIN_IDENTIFICADOR");
    if (!grupos.has(clave)) grupos.set(clave, { clave, tipo, referencia: ref, actuaciones: [] });
    const id = String(act?.codigoActuacion ?? act?.codigo ?? (act?.fecha || "") + ":" + tipoAct);
    if (!grupos.get(clave)!.actuaciones.includes(id)) grupos.get(clave)!.actuaciones.push(id);
  }
  return {
    grupos: [...grupos.values()],
    totalIdentificadas: grupos.size,
    esConteoExhaustivo: false,
    advertencia: grupos.size ? "Conteo mínimo de grupos documentales, no inventario jurídico exhaustivo. Verificar medidas y bienes con documentos del expediente." : "No se identificaron medidas mediante patrones explícitos. No prueba ausencia.",
  };
}
