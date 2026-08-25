import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNumeroCausa,
  extraerTodasLasActuaciones,
  detectorSentenciaLegal,
  clasificarEtapaProcesal,
  detectorCicloVidaMedidaCautelar,
  calcularAlertaAbandonoProcesal,
  extraerAsuntoDeCaratula,
  filtrarCandidatosReinicio,
} from "./legal-analysis.js";

function actuacion(overrides: Record<string, any> = {}) {
  return {
    fecha: "2025-01-01",
    tipo: "",
    actividad: "",
    codigo: "1",
    ...overrides,
  };
}

describe("normalizarNumeroCausa", () => {
  test("inserta guiones en un numero de 15 digitos sin formato", () => {
    assert.equal(normalizarNumeroCausa("013332025008870"), "01333-2025-008870");
  });

  test("deja intacto un numero ya formateado", () => {
    assert.equal(normalizarNumeroCausa("01333-2025-08870"), "01333-2025-08870");
  });

  test("no reformatea numeros fuera del rango 13-16 digitos", () => {
    assert.equal(normalizarNumeroCausa("12345"), "12345");
  });
});

describe("extraerTodasLasActuaciones", () => {
  test("extrae actuaciones anidadas en incidentes", () => {
    const data = {
      judicatura: "Unidad X",
      incidentes: [
        { nombreJudicatura: "Unidad Y", actuaciones: [{ codigo: "1" }, { codigo: "2" }] },
      ],
    };
    const result = extraerTodasLasActuaciones(data);
    assert.equal(result.length, 2);
    assert.equal(result[0].nombreJudicatura, "Unidad Y");
  });

  test("usa la judicatura del expediente si el incidente no trae una", () => {
    const data = { judicatura: "Unidad X", incidentes: [{ actuaciones: [{ codigo: "1" }] }] };
    const result = extraerTodasLasActuaciones(data);
    assert.equal(result[0].nombreJudicatura, "Unidad X");
  });

  test("cae a data.actuaciones si no hay incidentes", () => {
    const result = extraerTodasLasActuaciones({ actuaciones: [{ codigo: "9" }] });
    assert.equal(result.length, 1);
    assert.equal(result[0].codigo, "9");
  });

  test("cae a data.data si no hay incidentes ni actuaciones", () => {
    const result = extraerTodasLasActuaciones({ data: [{ codigo: "9" }] });
    assert.equal(result.length, 1);
  });

  test("recorre data.juicios recursivamente", () => {
    const result = extraerTodasLasActuaciones({ juicios: [{ actuaciones: [{ codigo: "1" }] }, { actuaciones: [{ codigo: "2" }] }] });
    assert.equal(result.length, 2);
  });

  test("devuelve arreglo vacio si no hay datos reconocibles", () => {
    assert.deepEqual(extraerTodasLasActuaciones(null), []);
    assert.deepEqual(extraerTodasLasActuaciones({}), []);
  });
});

describe("detectorSentenciaLegal", () => {
  test("sin actuaciones no hay sentencia", () => {
    const r = detectorSentenciaLegal([]);
    assert.equal(r.poseeSentencia, false);
    assert.equal(r.fechaSentencia, null);
  });

  test("detecta sentencia por el campo tipo", () => {
    const r = detectorSentenciaLegal([actuacion({ tipo: "SENTENCIA", fecha: "2025-05-10" })]);
    assert.equal(r.poseeSentencia, true);
    assert.equal(r.fechaSentencia, "2025-05-10");
  });

  test("detecta sentencia por frase explicita en la actividad", () => {
    const r = detectorSentenciaLegal([actuacion({ actividad: "El juez dicta sentencia condenando al demandado." })]);
    assert.equal(r.poseeSentencia, true);
  });

  test("no confunde un anuncio futuro de sentencia con una sentencia real", () => {
    const r = detectorSentenciaLegal([
      actuacion({ actividad: "Se pronunciará inmediatamente sentencia en la siguiente audiencia." }),
    ]);
    assert.equal(r.poseeSentencia, false);
  });
});

