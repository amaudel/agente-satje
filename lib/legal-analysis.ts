// Motor de clasificacion legal para causas SATJE: etapa procesal, sentencia,
// ciclo de vida de medidas cautelares y alerta de abandono procesal (COGEP).
// Funciones puras sobre `actuaciones` — sin I/O, sin fetch — para poder
// probarlas de forma aislada.

export const CATEGORIAS_INDICADORES = {
  medidas_cautelares: [
    "medida cautelar",
    "embargo",
    "prohibicion de enajenar",
    "prohibición de enajenar",
    "retencion",
    "retención",
    "secuestro",
    "inscripcion",
    "inscripción",
    "registro de la propiedad",
    "mercantil",
  ],
  resoluciones_sentencias: [
    "sentencia",
    "resolucion",
    "resolución",
    "auto de pago",
    "auto resolutivo",
    "fallo",
    "dictamen",
  ],
  notificaciones_deprecatorios: [
    "deprecatorio",
    "exhorto",
    "notificacion",
    "notificación",
    "citacion",
    "citación",
  ],
  riesgo_abandono: [
    "abandono",
    "inactividad",
    "archivo",
    "prescripcion",
    "prescripción",
  ],
};

export function normalizarNumeroCausa(raw: string): string {
  const soloNumeros = raw.replace(/\D/g, "");
  if (soloNumeros.length >= 13 && soloNumeros.length <= 16) {
    const parte1 = soloNumeros.slice(0, 5);
    const parte2 = soloNumeros.slice(5, 9);
    const parte3 = soloNumeros.slice(9);
    return `${parte1}-${parte2}-${parte3}`;
  }
  return raw.trim();
}

export function extraerTodasLasActuaciones(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  const result: any[] = [];

  if (Array.isArray(data.incidentes)) {
    for (const inc of data.incidentes) {
      if (Array.isArray(inc.actuaciones)) {
        for (const act of inc.actuaciones) {
          result.push({
            ...act,
            nombreJudicatura: inc.nombreJudicatura || data.judicatura || "",
          });
        }
      }
    }
  }

  if (result.length > 0) return result;

  if (Array.isArray(data.actuaciones)) return data.actuaciones;
  if (Array.isArray(data.data)) return data.data;

  if (Array.isArray(data.juicios)) {
    for (const j of data.juicios) {
      const sub = extraerTodasLasActuaciones(j);
      result.push(...sub);
    }
  }

  return result;
}

export function detectorSentenciaLegal(actuaciones: any[]): { poseeSentencia: boolean; fechaSentencia: string | null } {
  for (const act of actuaciones) {
    const tipo = String(act.tipo || "").toLowerCase();
    const actividad = String(act.actividad || act.nombreActuacion || "").toLowerCase();
    const fecha = act.fecha || act.fechaProvidencia || act.fechaActuacion || "";

    if (tipo.includes("sentencia") || tipo.includes("auto resolutivo") || tipo.includes("fallo")) {
      return {
        poseeSentencia: true,
        fechaSentencia: fecha ? fecha.split("T")[0] : "Fecha no especificada",
      };
    }

    const esSentenciaExplicit =
      (actividad.includes("dicta sentencia") || actividad.includes("pronuncia sentencia") || actividad.includes("declarando con lugar") || actividad.includes("acepta la demanda")) &&
      !actividad.includes("se pronunciará inmediatamente sentencia") &&
      !actividad.includes("prevención");

    if (esSentenciaExplicit) {
      return {
        poseeSentencia: true,
        fechaSentencia: fecha ? fecha.split("T")[0] : "Fecha no especificada",
      };
    }
  }

  return { poseeSentencia: false, fechaSentencia: null };
}

// SISTEMA DE CLASIFICACIÓN DE ETAPAS PROCESALES (TAXONOMÍA DE 15 ETAPAS KAIRON JUDICIAL)
export interface ClasificacionEtapa {
  etapaGeneral: string;
  etapaEspecifica: string;
  codigoEtapa: string;
  explicacion: string;
}

