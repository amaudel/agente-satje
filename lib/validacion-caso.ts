import {
  extraerTodasLasActuaciones,
  clasificarEtapaProcesal,
  detectorCicloVidaMedidaCautelar,
  calcularAlertaAbandonoProcesal,
  detectorSentenciaLegal,
} from "./legal-analysis.js";
import {
  compararEtapa,
  compararMedida,
  compararFecha,
  compararControlAbandono,
  type Comparacion,
} from "./validacion.js";

// Lo que la oficial anoto a mano para un juicio (sin datos personales).
export interface Esperado {
  // Posicion de la fila en la hoja de la oficial (no identifica a nadie).
  ref?: number;
  juicio: string;
  etapaGeneral?: string;
  etapa?: string;
  medida?: string;
  fechaInscripcion?: string;
  unidadDeprecada?: string;
  fechaCalifDeprecatorio?: string;
  fechaEtapa?: string;
  fechaGestion?: string;
  controlAbandono?: string;
}

export interface ResumenIncidente {
  numero: number;
  judicatura: string;
  total: number;
  primeraFecha: string | null;
  tipos: string[];
}

export interface ResultadoCaso {
  juicio: string;
  ok: boolean;
  motivo?: string;
  parcial: boolean;
  totalActuaciones: number;
  calculado: {
    etapaGeneral: string;
    etapaEspecifica: string;
    poseeSentencia: boolean;
    medidaDetectada: boolean;
    tipoMedida: string;
    fechaInscripcion: string | null;
    fechaUltimaActuacion: string;
  } | null;
  comparaciones: Record<string, Comparacion>;
  // Resumen por incidente: sirve para descubrir como se reconoce la unidad
  // deprecada y la fecha de calificacion del deprecatorio.
  incidentes: ResumenIncidente[];
  // Las ultimas actuaciones (la mas reciente primero), con su tipo y con las
  // palabras clave que aparecen en el texto. NO se guarda el texto libre, que
  // puede traer nombres de las partes.
  ultimas: UltimaActuacion[];
}

export interface UltimaActuacion {
  fecha: string | null;
  tipo: string;
  claves: string[];
}

// Vocabulario fijo para estudiar que senales marcan cada etapa procesal.
export const PALABRAS_CLAVE = [
  "archivo", "abandono", "desistimiento", "pago total", "sentencia", "ejecutoria", "apelacion",
  "mediacion", "audiencia", "citacion", "citese", "deprecatorio", "remate", "embargo", "liquidacion",
  "perito", "avaluo", "mandamiento", "insolvencia", "concurso", "inscripcion", "prohibicion",
  "oficio", "razon", "calificacion", "sorteo", "excepciones", "contestacion",
];

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function resumirUltimas(actuaciones: any[], cuantas = 8): UltimaActuacion[] {
  const ordenadas = [...actuaciones].sort((a, b) =>
    String(b?.fecha ?? b?.fechaProvidencia ?? "").localeCompare(String(a?.fecha ?? a?.fechaProvidencia ?? ""))
  );
  return ordenadas.slice(0, cuantas).map((a) => {
    const texto = sinAcentos(`${a?.tipo ?? ""} ${a?.actividad ?? a?.nombreActuacion ?? ""}`);
    return {
      fecha: soloFecha(a?.fecha ?? a?.fechaProvidencia),
      tipo: String(a?.tipo ?? "").slice(0, 70),
      claves: PALABRAS_CLAVE.filter((p) => texto.includes(p)),
    };
  });
}

function soloFecha(valor: unknown): string | null {
  const m = String(valor ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function resumirIncidentes(data: any): ResumenIncidente[] {
  const incidentes: any[] = Array.isArray(data?.incidentes) ? data.incidentes : [];
  return incidentes.map((inc, i) => {
    const acts: any[] = Array.isArray(inc?.actuaciones) ? inc.actuaciones : [];
    const ordenadas = [...acts].sort((a, b) => String(a?.fecha ?? "").localeCompare(String(b?.fecha ?? "")));
    return {
      numero: Number(inc?.incidente ?? i + 1),
      judicatura: String(inc?.nombreJudicatura ?? ""),
      total: acts.length,
      primeraFecha: soloFecha(ordenadas[0]?.fecha),
      tipos: ordenadas.slice(0, 3).map((a) => String(a?.tipo ?? "").slice(0, 60)),
    };
  });
}

export function evaluarCaso(esperado: Esperado, data: any, hoy: Date): ResultadoCaso {
  const parcial = Array.isArray(data?.partialErrors) && data.partialErrors.length > 0;
  const incidentes = resumirIncidentes(data);
  const actuaciones = extraerTodasLasActuaciones(data);

  if (!actuaciones || actuaciones.length === 0) {
    return {
      juicio: esperado.juicio,
      ok: false,
      motivo: "sin actuaciones en la respuesta",
      parcial,
      totalActuaciones: 0,
      calculado: null,
      comparaciones: {},
      incidentes,
      ultimas: [],
    };
  }

  const etapa = clasificarEtapaProcesal(actuaciones);
  const sentencia = detectorSentenciaLegal(actuaciones);
  const medida = detectorCicloVidaMedidaCautelar(actuaciones);
  const abandono = calcularAlertaAbandonoProcesal(actuaciones, sentencia.poseeSentencia);

  const calculado = {
    etapaGeneral: etapa.etapaGeneral,
    etapaEspecifica: etapa.etapaEspecifica,
    poseeSentencia: sentencia.poseeSentencia,
    medidaDetectada: medida.medidaDetectada,
    tipoMedida: medida.tipoMedida,
    fechaInscripcion: medida.fechaInscripcion,
    fechaUltimaActuacion: abandono.fechaUltimaActuacion,
  };

  return {
    juicio: esperado.juicio,
    ok: true,
    parcial,
    totalActuaciones: actuaciones.length,
    calculado,
    comparaciones: {
      etapaGeneral: compararEtapa(esperado.etapaGeneral, calculado.etapaGeneral),
      etapa: compararEtapa(esperado.etapa, calculado.etapaEspecifica),
      medida: compararMedida(esperado.medida, calculado.medidaDetectada, calculado.tipoMedida),
      fechaInscripcion: compararFecha(esperado.fechaInscripcion, calculado.fechaInscripcion),
      controlAbandono: compararControlAbandono(esperado.controlAbandono, calculado.fechaUltimaActuacion, hoy),
    },
    incidentes,
    ultimas: resumirUltimas(actuaciones),
  };
}