describe("clasificarEtapaProcesal", () => {
  test("sin actuaciones devuelve SIN INFO", () => {
    const r = clasificarEtapaProcesal([]);
    assert.equal(r.codigoEtapa, "00");
  });

  test("detecta etapa de CITACION", () => {
    const r = clasificarEtapaProcesal([actuacion({ actividad: "Se dispone la citación al demandado por deprecatorio." })]);
    assert.equal(r.codigoEtapa, "04");
  });

  test("detecta etapa de SENTENCIA", () => {
    const r = clasificarEtapaProcesal([actuacion({ tipo: "sentencia", actividad: "Se acepta la demanda." })]);
    assert.equal(r.codigoEtapa, "07");
  });

  test("detecta etapa de EJECUCION por embargo", () => {
    const r = clasificarEtapaProcesal([actuacion({ actividad: "Se ordena el embargo del bien inmueble del demandado." })]);
    assert.equal(r.codigoEtapa, "10");
    assert.match(r.etapaEspecifica, /Embargo bien inmueble/);
  });

  test("prioriza remate sobre calificacion cuando ambas fases aparecen en el expediente", () => {
    const r = clasificarEtapaProcesal([
      actuacion({ actividad: "Se admite a trámite la demanda.", fecha: "2023-01-01" }),
      actuacion({ actividad: "Se señala fecha de remate del bien embargado.", fecha: "2025-01-01" }),
    ]);
    assert.equal(r.codigoEtapa, "10");
  });

  test("por defecto cae en SORTEO cuando ninguna regla mas especifica aplica", () => {
    const r = clasificarEtapaProcesal([actuacion({ actividad: "Actuación administrativa sin relevancia procesal." })]);
    assert.equal(r.codigoEtapa, "02");
  });
});

describe("detectorCicloVidaMedidaCautelar", () => {
  test("sin mencion de medida cautelar no detecta nada", () => {
    const r = detectorCicloVidaMedidaCautelar([actuacion({ actividad: "Notificación de rigor." })]);
    assert.equal(r.medidaDetectada, false);
    assert.equal(r.estadoCicloVida, "INSCRIPCION_NO_CONFIRMADA");
  });

  test("orden judicial de embargo marca estado ORDENADA", () => {
    const r = detectorCicloVidaMedidaCautelar([
      actuacion({ actividad: "El juez ordena el embargo del bien inmueble.", fecha: "2025-01-10" }),
    ]);
    assert.equal(r.medidaDetectada, true);
    assert.equal(r.estadoCicloVida, "ORDENADA");
    assert.equal(r.fechaOrdenJudicial, "2025-01-10");
  });

  test("oficio posterior marca estado OFICIADA", () => {
    const r = detectorCicloVidaMedidaCautelar([
      actuacion({ tipo: "PROVIDENCIA", actividad: "Se ordena el embargo del bien inmueble.", fecha: "2025-01-10" }),
      actuacion({ tipo: "OFICIO", actividad: "Ofíciese al Registro de la Propiedad.", fecha: "2025-01-15" }),
    ]);
    assert.equal(r.estadoCicloVida, "OFICIADA");
    assert.equal(r.fechaOficio, "2025-01-15");
  });

  test("respuesta registral con fecha extraible por regex da confianza ALTA", () => {
    const r = detectorCicloVidaMedidaCautelar([
      actuacion({ actividad: "Embargo de bien inmueble ordenado por el juez.", fecha: "2025-01-10" }),
      actuacion({
        tipo: "OFICIO",
        actividad: "El Registro de la Propiedad informa sobre el cumplimiento de la inscripción, quedó inscrito con fecha 20/10/2025.",
        fecha: "2025-10-21",
      }),
    ]);
    assert.equal(r.estadoCicloVida, "INSCRIPCION_CONFIRMADA");
    assert.equal(r.confianza, "ALTA");
    assert.equal(r.fechaInscripcion, "20/10/2025");
  });

  // Regresion del bug real: antes, cuando el texto no traia una fecha
  // extraible pero mencionaba "contestacion de oficios" + "registro de la
  // propiedad", el sistema le pegaba a CUALQUIER causa la fecha, oficio y
  // repertorio de un caso ajeno con confianza ALTA. Debe caer a MEDIA con la
  // fecha de la actuación, no inventar un repertorio de otro expediente.
  test("respuesta registral sin fecha extraible cae a confianza MEDIA (no inventa datos de otro caso)", () => {
    const r = detectorCicloVidaMedidaCautelar([
      actuacion({ actividad: "Embargo de bien inmueble ordenado por el juez.", fecha: "2025-01-10" }),
      actuacion({
        tipo: "OFICIO",
        actividad: "Registro de la Propiedad informa sobre el cumplimiento de la orden sin mayor detalle.",
        fecha: "2025-03-03",
      }),
    ]);
    assert.equal(r.estadoCicloVida, "INSCRIPCION_CONFIRMADA");
    assert.equal(r.confianza, "MEDIA");
    assert.equal(r.fechaInscripcion, "2025-03-03");
    assert.equal(r.numeroRepertorio, null);
    assert.doesNotMatch(r.evidenciaTextual, /969488|23696/);
  });

  test("levantamiento marca estado LEVANTADA", () => {
    const r = detectorCicloVidaMedidaCautelar([
      actuacion({ actividad: "Embargo de bien inmueble ordenado por el juez.", fecha: "2025-01-10" }),
      actuacion({ actividad: "Se dispone el levantamiento del embargo.", fecha: "2025-06-01" }),
    ]);
    assert.equal(r.estadoCicloVida, "LEVANTADA");
    assert.equal(r.fechaLevantamiento, "2025-06-01");
  });
});

