import type { ClasificacionEtapa } from "./legal-analysis.js";

// Clasifica la etapa procesal por el ULTIMO HITO SUSTANTIVO del expediente.
//
// Un expediente esta lleno de actuaciones administrativas (ESCRITO, ATENDER
// PETICION, RAZON, NOTIFICACION, OFICIO...) que no cambian la etapa. Las que si
// la cambian tienen un tipo reconocible: SENTENCIA, ABANDONO POR FALTA DE
// IMPULSO, NOMBRAMIENTO DE PERITO, CITACION REALIZADA, etc. Se mira el tipo (no
// el texto libre, donde palabras como "embargo" o "perito" aparecen por mera
// mencion) y manda el hito mas reciente. Devuelve null si no hay ningun hito.

type Clave =
  | "archivo"
  | "ejecutoria"
  | "ejecucion"
  | "apelacion"
  | "sentencia"
  | "mediacion"
  | "audiencia"
  | "citacion"
  | "calificacion"
  | "sorteo";

// Si en el mismo dia hay varios hitos, gana el de mayor prioridad.
const PRIORIDAD: Record<Clave, number> = {
  archivo: 10,
  ejecutoria: 9,
  ejecucion: 8,
  apelacion: 7,
  sentencia: 6,
  mediacion: 5,
  audiencia: 5,
  citacion: 4,
  calificacion: 3,
  sorteo: 1,
};

export interface ClasificacionConFecha extends ClasificacionEtapa {
  fechaEtapa: string | null;
}