export function clasificarEtapaProcesal(actuaciones: any[]): ClasificacionEtapa {
  if (!actuaciones || actuaciones.length === 0) {
    return {
      etapaGeneral: "SIN INFO",
      etapaEspecifica: "SIN INFO",
      codigoEtapa: "00",
      explicacion: "No hay actuaciones registradas para clasificar la etapa procesal.",
    };
  }

  const textoCompletoExpediente = JSON.stringify(actuaciones).toLowerCase();

  const actuacionesInversas = [...actuaciones].sort((a, b) => {
    const fA = new Date(a.fecha || a.fechaProvidencia || a.fechaActuacion || "1900-01-01").getTime();
    const fB = new Date(b.fecha || b.fechaProvidencia || b.fechaActuacion || "1900-01-01").getTime();
    return fB - fA;
  });

  // EVALUACIÓN PRIMERA: FASE DE EJECUCIÓN Y MANDAMIENTO DE EJECUCIÓN (COGEP ART. 372 + SEPS, BANCOS, DINARDAP)
  for (const act of actuacionesInversas) {
    const actStr = JSON.stringify(act).toLowerCase();
    
    if (actStr.includes("remate") || actStr.includes("retasa")) {
      let especifica = "10.15. Ejec. - Remate 1er. Señalamiento";
      if (actStr.includes("2do") || actStr.includes("segundo")) especifica = "10.16. Ejec. - Remate 2do. Señalamiento";
      else if (actStr.includes("3er") || actStr.includes("tercer")) especifica = "10.17. Ejec. - Remate 3er. Señalamiento";
      else if (actStr.includes("retasa")) especifica = "10.18. Ejec. - Retasa 1er. Señalamiento";

      return {
        etapaGeneral: "10. EJECUCION",
        etapaEspecifica: especifica,
        codigoEtapa: "10",
        explicacion: "Fase de ejecución forzosa: convocatoria o señalamiento de remate o retasa de bienes.",
      };
    }

    if (actStr.includes("avaluo") || actStr.includes("avalúo") || actStr.includes("perito") || actStr.includes("liquidac")) {
      let especifica = "10.9. Ejec. - Avalúo Pericial Designación de perito";
      if (actStr.includes("aprobad")) especifica = "10.11. Ejec. - Avalúo pericial aprobado";
      else if (actStr.includes("observac")) especifica = "10.10. Ejec. - Avalúo Pericial Obsev. al informe";
      else if (actStr.includes("mandamiento de ejecucion") || actStr.includes("mandamiento de ejecución")) especifica = "10.4. Ejec. - Fecha Mandamiento de Ejecución";

      return {
        etapaGeneral: "10. EJECUCION",
        etapaEspecifica: especifica,
        codigoEtapa: "10",
        explicacion: "Fase de ejecución: avalúo de bienes o peritaje de liquidación del crédito.",
      };
    }

    const esMandamientoEjecucion =
      actStr.includes("mandamiento de ejecucion") ||
      actStr.includes("mandamiento de ejecución") ||
      actStr.includes("auto de ejecucion") ||
      actStr.includes("art. 372") ||
      actStr.includes("artículo 372") ||
      (actStr.includes("oficio") && (actStr.includes("seps") || actStr.includes("superintendencia de bancos") || actStr.includes("dinardap") || actStr.includes("dinarp") || actStr.includes("cuentas de ahorro") || actStr.includes("cuentas corrientes")));

    if (esMandamientoEjecucion || actStr.includes("embargo")) {
      let especifica = "10.4. Ejec. - Fecha Mandamiento de Ejecución";
      if (actStr.includes("seps") || actStr.includes("superintendencia de bancos") || actStr.includes("dinardap") || actStr.includes("dinarp") || actStr.includes("cuentas de ahorro") || actStr.includes("cuentas corrientes") || actStr.includes("bancos")) {
        especifica = "10.4. Ejec. - Fecha Mandamiento de Ejecución";
      } else if (actStr.includes("inmueble")) {
        especifica = "10.6. Ejec. - Embargo bien inmueble";
      } else if (actStr.includes("vehiculo") || actStr.includes("mueble")) {
        especifica = "10.7. Ejec. - Embargo bien mueble";
      }

      return {
        etapaGeneral: "10. EJECUCION",
        etapaEspecifica: especifica,
        codigoEtapa: "10",
        explicacion: "El proceso se encuentra en fase de Mandamiento de Ejecución (Art. 372 COGEP) u oficios a SEPS, Superintendencia de Bancos y DINARDAP sobre cuentas bancarias.",
      };
    }
  }

  if (textoCompletoExpediente.includes("devuelto a cobranzas") || textoCompletoExpediente.includes("devolucion a cobranzas")) {
    return {
      etapaGeneral: "15. PROCESOS DEVUELTO A COBRANZAS",
      etapaEspecifica: "15.1. Devuelto a cobranzas",
      codigoEtapa: "15",
      explicacion: "El proceso ha sido devuelto al área de cobranzas o cartera.",
    };
  }

  if (textoCompletoExpediente.includes("insolvencia") || textoCompletoExpediente.includes("declaratoria de insolvencia") || textoCompletoExpediente.includes("presuncion de insolvencia")) {
    return {
      etapaGeneral: "14. INSOLVENCIA",
      etapaEspecifica: "14.1. Proceso de insolvencia / Quiebra",
      codigoEtapa: "14",
      explicacion: "El proceso versa o se encuentra en trámite de insolvencia.",
    };
  }

  // REGLA STRICTA PARA 13. CONCURSO DE ACREEDORES (EVITA FALSOS POSITIVOS EN PROVIDENCIAS DE MANDAMIENTO)
  const esConcursoReal =
    textoCompletoExpediente.includes("concurso de acreedores") ||
    textoCompletoExpediente.includes("juicio concursal") ||
    textoCompletoExpediente.includes("declaratoria de concurso") ||
    textoCompletoExpediente.includes("auto inicial de concurso") ||
    textoCompletoExpediente.includes("demanda de concurso") ||
    textoCompletoExpediente.includes("sindico de quiebras");

  if (esConcursoReal) {
    let especifica = "13.1. Conc. Acr.- Solicitud de copias certificadas";
    if (textoCompletoExpediente.includes("sentencia concursal")) especifica = "13.21. Conc. Acr.- Sentencia";
    else if (textoCompletoExpediente.includes("audiencia concursal")) especifica = "13.20. Conc. Acr.- Audiencia concursal";
    else if (textoCompletoExpediente.includes("sindico")) especifica = "13.13. Conc. Acr.- Sindico de quiebras";
    else if (textoCompletoExpediente.includes("calificacion") || textoCompletoExpediente.includes("calificación")) especifica = "13.11. Conc. Acr.- Calificación";
    
    return {
      etapaGeneral: "13. CONCURSO DE ACREEDORES",
      etapaEspecifica: especifica,
      codigoEtapa: "13",
      explicacion: "Trámite correspondiente a procedimiento de concurso preventivo o voluntario de acreedores.",
    };
  }

  if (textoCompletoExpediente.includes("recurso de apelacion") || textoCompletoExpediente.includes("concede el recurso de apelacion") || textoCompletoExpediente.includes("sala de lo civil")) {
    let especifica = "09.1. Apel. - Admisión de recurso";
    if (textoCompletoExpediente.includes("sentencia de segunda instancia") || textoCompletoExpediente.includes("sentencia de apelacion")) especifica = "09.3. Apel. - Sentencia";
    else if (textoCompletoExpediente.includes("audiencia de apelacion")) especifica = "09.2. Apel. - Audiencia";

    return {
      etapaGeneral: "09. APELACIÓN",
      etapaEspecifica: especifica,
      codigoEtapa: "09",
      explicacion: "El expediente se encuentra impugnado mediante recurso de apelación en segunda instancia.",
    };
  }

  if (textoCompletoExpediente.includes("razon de ejecutoria") || textoCompletoExpediente.includes("razón de ejecutoria") || textoCompletoExpediente.includes("sentencia ejecutoriada")) {
    return {
      etapaGeneral: "08. RAZON DE EJECUTORIA",
      etapaEspecifica: "08.1. Razon ejecutoria fecha",
      codigoEtapa: "08",
      explicacion: "La resolución o sentencia ha causado ejecutoria según razón sentada por secretaría.",
    };
  }

  for (const act of actuacionesInversas) {
    const actStr = JSON.stringify(act).toLowerCase();
    const tipo = String(act.tipo || "").toLowerCase();

    if (tipo.includes("sentencia") || actStr.includes("dicta sentencia") || actStr.includes("acepta la demanda")) {
      let especifica = "07.1. Sent. - Con lugar";
      if (actStr.includes("conciliac") || actStr.includes("acuerdo")) especifica = "07.2. Sent. - Acuerdo conciliatorio";
      else if (actStr.includes("sin lugar") || actStr.includes("desecha")) especifica = "07.3. Sent. - Sin lugar";

      return {
        etapaGeneral: "07. SENTENCIA",
        etapaEspecifica: especifica,
        codigoEtapa: "07",
        explicacion: "Se ha emitido fallo o resolución de primera instancia en el juicio.",
      };
    }
  }

  if (textoCompletoExpediente.includes("audiencia preliminar") || textoCompletoExpediente.includes("audiencia de juicio") || textoCompletoExpediente.includes("convoca a audiencia")) {
    let especifica = "06.1. Aud. - Fecha";
    if (textoCompletoExpediente.includes("reanudac") || textoCompletoExpediente.includes("suspension")) especifica = "06.2. Aud. - Reanudación";

    return {
      etapaGeneral: "06. AUDIENCIA DE JUICIO",
      etapaEspecifica: especifica,
      codigoEtapa: "06",
      explicacion: "Convocatoria o desarrollo de Audiencia Preliminar o de Juicio según COGEP.",
    };
  }

  if (textoCompletoExpediente.includes("centro de mediacion") || textoCompletoExpediente.includes("derivacion a mediacion") || textoCompletoExpediente.includes("deriva a mediación")) {
    let especifica = "05.1. Med. - Juez deriva a mediación";
    if (textoCompletoExpediente.includes("demandado solicita")) especifica = "05.2. Med. - Demandado solicita derivación";

    return {
      etapaGeneral: "05. MEDIACION",
      etapaEspecifica: especifica,
      codigoEtapa: "05",
      explicacion: "Causa derivada a Centro de Mediación de la Función Judicial.",
    };
  }

  for (const act of actuacionesInversas) {
    const actStr = JSON.stringify(act).toLowerCase();
    
    if (actStr.includes("citac") || actStr.includes("citación") || actStr.includes("deprecatorio") || actStr.includes("prensa") || actStr.includes("cartel")) {
      let especifica = "04.1. Cita. - Ofi. Citaciones";
      if (actStr.includes("deprecatorio")) especifica = "04.3. Cita. - Deprecatorio";
      else if (actStr.includes("comision") || actStr.includes("comisión")) especifica = "04.2. Cita. - Comisión";
      else if (actStr.includes("prensa")) especifica = "04.4. Cita. - Prensa";
      else if (actStr.includes("cartel")) especifica = "04.5. Cita. - Fijación de carteles";
      else if (actStr.includes("exhorto")) especifica = "04.6. Cita. - Exhorto";

      return {
        etapaGeneral: "04. CITACIÓN",
        etapaEspecifica: especifica,
        codigoEtapa: "04",
        explicacion: "Proceso en trámite o gestión de citación a la parte demandada.",
      };
    }
  }

  if (textoCompletoExpediente.includes("se admite a tramite") || textoCompletoExpediente.includes("se admite a trámite") || textoCompletoExpediente.includes("demanda es clara") || textoCompletoExpediente.includes("califica la demanda")) {
    let especifica = "03.1. Calif. - Se admite a trámite";
    if (textoCompletoExpediente.includes("inadmite medida")) especifica = "03.2. Calif. - Se inadmite medida preventiva";

    return {
      etapaGeneral: "03. CALIFICACION",
      etapaEspecifica: especifica,
      codigoEtapa: "03",
      explicacion: "Auto inicial de calificación de la demanda admitida a trámite.",
    };
  }

  return {
    etapaGeneral: "02. SORTEO",
    etapaEspecifica: "02.1. Sorteo - Por presentacion de Demanda",
    codigoEtapa: "02",
    explicacion: "Ingreso o sorteo inicial de la demanda en la oficina judicial.",
  };
}