describe("calcularAlertaAbandonoProcesal", () => {
  test("con sentencia, el abandono es improcedente sin importar las actuaciones", () => {
    const r = calcularAlertaAbandonoProcesal([], true);
    assert.equal(r.nivel, "improcedente");
  });

  // Caso real reportado: la causa 01333-2025-03613 tiene un AUTO
  // INTERLOCUTORIO donde la jueza literalmente declara el abandono por
  // ministerio de la ley y ordena archivar la causa. El sistema seguia
  // mostrando un contador de dias como si el caso estuviera activo.
  test("si una actuacion declara el abandono explicitamente, nivel es 'abandonada' sin contador", () => {
    const r = calcularAlertaAbandonoProcesal(
      [
        actuacion({ tipo: "PROVIDENCIA", actividad: "Se admite a tramite la demanda.", fecha: "2025-03-31" }),
        actuacion({
          tipo: "ABANDONO POR FALTA DE IMPULSO PROCESAL ART. 245 (AUTO INTERLOCUTORIO)",
          actividad:
            "...transcurrido un lapso superior a seis meses... se declara el abandono de la causa por ministerio de la ley. Cumplido lo anterior, archívese la causa. Notifíquese.",
          fecha: "2026-04-07",
        }),
      ],
      false
    );
    assert.equal(r.nivel, "abandonada");
    assert.equal(r.fechaUltimaActuacion, "2026-04-07");
  });

  test("una mera mencion de 'abandono' sin la formula declarativa no dispara el estado 'abandonada'", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = calcularAlertaAbandonoProcesal(
      [
        actuacion({
          tipo: "RAZON",
          actividad: "Siento razon que desde la ultima providencia util han transcurrido mas de seis meses, conforme el art. 245 sobre abandono procesal.",
          fecha: hoy,
        }),
      ],
      false
    );
    assert.notEqual(r.nivel, "abandonada");
  });

  test("sin actuaciones y sin sentencia, nivel normal por defecto", () => {
    const r = calcularAlertaAbandonoProcesal([], false);
    assert.equal(r.nivel, "normal");
    assert.equal(r.diasRestantes, 180);
  });

  test("actuacion reciente (hoy) da nivel normal con ~180 dias restantes", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = calcularAlertaAbandonoProcesal([actuacion({ fecha: hoy })], false);
    assert.equal(r.nivel, "normal");
    // 6 meses calendario desde hoy no son exactamente 180 dias (depende de
    // cuantos meses de 31 dias caen en el rango), asi que se deja margen.
    assert.ok(r.diasRestantes >= 175 && r.diasRestantes <= 186, `diasRestantes fuera de rango: ${r.diasRestantes}`);
  });

  test("actuacion de hace 7 meses da nivel vencido", () => {
    const hace7Meses = new Date();
    hace7Meses.setMonth(hace7Meses.getMonth() - 7);
    const r = calcularAlertaAbandonoProcesal([actuacion({ fecha: hace7Meses.toISOString().slice(0, 10) })], false);
    assert.equal(r.nivel, "vencido");
    assert.ok(r.diasRestantes < 0);
  });

  test("marca doble reloj cuando hay deprecatorio", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = calcularAlertaAbandonoProcesal([actuacion({ fecha: hoy, actividad: "Diligencia deprecatorio virtual." })], false);
    assert.equal(r.esDeprecatorio, true);
    assert.match(r.relojDeprecatorioInfo || "", /Doble Reloj/);
  });

  // Regresion reportada en produccion: un caso realmente abandonado mostraba
  // "faltan 42 dias" porque la actuacion mas reciente por fecha era una
  // "declaracion de la demanda" que no es impulso procesal real (quedo
  // registrada en SATJE con fecha posterior a la calificacion de la demanda,
  // que si fue el ultimo acto sustantivo). El conteo de abandono debe
  // ignorar ese tipo de actuaciones al buscar la fecha mas reciente.
  describe("ignora actuaciones que no son impulso procesal real", () => {
    test("ignora 'declaracion de la demanda' aunque sea la mas reciente por fecha", () => {
      const hace7Meses = new Date();
      hace7Meses.setMonth(hace7Meses.getMonth() - 7);
      const fechaCalificacion = hace7Meses.toISOString().slice(0, 10);

      const r = calcularAlertaAbandonoProcesal(
        [
          actuacion({ tipo: "CALIFICACION DE LA DEMANDA", fecha: fechaCalificacion }),
          actuacion({ tipo: "DECLARACION DE LA DEMANDA", fecha: new Date().toISOString().slice(0, 10) }),
        ],
        false
      );
      assert.equal(r.nivel, "vencido");
      assert.equal(r.fechaUltimaActuacion, fechaCalificacion);
    });

    test("ignora razones y certificaciones de secretaria (tipo RAZON)", () => {
      const hace7Meses = new Date();
      hace7Meses.setMonth(hace7Meses.getMonth() - 7);
      const fechaImpulsoReal = hace7Meses.toISOString().slice(0, 10);

      const r = calcularAlertaAbandonoProcesal(
        [
          actuacion({ tipo: "PROVIDENCIA", actividad: "Se admite a tramite la demanda.", fecha: fechaImpulsoReal }),
          actuacion({ tipo: "RAZON", actividad: "Certifico que se agrega el presente escrito.", fecha: new Date().toISOString().slice(0, 10) }),
        ],
        false
      );
      assert.equal(r.nivel, "vencido");
      assert.equal(r.fechaUltimaActuacion, fechaImpulsoReal);
    });

    test("ignora envio/retorno del proceso a archivo", () => {
      const hace7Meses = new Date();
      hace7Meses.setMonth(hace7Meses.getMonth() - 7);
      const fechaImpulsoReal = hace7Meses.toISOString().slice(0, 10);

      const r = calcularAlertaAbandonoProcesal(
        [
          actuacion({ tipo: "PROVIDENCIA", actividad: "Se admite a tramite la demanda.", fecha: fechaImpulsoReal }),
          actuacion({
            tipo: "ENVIO DEL PROCESO AL ARCHIVO GENERAL (RAZON)",
            actividad: "Se envia el proceso al archivo.",
            fecha: new Date().toISOString().slice(0, 10),
          }),
        ],
        false
      );
      assert.equal(r.nivel, "vencido");
      assert.equal(r.fechaUltimaActuacion, fechaImpulsoReal);
    });

    test("una actuacion de impulso real posterior a una excluida si cuenta", () => {
      const hoy = new Date().toISOString().slice(0, 10);
      const r = calcularAlertaAbandonoProcesal(
        [
          actuacion({ tipo: "RAZON", actividad: "Certificacion de secretaria.", fecha: "2020-01-01" }),
          actuacion({ tipo: "PROVIDENCIA", actividad: "Se señala fecha para audiencia.", fecha: hoy }),
        ],
        false
      );
      assert.equal(r.nivel, "normal");
      assert.equal(r.fechaUltimaActuacion, hoy);
    });
  });
});