interface Hito {
  clave: Clave;
  sub: string;
  fecha: string | null;
  base: string;
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function fechaDe(a: any): string | null {
  const m = String(a?.fecha ?? a?.fechaProvidencia ?? a?.fechaActuacion ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// El tipo de SATJE a veces trae entre parentesis el nombre del citado. Se deja
// solo lo que es un subtipo conocido para no guardar nombres de personas.
export function sanitizarTipo(tipo: string): string {
  const t = String(tipo ?? "");
  const i = t.indexOf(" (");
  if (i < 0) return t;
  const resto = t.slice(i + 2);
  return /^(RAZON|AUTO|RESOLUCION|DECRETO|OFICIO|ACTA|CONSTANCIA)\b/i.test(resto) ? t : `${t.slice(0, i)} (...)`;
}

function hitoDe(tipo: string): { clave: Clave; sub: string } | null {
  const base = sinAcentos(tipo).split(" (")[0].trim();
  if (!base) return null;

  // Archivo (la subetapa se deduce del tipo)
  if (base.startsWith("ABANDONO")) return { clave: "archivo", sub: "12.3. Arch. - Por abandono" };
  if (base.startsWith("ARCHIVO POR NO COMPLETAR")) return { clave: "archivo", sub: "12.2. Arch. - Por no completar demanda" };
  if (base.startsWith("ARCHIVO POR RETIRO") || base.startsWith("INADMISION DE LA DEMANDA")) {
    return { clave: "archivo", sub: "12.1. Arch. - Inadmision / retiro de la demanda" };
  }
  if (base.startsWith("SOLUCION O PAGO") || base.startsWith("CONCLUSION DE LA EJECUCION")) {
    return { clave: "archivo", sub: "12.4. Arch. - Por pago de obligación" };
  }
  if (base.startsWith("ARCHIVO DE LA CAUSA") || base.startsWith("ENVIO DEL PROCESO AL ARCHIVO") || base.startsWith("ABSTENCION")) {
    return { clave: "archivo", sub: "12.3. Arch. - Por abandono" };
  }

  if (base.startsWith("RAZON DE EJECUTORIA") || base === "EJECUTORIA") {
    return { clave: "ejecutoria", sub: "08.1. Razon ejecutoria fecha" };
  }

  // Ejecucion
  if (base.startsWith("INCUMPLIMIENTO DE MANDAMIENTO")) return { clave: "ejecucion", sub: "10.2. Ejec. - Incumplimiento de mandamiento" };
  if (base.startsWith("MANDAMIENTO DE EJECUCION")) return { clave: "ejecucion", sub: "10.4. Ejec. - Fecha Mandamiento de Ejecución" };
  if (base.startsWith("NOMBRAMIENTO DE PERITO") || base.startsWith("ACTA SORTEO PERITO") || base.startsWith("INICIO DE EJECUCION")) {
    return { clave: "ejecucion", sub: "10.1. Ejec. - Perito liquidador" };
  }

  // Apelacion
  if (base.includes("RECURSO DE APELACION") || base.startsWith("CARATULA SALA DE CORTE")) {
    return { clave: "apelacion", sub: "09.1. Apel. - Admisión de recurso" };
  }

  if (base === "SENTENCIA") return { clave: "sentencia", sub: "07.1. Sent. - Con lugar" };

  if (base.startsWith("DERIVACION A MEDIACION")) return { clave: "mediacion", sub: "05.1. Med. - Juez deriva a mediación" };

  if (base.includes("CONVOCATORIA AUDIENCIA") || base.startsWith("AUDIENCIA PRESENCIAL")) {
    return { clave: "audiencia", sub: "06.1. Aud. - Fecha" };
  }

  // Citacion (incluye las diligencias deprecadas: la citacion se hace en otra unidad)
  if (base.includes("DEPRECATORIO") || base.includes("DEPRECAD")) return { clave: "citacion", sub: "04.3. Cita. - Deprecatorio" };
  if (base.startsWith("CITACION POR MEDIOS")) return { clave: "citacion", sub: "04.4. Cita. - Prensa" };
  if (base.startsWith("CITACION") || base.startsWith("RAZON ENVIO A CITACIONES")) {
    return { clave: "citacion", sub: "04.1. Cita. - Ofi. Citaciones" };
  }

  if (base.startsWith("CALIFICACION DE SOLICITUD") || base.startsWith("CONVALIDACION") || base.startsWith("COMPLETAR Y/O ACLARAR")) {
    return { clave: "calificacion", sub: "03.1. Calif. - Se admite a trámite" };
  }

  if (base === "ACTA DE SORTEO" || base === "CARATULA DE JUICIO") return { clave: "sorteo", sub: "02.1. Sorteo - Por presentacion de Demanda" };

  return null;
}

const GENERAL: Record<Clave, { general: string; codigo: string; explicacion: string }> = {
  archivo: { general: "12. ARCHIVADO", codigo: "12", explicacion: "El juicio se archivó (abandono, archivo, pago o inadmisión)." },
  ejecutoria: { general: "08. RAZON DE EJECUTORIA", codigo: "08", explicacion: "La sentencia quedó ejecutoriada; falta pedir el perito liquidador." },
  ejecucion: { general: "10. EJECUCION", codigo: "10", explicacion: "Fase de ejecución: perito liquidador, liquidación o mandamiento de ejecución." },
  apelacion: { general: "09. APELACIÓN", codigo: "09", explicacion: "El proceso está en segunda instancia por recurso de apelación." },
  sentencia: { general: "07. SENTENCIA", codigo: "07", explicacion: "Se dictó sentencia; aún no consta la razón de ejecutoria." },
  mediacion: { general: "05. MEDIACION", codigo: "05", explicacion: "La causa fue derivada a mediación." },
  audiencia: { general: "06. AUDIENCIA DE JUICIO", codigo: "06", explicacion: "Audiencia convocada o en desarrollo." },
  citacion: { general: "04. CITACIÓN", codigo: "04", explicacion: "Se está citando a la parte demandada." },
  calificacion: { general: "03. CALIFICACION", codigo: "03", explicacion: "La demanda fue calificada; aún no se inicia la citación." },
  sorteo: { general: "02. SORTEO", codigo: "02", explicacion: "Solo consta el sorteo de la causa." },
};

function armar(clave: Clave, sub: string, fecha: string | null): ClasificacionConFecha {
  const g = GENERAL[clave];
  return { etapaGeneral: g.general, etapaEspecifica: sub, codigoEtapa: g.codigo, explicacion: g.explicacion, fechaEtapa: fecha };
}

export function clasificarEtapaPorHitos(actuaciones: any[]): ClasificacionConFecha | null {
  if (!Array.isArray(actuaciones) || actuaciones.length === 0) return null;

  const ordenadas = [...actuaciones].sort((a, b) => (fechaDe(b) ?? "").localeCompare(fechaDe(a) ?? ""));

  const hitos: Hito[] = [];
  for (const a of ordenadas) {
    const h = hitoDe(String(a?.tipo ?? ""));
    if (h) hitos.push({ ...h, fecha: fechaDe(a), base: sinAcentos(String(a?.tipo ?? "")) });
  }
  if (hitos.length === 0) return null;

  // El archivo es terminal: despues de archivar siguen llegando devoluciones de
  // deprecatorio, razones de citacion, etc. de comisiones anteriores, y eso no
  // reabre el juicio. Solo lo reabre una ejecucion, apelacion o sentencia.
  const iArchivo = hitos.findIndex((h) => h.clave === "archivo");
  if (iArchivo > 0) {
    const eco: Clave[] = ["citacion", "calificacion", "sorteo", "audiencia", "mediacion"];
    const filtrados = hitos.filter((h, i) => i >= iArchivo || !eco.includes(h.clave));
    hitos.length = 0;
    hitos.push(...filtrados);
  }

  // Hito vigente: el mas reciente; en el mismo dia, el de mayor prioridad.
  const fechaTop = hitos[0].fecha;
  const delDia = hitos.filter((h) => h.fecha === fechaTop);
  const vigente = delDia.reduce((a, b) => (PRIORIDAD[b.clave] > PRIORIDAD[a.clave] ? b : a));

  if (vigente.clave === "ejecutoria") {
    // La razon de ejecutoria tambien se sienta al archivar: manda el hito anterior.
    const anterior = hitos.find((h) => h.clave !== "ejecutoria" && (h.fecha ?? "") <= (vigente.fecha ?? ""));
    if (anterior?.clave === "archivo") return armar("archivo", anterior.sub, vigente.fecha);
    if (anterior?.clave === "ejecucion") return armar("ejecucion", anterior.sub, anterior.fecha);
    return armar("ejecutoria", vigente.sub, vigente.fecha);
  }

  if (vigente.clave === "citacion" && vigente.sub.startsWith("04.1")) {
    // Si en todo el historial hubo deprecatorio, la citacion se hace por deprecatorio.
    if (hitos.some((h) => h.base.includes("DEPRECATORIO") || h.base.includes("DEPRECAD"))) {
      return armar("citacion", "04.3. Cita. - Deprecatorio", vigente.fecha);
    }
  }

  if (vigente.clave === "calificacion") {
    // Calificada y oficiada el mismo dia (o despues): ya se esta citando por oficio.
    const oficiado = actuaciones.some((a) => {
      const base = sinAcentos(String(a?.tipo ?? "")).split(" (")[0].trim();
      return base.startsWith("OFICIO") && (fechaDe(a) ?? "") >= (vigente.fecha ?? "9");
    });
    if (oficiado) return armar("citacion", "04.1. Cita. - Ofi. Citaciones", vigente.fecha);
  }

  return armar(vigente.clave, vigente.sub, vigente.fecha);
}