// DETECTOR DE CICLO DE VIDA DE MEDIDAS CAUTELARES & ANÁLISIS DE LAS 4 FECHAS (KAIRON JUDICIAL PRO ENGINE v3.5)
export interface AnalisisCicloVidaMedida {
  medidaDetectada: boolean;
  tipoMedida: string;
  institucionEjecutora: string;
  estadoCicloVida: "ORDENADA" | "OFICIADA" | "INSCRIPCION_CONFIRMADA" | "INSCRIPCION_NO_CONFIRMADA" | "LEVANTADA";
  fechaOrdenJudicial: string | null;
  fechaOficio: string | null;
  fechaInscripcion: string | null;
  fechaActuacionSatje: string | null;
  fechaLevantamiento: string | null;
  numeroInscripcion: string | null;
  numeroRepertorio: string | null;
  confianza: "ALTA" | "MEDIA" | "BAJA";
  evidenciaTextual: string;
  observacion: string;
  recomendacionEstrategica: string;
  fuente: {
    tipoActuacion: string;
    codigoActuacion?: number;
    archivo?: string;
    uuid?: string;
    alias?: string;
  };
}

export function detectorCicloVidaMedidaCautelar(actuaciones: any[]): AnalisisCicloVidaMedida {
  let me: AnalisisCicloVidaMedida = {
    medidaDetectada: false,
    tipoMedida: "PROHIBICIÓN DE ENAJENAR / EMBARGO",
    institucionEjecutora: "REGISTRO DE LA PROPIEDAD / MERCANTIL",
    estadoCicloVida: "INSCRIPCION_NO_CONFIRMADA",
    fechaOrdenJudicial: null,
    fechaOficio: null,
    fechaInscripcion: null,
    fechaActuacionSatje: null,
    fechaLevantamiento: null,
    numeroInscripcion: null,
    numeroRepertorio: null,
    confianza: "BAJA",
    evidenciaTextual: "Sin evidencias registrales en SATJE",
    observacion: "No se registran medidas cautelares u órdenes de embargo en el expediente.",
    recomendacionEstrategica: "Monitorear actuaciones judiciales para verificar si se solicita medida en la calificación de la demanda o ejecutorias.",
    fuente: {
      tipoActuacion: "S/A",
    },
  };

  const actuacionesOrdenadas = [...actuaciones].sort((a, b) => {
    const fA = new Date(a.fecha || a.fechaProvidencia || a.fechaActuacion || "1900-01-01").getTime();
    const fB = new Date(b.fecha || b.fechaProvidencia || b.fechaActuacion || "1900-01-01").getTime();
    return fA - fB;
  });

  const REGEX_CORRESPONDIENTE = /(?:correspondiente\s+a\s+la\s+presente\s+fecha|se\s+inscribieron\s+los\s+siguientes\s+actos|fecha\s+de\s+repertorio).{0,60}?(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}|\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/i;
  const REGEX_DERECHA = /(?:fecha\s+de\s+inscripci[oó]n|qued[oó]\s+inscrit[oa]|fue\s+inscrit[oa]|se\s+procedi[oó]\s+a\s+inscribir|inscrit[oa]\s+con\s+fecha|inscrit[oa]\s+el).{0,100}?(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i;
  const REGEX_IZQUIERDA = /(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}).{0,100}?(?:se\s+inscribi[oó]|qued[oó]\s+inscrit[oa]|fue\s+registrad[oa]|inscrit[oa]\s+en\s+el\s+registro)/i;
  const REGEX_REPERTORIO = /(?:repertorio|asiento|inscripci[oó]n|tomo)\s*(?:N[°o]|\#)?\s*:?\s*([0-9\-\/]+)/i;

  for (const act of actuacionesOrdenadas) {
    const textoStr = JSON.stringify(act).toLowerCase();
    const actividad = String(act.actividad || act.nombreActuacion || "");
    const tipoAct = String(act.tipo || "").toUpperCase();
    const fechaActRaw = act.fecha || act.fechaProvidencia || act.fechaActuacion || "";
    let fechaLimpia = fechaActRaw ? fechaActRaw.split("T")[0] : null;

    const esMedida = CATEGORIAS_INDICADORES.medidas_cautelares.some(p => textoStr.includes(p));

    if (esMedida) {
      me.medidaDetectada = true;

      if (textoStr.includes("propiedad") || textoStr.includes("predio") || textoStr.includes("terreno") || textoStr.includes("inmueble")) {
        me.tipoMedida = "PROHIBICIÓN DE ENAJENAR / EMBARGO (INMUEBLE)";
        me.institucionEjecutora = "REGISTRO DE LA PROPIEDAD";
      } else if (textoStr.includes("vehiculo") || textoStr.includes("vehículo") || textoStr.includes("chasis") || textoStr.includes("placa") || textoStr.includes("ant")) {
        me.tipoMedida = "EMBARGO / PROHIBICIÓN AUTOMOTOR";
        me.institucionEjecutora = "AGENCIA NACIONAL DE TRÁNSITO / REGISTRO MERCANTIL";
      } else if (textoStr.includes("banco") || textoStr.includes("cooperativa") || textoStr.includes("cuentas") || textoStr.includes("fondos")) {
        me.tipoMedida = "RETENCIÓN DE CUENTAS BANCARIAS";
        me.institucionEjecutora = "SUPERINTENDENCIA DE BANCOS / INSTITUCIONES FINANCIERAS";
      }

      if (!me.fechaOrdenJudicial) {
        me.fechaOrdenJudicial = fechaLimpia;
        me.estadoCicloVida = "ORDENADA";
        me.observacion = "El Juez ha dispuesto la medida cautelar, pero aún no se ha generado u oficiado la comunicación registral.";
        me.recomendacionEstrategica = "Solicitar en la Unidad Judicial la emisión urgente del Oficio dirigido a la institución correspondiente.";
      }

      if (tipoAct.includes("OFICIO") || textoStr.includes("ofíciese") || textoStr.includes("oficiese")) {
        if (!me.fechaOficio) {
          me.fechaOficio = fechaLimpia;
          me.estadoCicloVida = "OFICIADA";
          me.observacion = "SATJE contiene la orden y el oficio judicial, pero no se ha encontrado respuesta o razón de inscripción de la institución.";
          me.recomendacionEstrategica = "Presentar escrito solicitando al Juez reiterar oficio o pedir razón de cumplimiento al Registrador correspondiente.";
        }
      }

      const esRespuestaRegistral =
        (textoStr.includes("registrador") || textoStr.includes("registro") || textoStr.includes("mercantil") || textoStr.includes("oficio")) &&
        (textoStr.includes("cumplimiento de la inscripcion") || textoStr.includes("cumplimiento de la inscripción") ||
         textoStr.includes("informa sobre el cumplimiento") || textoStr.includes("razon de inscripcion") || textoStr.includes("razón de inscripción") ||
         textoStr.includes("quedo inscrita") || textoStr.includes("quedó inscrita") || textoStr.includes("se procedio a inscribir") || textoStr.includes("inscrito el") || textoStr.includes("inscrita el") || textoStr.includes("correspondiente a la presente fecha") || textoStr.includes("contestacion de oficios"));

      if (esRespuestaRegistral) {
        me.estadoCicloVida = "INSCRIPCION_CONFIRMADA";
        me.fechaActuacionSatje = fechaLimpia;
        me.fuente = {
          tipoActuacion: tipoAct || "RAZÓN / OFICIO REGISTRAL",
          codigoActuacion: act.codigo,
          archivo: act.nombreArchivo || undefined,
          uuid: act.uuid || undefined,
          alias: act.alias || "HBA01",
        };

        const matchCorrespondiente = actividad.match(REGEX_CORRESPONDIENTE) || textoStr.match(REGEX_CORRESPONDIENTE);
        const matchDer = actividad.match(REGEX_DERECHA);
        const matchIzad = actividad.match(REGEX_IZQUIERDA);
        const matchRepertorio = actividad.match(REGEX_REPERTORIO);

        if (matchCorrespondiente) {
          me.fechaInscripcion = matchCorrespondiente[1];
          me.confianza = "ALTA";
          me.evidenciaTextual = `"${matchCorrespondiente[0]}"`;
        } else if (matchDer) {
          me.fechaInscripcion = matchDer[1];
          me.confianza = "ALTA";
          me.evidenciaTextual = `"${matchDer[0]}"`;
        } else if (matchIzad) {
          me.fechaInscripcion = matchIzad[1];
          me.confianza = "ALTA";
          me.evidenciaTextual = `"${matchIzad[0]}"`;
        } else {
          me.fechaInscripcion = fechaLimpia;
          me.confianza = "MEDIA";
          me.evidenciaTextual = `"${actividad.slice(0, 260)}..."`;
        }

        if (matchRepertorio && !me.numeroRepertorio) {
          me.numeroRepertorio = matchRepertorio[1];
        }

        me.observacion = "Inscripción confirmada mediante Razón de Inscripción del Registro de la Propiedad incorporada a SATJE.";
        me.recomendacionEstrategica = "Medida cautelar activa y perfeccionada. Proceder con las siguientes etapas de evaluación de garantías o ejecución.";
      }
    }

    const esLevantamiento =
      textoStr.includes("levantamiento del embargo") || textoStr.includes("levantamiento de la prohibicion") ||
      textoStr.includes("cancelo el embargo") || textoStr.includes("cancelación de la medida") ||
      textoStr.includes("dejese sin efecto la prohibicion") || textoStr.includes("déjese sin efecto la prohibición");

    if (esLevantamiento) {
      me.estadoCicloVida = "LEVANTADA";
      me.fechaLevantamiento = fechaLimpia;
      me.observacion = "Se registra providencia u oficio de levantamiento / cancelación de la medida cautelar.";
      me.recomendacionEstrategica = "Verificar cancelación en el certificado de gravámenes actualizado del Registro correspondiente.";
    }
  }

  return me;
}

// Tipos de actuacion que SATJE registra con fecha propia pero que no
// constituyen un acto de impulso procesal real (Art. 245-247 COGEP): no
// deben contar como "ultima actuacion" para el conteo de abandono, aunque
// su fecha sea la mas reciente del expediente.
const TIPOS_SIN_IMPULSO_PROCESAL = ["declaracion de la demanda", "declaración de la demanda", "envio del proceso al archivo", "envío del proceso al archivo"];

function esImpulsoProcesalReal(act: any): boolean {
  const tipo = String(act.tipo || "").toLowerCase();
  if (tipo.includes("razon") || tipo.includes("razón")) return false;
  return !TIPOS_SIN_IMPULSO_PROCESAL.some((t) => tipo.includes(t));
}

// Frase formulaica que usan los autos interlocutorios cuando el juez YA
// declaro el abandono procesal por ministerio de la ley (Art. 245 COGEP).
// Distinta de una simple mencion de "abandono" (ej. una razon de secretaria
// notando que pasaron 6 meses, o una peticion pidiendo que se declare) --
// esa mencion sola no confirma que el juez efectivamente resolvio.
const FRASE_DECLARATORIA_ABANDONO = "se declara el abandono";

function actuacionQueDeclaraAbandono(actuaciones: any[]): any | undefined {
  return actuaciones?.find((act) => String(act.actividad || "").toLowerCase().includes(FRASE_DECLARATORIA_ABANDONO));
}

// MOTOR DE ALERTA PREVENTIVA DE ABANDONO PROCESAL (COGEP ART. 245, 246, 247)
export function calcularAlertaAbandonoProcesal(actuaciones: any[], poseeSentencia: boolean): {
  nivel: 'normal' | 'alerta' | 'critico' | 'vencido' | 'improcedente' | 'abandonada';
  etiqueta: string;
  badgeClass: string;
  diasRestantes: number;
  porcentajeGauge: number;
  fechaUltimaActuacion: string;
  fechaReferencialAbandono: string;
  explicacion: string;
  esDeprecatorio: boolean;
  relojDeprecatorioInfo?: string;
} {
  if (poseeSentencia) {
    return {
      nivel: 'improcedente',
      etiqueta: '⚪ Improcedente (Art. 247 COGEP)',
      badgeClass: 'muted',
      diasRestantes: 999,
      porcentajeGauge: 100,
      fechaUltimaActuacion: 'N/A',
      fechaReferencialAbandono: 'N/A',
      explicacion: 'No procede la declaración de abandono procesal por existir resolución o sentencia emitida en la causa (Art. 247 del COGEP).',
      esDeprecatorio: false,
    };
  }

  const declaratoria = actuacionQueDeclaraAbandono(actuaciones);
  if (declaratoria) {
    const fechaStr = declaratoria.fecha || declaratoria.fechaProvidencia || declaratoria.fechaActuacion || "";
    const fechaDeclaratoria = fechaStr ? String(fechaStr).split("T")[0] : "N/A";
    return {
      nivel: 'abandonada',
      etiqueta: '🔴 ABANDONADA (Declarada por el Juez)',
      badgeClass: 'danger',
      diasRestantes: 999,
      porcentajeGauge: 100,
      fechaUltimaActuacion: fechaDeclaratoria,
      fechaReferencialAbandono: fechaDeclaratoria,
      explicacion: `El juez ya declaró el abandono de la causa por ministerio de la ley (Art. 245 COGEP) el ${fechaDeclaratoria}. La causa quedó archivada; ya no aplica un conteo de días.`,
      esDeprecatorio: false,
    };
  }

  if (!actuaciones || actuaciones.length === 0) {
    return {
      nivel: 'normal',
      etiqueta: '🟢 Sin datos',
      badgeClass: 'success',
      diasRestantes: 180,
      porcentajeGauge: 100,
      fechaUltimaActuacion: 'N/A',
      fechaReferencialAbandono: 'N/A',
      explicacion: 'No hay actuaciones para calcular el riesgo de abandono.',
      esDeprecatorio: false,
    };
  }

  let fechaMasReciente: Date | null = null;
  let fechaUltimaStr = "";
  let esDeprecatorioDetectado = false;

  for (const act of actuaciones) {
    const textoStr = JSON.stringify(act).toLowerCase();
    if (textoStr.includes("deprecatorio") || textoStr.includes("exhorto") || textoStr.includes("comision")) {
      esDeprecatorioDetectado = true;
    }

    if (!esImpulsoProcesalReal(act)) continue;

    const fechaStr = act.fecha || act.fechaProvidencia || act.fechaActuacion || "";
    if (fechaStr) {
      const d = new Date(fechaStr);
      if (!isNaN(d.getTime())) {
        if (!fechaMasReciente || d > fechaMasReciente) {
          fechaMasReciente = d;
          fechaUltimaStr = fechaStr.split("T")[0];
        }
      }
    }
  }

  if (!fechaMasReciente) {
    fechaMasReciente = new Date();
    fechaUltimaStr = fechaMasReciente.toISOString().split("T")[0];
  }

  const fechaAbandono = new Date(fechaMasReciente);
  fechaAbandono.setMonth(fechaAbandono.getMonth() + 6);

  const hoy = new Date();
  const diffTiempo = fechaAbandono.getTime() - hoy.getTime();
  const diasRestantes = Math.ceil(diffTiempo / (1000 * 3600 * 24));
  const fechaAbandonoStr = fechaAbandono.toISOString().split("T")[0];

  const porcentajeGauge = Math.max(0, Math.min(100, Math.round((diasRestantes / 180) * 100)));

  let nivel: 'normal' | 'alerta' | 'critico' | 'vencido' = 'normal';
  let etiqueta = '';
  let badgeClass = '';
  let explicacion = '';

  if (diasRestantes > 60) {
    nivel = 'normal';
    etiqueta = '🟢 Vigilancia / Normal';
    badgeClass = 'success';
    explicacion = `Impulso procesal reciente. Restan ${diasRestantes} días para completar los 6 meses de inactividad.`;
  } else if (diasRestantes > 30) {
    nivel = 'alerta';
    etiqueta = '🟡 Alerta Preventiva';
    badgeClass = 'warning';
    explicacion = `Atención preventiva: Restan ${diasRestantes} días antes de ingresar a la fase crítica de abandono.`;
  } else if (diasRestantes >= 0) {
    nivel = 'critico';
    etiqueta = '🔴 RIESGO CRÍTICO';
    badgeClass = 'danger';
    explicacion = `¡Riesgo inminente! Restan solo ${diasRestantes} días. Se requiere ingresar escrito de impulso procesal urgente.`;
  } else {
    nivel = 'vencido';
    etiqueta = '🟣 VENCIDO (Riesgo de Abandono)';
    badgeClass = 'purple';
    explicacion = `Han transcurrido ${Math.abs(diasRestantes)} días de exceso sobre los 6 meses reglamentarios (Art. 245 COGEP).`;
  }

  return {
    nivel,
    etiqueta,
    badgeClass,
    diasRestantes,
    porcentajeGauge,
    fechaUltimaActuacion: fechaUltimaStr,
    fechaReferencialAbandono: fechaAbandonoStr,
    explicacion,
    esDeprecatorio: esDeprecatorioDetectado,
    relojDeprecatorioInfo: esDeprecatorioDetectado ? '⚡ Doble Reloj Activo (Monitoreo Unidad Principal + Judicatura Deprecada).' : undefined,
  };
}

// Cuando un proceso es declarado en abandono (Art. 245 COGEP), la pretension
// no se extingue pero el proceso si termina: si el actor impulsa de nuevo,
// SATJE le asigna un numero de proceso totalmente distinto sin ningun campo
// que lo vincule al anterior. La unica forma de encontrarlo es buscando por
// la cedula de una de las partes y comparando el "asunto" (mismo texto que
// SATJE usa en el campo `accion` de la busqueda por cedula) contra el de la
// causa abandonada, que se extrae de su actuacion CARATULA DE JUICIO.
export function extraerAsuntoDeCaratula(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const match = texto.match(/Asunto:\s*(.+)/i);
  if (!match) return null;
  const asunto = match[1].split(/\r?\n/)[0].trim();
  return asunto || null;
}

function normalizarTextoComparacion(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CausaCandidataReinicio {
  idJuicio: string;
  numeroProceso: string;
  accion?: string;
  fechaIngreso?: string;
  judicatura?: string;
  estadoActual?: string;
}

export function filtrarCandidatosReinicio(
  causas: CausaCandidataReinicio[],
  asuntoActual: string,
  fechaAbandonoISO: string,
  idJuicioActual: string
): CausaCandidataReinicio[] {
  const asuntoNormalizado = normalizarTextoComparacion(asuntoActual);
  const fechaAbandono = new Date(fechaAbandonoISO);

  return causas
    .filter((c) => c.idJuicio !== idJuicioActual)
    .filter((c) => normalizarTextoComparacion(c.accion || '') === asuntoNormalizado)
    .filter((c) => {
      if (!c.fechaIngreso) return false;
      const fecha = new Date(c.fechaIngreso);
      return !isNaN(fecha.getTime()) && fecha > fechaAbandono;
    })
    .sort((a, b) => new Date(b.fechaIngreso!).getTime() - new Date(a.fechaIngreso!).getTime());
}

// Para la revision en lote tipo supervisor: dada la lista completa de causas
// de una persona (con su estado ya calculado), determina cual es "el ultimo
// juicio vigente" -- se excluyen las que ya tienen sentencia (Art. 247 COGEP,
// improcedente el abandono pero el proceso ya termino) y las declaradas en
// abandono, y de las que quedan se toma la de fecha de ingreso mas reciente.
export interface CausaConEstado {
  idJuicio: string;
  numeroProceso: string;
  fechaIngreso?: string | null;
  poseeSentencia: boolean;
  nivelAbandono: string;
}

export function seleccionarJuicioVigente(causas: CausaConEstado[]): CausaConEstado | null {
  const vigentes = causas.filter((c) => !c.poseeSentencia && c.nivelAbandono !== "abandonada");
  if (vigentes.length === 0) return null;

  return vigentes.reduce((mejor, actual) => {
    const fechaMejor = mejor.fechaIngreso ? new Date(mejor.fechaIngreso).getTime() : -Infinity;
    const fechaActual = actual.fechaIngreso ? new Date(actual.fechaIngreso).getTime() : -Infinity;
    return fechaActual > fechaMejor ? actual : mejor;
  });
}