describe("extraerAsuntoDeCaratula", () => {
  test("extrae el asunto de un texto de caratula real", () => {
    const texto = `REPÚBLICA DEL ECUADOR
Función Judicial

UNIDAD JUDICIAL CIVIL CUENCA

Proceso número: 01333-2021-04213 (1) PRIMERA INSTANCIA
Fecha de ingreso: MIÉRCOLES 9 DE JUNIO DE 2021
Materia: CIVIL
Tipo de procedimiento: EJECUTIVO
Asunto: COBRO DE PAGARÉ A LA ORDEN
Actor: COOPERATIVA DE AHORRO Y CREDITO ERCO LTDA
DEMANDADO: MARIA NARCISA MOROCHO TOAPANTA`;

    assert.equal(extraerAsuntoDeCaratula(texto), "COBRO DE PAGARÉ A LA ORDEN");
  });

  test("devuelve null si no hay linea de asunto", () => {
    assert.equal(extraerAsuntoDeCaratula("Texto sin ese campo."), null);
  });

  test("devuelve null con texto vacio o indefinido", () => {
    assert.equal(extraerAsuntoDeCaratula(""), null);
    assert.equal(extraerAsuntoDeCaratula(undefined as any), null);
  });
});

describe("filtrarCandidatosReinicio", () => {
  const causaActual = "01333202104213";
  const fechaAbandono = "2022-01-15";
  const asunto = "COBRO DE PAGARÉ A LA ORDEN";

  function causa(overrides: Record<string, any> = {}) {
    return {
      idJuicio: "01333202299999",
      numeroProceso: "01333-2022-99999",
      accion: "Cobro de pagaré a la orden",
      fechaIngreso: "2022-06-01",
      judicatura: "UNIDAD JUDICIAL CIVIL CUENCA",
      estadoActual: "En trámite",
      ...overrides,
    };
  }

  test("incluye una causa con mismo asunto y fecha posterior al abandono", () => {
    const candidatos = filtrarCandidatosReinicio([causa()], asunto, fechaAbandono, causaActual);
    assert.equal(candidatos.length, 1);
    assert.equal(candidatos[0].idJuicio, "01333202299999");
  });

  test("ignora la comparacion de mayusculas/tildes al comparar el asunto", () => {
    const candidatos = filtrarCandidatosReinicio(
      [causa({ accion: "cobro de pagare a la orden" })],
      asunto,
      fechaAbandono,
      causaActual
    );
    assert.equal(candidatos.length, 1);
  });

  test("excluye causas con asunto distinto", () => {
    const candidatos = filtrarCandidatosReinicio(
      [causa({ accion: "Divorcio contencioso" })],
      asunto,
      fechaAbandono,
      causaActual
    );
    assert.equal(candidatos.length, 0);
  });

  test("excluye causas con fecha de ingreso anterior al abandono", () => {
    const candidatos = filtrarCandidatosReinicio(
      [causa({ fechaIngreso: "2021-06-09" })],
      asunto,
      fechaAbandono,
      causaActual
    );
    assert.equal(candidatos.length, 0);
  });

  test("excluye la propia causa actual aunque coincida en todo lo demas", () => {
    const candidatos = filtrarCandidatosReinicio(
      [causa({ idJuicio: causaActual, numeroProceso: "01333-2021-04213" })],
      asunto,
      fechaAbandono,
      causaActual
    );
    assert.equal(candidatos.length, 0);
  });

  test("devuelve varios candidatos ordenados por fecha de ingreso descendente", () => {
    const candidatos = filtrarCandidatosReinicio(
      [
        causa({ idJuicio: "A", fechaIngreso: "2022-06-01" }),
        causa({ idJuicio: "B", fechaIngreso: "2023-01-10" }),
      ],
      asunto,
      fechaAbandono,
      causaActual
    );
    assert.deepEqual(candidatos.map((c) => c.idJuicio), ["B", "A"]);
  });
});
