// Guia de audiencia unica (juicio ejecutivo por pagare) para el area legal de
// COOPERCO. Arma el BORRADOR que la abogada lleva a la audiencia.
//
// De donde sale cada dato:
//  - Del SATJE (prellenado, ver extraerDatosGuia): deudores y su calidad, valor
//    del pagare, fecha de presentacion de la demanda, quien contesto, juez,
//    fecha/hora/sala de la audiencia y la abogada de la cooperativa.
//  - De la abogada (formulario): datos del credito y excepciones planteadas,
//    porque en Cuenca la demanda y la contestacion se entregan en papel y el
//    SATJE solo guarda la hoja de recepcion.
//
// Los textos base salen de guias reales del area legal, sin datos personales.
// Todo lo que falte queda como [COMPLETAR: ...] y se resalta en el Word.

export type Abogada = "diana" | "veronica";
export type Trato = "juez" | "jueza";
export type RolDeudor = "principal" | "solidario";

export interface DeudorGuia {
  nombre: string;
  rol: RolDeudor;
}

export interface ModulosGuia {
  legitimacion: boolean; // falta de legitimacion / endoso del pagare
  requisitos: boolean; // al pagare le faltan requisitos (arts. 187-188 C. Comercio)
  falsedad: boolean; // nulidad formal o falsedad del titulo
  prescripcion: boolean;
  diferimiento: boolean; // el credito tuvo diferimiento extraordinario
}

export interface OposicionPrueba {
  pericia: boolean;
  testigos: boolean;
  declaracionGerente: boolean;
  oficios: boolean;
}

export interface DatosGuia {
  causa: string;
  abogada: Abogada;
  trato: Trato;
  deudores: DeudorGuia[];
  contestaron: string[];
  noComparecieron: string[];
  numeroPagare?: string;
  numeroEndoso?: string;
  fechaSuscripcion?: string; // YYYY-MM-DD
  montoPagare?: number;
  tasa?: string; // "17.5"
  tipoCredito?: string;
  plazo?: number;
  unidadPlazo?: "meses" | "dividendos";
  dividendosPagados?: number;
  dividendoMora?: number;
  fechaMora?: string;
  saldoCapital?: number;
  seguroDesgravamen?: boolean;
  reconoceDeuda?: boolean; // el deudor admite la deuda en su contestacion
  fechaPresentacionDemanda?: string;
  modulos: ModulosGuia;
  entidadOriginal?: string;
  fechaEndoso?: string;
  requisitoFechaLugar?: boolean;
  requisitoLugarPago?: boolean;
  oposicion?: OposicionPrueba;
  fechaUltimoPago?: string;
  dividendoUltimoPago?: number;
  fechaCitacion?: string;
  fechaDiferimiento?: string;
  audienciaFecha?: string;
  audienciaHora?: string;
  audienciaSala?: string;
  juezNombre?: string;
  ia?: AportesIA;
}

/** Lo que la IA sugirio a partir de la contestacion y la abogada dejo marcado. */
export interface AportesIA {
  puntos: { argumento: string; pagina?: number; respuesta: string }[];
  contradicciones: { texto: string; pagina?: number }[];
  otrasExcepciones: { nombre: string; resumen: string; pagina?: number }[];
}

export interface Trozo {
  t: string;
  completar?: boolean;
  negrita?: boolean;
  ia?: boolean; // redactado por IA: va en otro color y hay que revisarlo
}

export type Bloque =
  | { tipo: "titulo"; texto: string }
  | { tipo: "seccion"; texto: string }
  | { tipo: "parrafo"; trozos: Trozo[] }
  | { tipo: "lista"; items: Trozo[][] }
  | { tipo: "nota"; trozos: Trozo[] }; // instruccion para la abogada (cursiva, no se lee en voz alta)

export interface GuiaArmada {
  bloques: Bloque[];
  avisos: string[];
  faltantes: number;
}

export const ABOGADAS: Record<Abogada, { nombre: string; matricula: string }> = {
  diana: { nombre: "Diana Vera Saraguro", matricula: "01-2023-212" },
  veronica: { nombre: "Verónica González Vásquez", matricula: "01-2007-167" },
};

const COOPERATIVA = "Cooperativa de Ahorro y Crédito ERCO Ltda.";
const REPRESENTANTE = "Ing. Héctor Enerco Fajardo, Gerente y Representante Legal";

// ---------------------------------------------------------------------------
// Formatos: dinero, numeros en letras y fechas

export function formatoDinero(n: number): string {
  const [ent, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const ESPECIALES: Record<number, string> = {
  10: "DIEZ", 11: "ONCE", 12: "DOCE", 13: "TRECE", 14: "CATORCE", 15: "QUINCE",
  16: "DIECISÉIS", 17: "DIECISIETE", 18: "DIECIOCHO", 19: "DIECINUEVE", 20: "VEINTE",
  21: "VEINTIUNO", 22: "VEINTIDÓS", 23: "VEINTITRÉS", 24: "VEINTICUATRO", 25: "VEINTICINCO",
  26: "VEINTISÉIS", 27: "VEINTISIETE", 28: "VEINTIOCHO", 29: "VEINTINUEVE",
};
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function menorQueMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 10) partes.push(UNIDADES[r]);
    else if (r < 30) partes.push(ESPECIALES[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
    }
  }
  return partes.join(" ");
}

/** Entero en letras, en mayusculas (como en las guias). Apocopa UNO -> UN delante de MIL/MILLONES. */
export function enteroEnLetras(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const apocope = (s: string) => s.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocope(menorQueMil(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(menorQueMil(miles))} MIL`);
  if (resto) partes.push(menorQueMil(resto));
  return partes.join(" ");
}

/** "SEIS MIL QUINIENTOS DÓLARES DE LOS ESTADOS UNIDOS DE AMÉRICA CON 00/100 (USD $ 6.500,00)" */
export function montoEnLetras(n: number): string {
  const centavos = Math.round((Math.abs(n) - Math.floor(Math.abs(n))) * 100);
  const entero = Math.floor(Math.abs(n));
  const dolares = entero === 1 ? "DÓLAR" : "DÓLARES";
  const letras = enteroEnLetras(entero);
  const conDe = /(MILLÓN|MILLONES)$/.test(letras) ? `${letras} DE` : letras;
  return `${conDe} ${dolares} DE LOS ESTADOS UNIDOS DE AMÉRICA CON ${String(centavos).padStart(2, "0")}/100 (USD $ ${formatoDinero(n)})`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaValida(f?: string): f is string {
  if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

/** "2023-05-24" -> "24 de mayo de 2023" */
export function fechaLarga(f: string): string {
  const [a, m, d] = f.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function sumarAnios(f: string, anios: number): string {
  const [a, m, d] = f.split("-").map(Number);
  // 29 de febrero + n anios cae en 28 de febrero si el anio destino no es bisiesto
  const destino = new Date(Date.UTC(a + anios, m - 1, d));
  if (destino.getUTCMonth() !== m - 1) destino.setUTCDate(0);
  return destino.toISOString().slice(0, 10);
}

/** Fecha local de Ecuador (UTC-5) de un timestamp del SATJE. */
export function fechaEcuador(iso: string): string | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Armado de la guia

function minusculaInicial(s: string): string {
  // "El pagaré..." -> "el pagaré..."; deja siglas como "SEPS" intactas
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function hayTexto(v: unknown): boolean {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

function hayNumero(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function unirNombres(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

export function textoDeudores(deudores: DeudorGuia[]): string {
  const grupo = (rol: RolDeudor) => deudores.filter((d) => d.rol === rol).map((d) => d.nombre.toUpperCase());
  const principales = grupo("principal");
  const solidarios = grupo("solidario");
  const partes: string[] = [];
  if (principales.length) partes.push(`${unirNombres(principales)}, en calidad de ${principales.length > 1 ? "deudores principales" : "deudor principal"}`);
  if (solidarios.length) partes.push(`${unirNombres(solidarios)}, en calidad de ${solidarios.length > 1 ? "deudores solidarios" : "deudor solidario"}`);
  return partes.join("; y, ");
}

export function armarGuia(d: DatosGuia): GuiaArmada {
  const avisos: string[] = [];
  const faltan = new Set<string>();
  const bloques: Bloque[] = [];
  const T = d.trato === "jueza" ? "Señora Jueza" : "Señor Juez";
  const abogada = ABOGADAS[d.abogada] ?? ABOGADAS.diana;

  // Un dato del formulario: texto normal si existe, [COMPLETAR] resaltado si no.
  const v = (valor: unknown, etiqueta: string, formato?: (x: any) => string): Trozo => {
    if (!hayTexto(valor) || (typeof valor === "number" && !Number.isFinite(valor))) {
      faltan.add(etiqueta);
      return { t: `[COMPLETAR: ${etiqueta}]`, completar: true };
    }
    return { t: formato ? formato(valor) : String(valor) };
  };
  const fecha = (f: string | undefined, etiqueta: string): Trozo => (fechaValida(f) ? { t: fechaLarga(f) } : v(undefined, etiqueta));
  const p = (...partes: (string | Trozo)[]): Bloque => ({ tipo: "parrafo", trozos: partes.map((x) => (typeof x === "string" ? { t: x } : x)) });
  const nota = (texto: string): Bloque => ({ tipo: "nota", trozos: [{ t: texto }] });
  const seccion = (texto: string) => bloques.push({ tipo: "seccion", texto });

  const deudores = d.deudores.filter((x) => hayTexto(x.nombre));
  const deudoresTxt: Trozo = deudores.length ? { t: textoDeudores(deudores) } : v(undefined, "deudores y su calidad");
  const pagare = v(d.numeroPagare, "número de pagaré");
  const pagareCompleto: Trozo[] = hayTexto(d.numeroEndoso)
    ? [pagare, { t: `, por efectos del endoso ahora signado con el No. ${d.numeroEndoso}` }]
    : [pagare];
  const monto = v(d.montoPagare, "monto del pagaré", (n) => montoEnLetras(n));
  const montoCorto = v(d.montoPagare, "monto del pagaré", (n) => `USD $ ${formatoDinero(n)}`);
  const saldo = v(d.saldoCapital, "saldo de capital", (n) => montoEnLetras(n));
  const tasa = v(d.tasa, "tasa anual", (t) => `${String(t).replace(/%$/, "")}%`);
  const plazo = v(d.plazo, "plazo", (n) => `${n} ${d.unidadPlazo === "dividendos" ? "DIVIDENDOS" : "MESES"}`);
  const tipoCredito = v(d.tipoCredito, "tipo de crédito");
  const divMora = v(d.dividendoMora, "dividendo en mora");
  const ultimoDividendo = hayNumero(d.plazo) ? String(d.plazo) : null;
  const rangoMora: Trozo[] = ultimoDividendo
    ? [{ t: "desde el dividendo " }, divMora, { t: ` hasta el dividendo ${ultimoDividendo}` }]
    : [{ t: "desde el dividendo " }, divMora];
  const desgravamen = d.seguroDesgravamen !== false;

  const rubros = (): string =>
    `los intereses pactados desde la fecha de suscripción, es decir al ${hayTexto(d.tasa) ? `${String(d.tasa).replace(/%$/, "")}%` : "[tasa]"} anual hasta su total cancelación; los intereses de mora, que se calcularán desde la fecha de vencimiento hasta su total cancelación;${desgravamen ? " el seguro de desgravamen;" : ""} las costas procesales, que las reclamo expresamente por haber sido pactadas en el pagaré a la orden; y, los honorarios de la profesional del derecho que me patrocina`;

  // ---------------- Encabezado e instrucciones ----------------
  bloques.push({ tipo: "titulo", texto: "GUÍA DE AUDIENCIA ÚNICA" });
  const datosAud: string[] = [`Juicio ${d.causa}`];
  if (hayTexto(d.audienciaFecha)) datosAud.push(`Audiencia: ${d.audienciaFecha}${hayTexto(d.audienciaHora) ? `, ${d.audienciaHora}` : ""}`);
  if (hayTexto(d.audienciaSala)) datosAud.push(`Sala ${d.audienciaSala}`);
  if (hayTexto(d.juezNombre)) datosAud.push(`Juez(a): ${d.juezNombre}`);
  bloques.push(nota(datosAud.join(" · ")));

  // ---------------- Presentacion ----------------
  bloques.push(
    p(`Buenos días, ${T}, señor Secretario, personas aquí presentes. Para efectos de audio y registro me identifico como la abogada ${abogada.nombre}, con matrícula ${abogada.matricula} del Foro de Abogados del Azuay, y acudo a la presente diligencia en calidad de Procuradora Judicial del ${REPRESENTANTE} de la ${COOPERATIVA}`)
  );

  // ---------------- Excepciones ----------------
  const m = d.modulos;
  if (m.legitimacion || m.prescripcion || m.falsedad) {
    seccion(m.falsedad && !m.legitimacion && !m.prescripcion ? "EXCEPCIONES" : "EXCEPCIONES PREVIAS");
  }

  if (m.legitimacion) {
    bloques.push(p({ t: "Art. 153 numeral 3 COGEP - Falta de legitimación en la causa.", negrita: true }));
    bloques.push(
      p("La defensa de la parte demandada ha planteado como excepción previa una supuesta falta de legitimación. Confunde la legitimación activa con la supuesta falta de documentación habilitante, lo cual no constituye una excepción previa taxativa sino un argumento dilatorio. Solicito a Su Autoridad que rechace esta excepción previa con base en los siguientes fundamentos:")
    );
    bloques.push(
      p(
        "Conforme al artículo 189 del Código de Comercio vigente, son plenamente aplicables al pagaré a la orden las normas relativas al endoso de la letra de cambio. En concordancia con los artículos 104, 124, 127 y 129 del mismo Código, el pagaré número ",
        pagare,
        " es un título a la orden que fue transferido mediante endoso en propiedad el ",
        fecha(d.fechaEndoso, "fecha del endoso"),
        " por ",
        v(d.entidadOriginal, "entidad que endosó el pagaré"),
        ` a favor de mi representada, la ${COOPERATIVA} Este endoso consta de forma incondicional al reverso del título original, transmite todos los derechos resultantes del pagaré y constituye a mi representada en su portadora y tenedora legítima.`
      )
    );
    bloques.push(
      p(
        "Exigir que se adjunte una resolución administrativa como documento habilitante del pagaré viola los principios de autonomía y literalidad consagrados en los artículos 77 y 78 del Código de Comercio. Por mandato del artículo 129 en concordancia con el artículo 152 del mismo Código, en los títulos valores a la orden basta la regularidad formal de la cadena de endosos estampada en el mismo título para acreditar la legitimación activa. Si la parte demandada cuestiona la calidad o firma del endosante, le correspondía probarlo conforme al artículo 169 del COGEP, lo cual no ha hecho."
      )
    );
    if (d.reconoceDeuda) {
      bloques.push(
        p(`Por último, ${T}, en su propio escrito de contestación la parte demandada reconoce de manera expresa haber contraído el crédito original. No puede ahora desconocer la exigibilidad de una deuda cuya existencia ya aceptó.`)
      );
    }
  }

  if (m.prescripcion) {
    bloques.push(p({ t: "Prescripción.", negrita: true }));
    bloques.push(
      p(
        "El artículo 2392 del Código Civil señala que la prescripción es un modo de extinguir las acciones y derechos ajenos por no haberlos ejercido durante cierto lapso. El artículo 2415 establece que este tiempo es, en general, de cinco años para las acciones ejecutivas, contado desde que la obligación se haya hecho exigible. Y el artículo 2418 dispone que la prescripción puede interrumpirse natural o civilmente: naturalmente, por el hecho de reconocer el deudor la obligación, expresa o tácitamente; y civilmente, por la citación de la demanda judicial."
      )
    );
    bloques.push(
      p(
        "En el presente caso existe interrupción natural. De la revisión de la tabla de pagos adjunta al proceso se verifica que el ",
        fecha(d.fechaUltimoPago, "fecha del último pago"),
        " la parte deudora realizó el pago del dividendo ",
        v(d.dividendoUltimoPago, "número del dividendo pagado"),
        ". Con ese pago la parte demandada hizo un reconocimiento tácito de la obligación que mantiene con mi representada, y desde esa fecha el plazo de prescripción vuelve a contarse desde cero; como enseña la doctrina, la interrupción natural destruye retroactivamente el plazo transcurrido."
      )
    );
    const fPres = d.fechaPresentacionDemanda;
    const base = d.fechaUltimoPago;
    if (fechaValida(base) && fechaValida(fPres)) {
      if (sumarAnios(base, 5) > fPres) {
        bloques.push(
          p(
            "Contados desde ese reconocimiento, hasta la presentación de la demanda el ",
            { t: fechaLarga(fPres) },
            ", no han transcurrido los cinco años que exige el artículo 2415 del Código Civil. Además, la citación de la demanda interrumpió civilmente la prescripción conforme al artículo 2418 del mismo Código, con efecto a la fecha de presentación de la demanda."
          )
        );
      } else {
        avisos.push(
          `PRESCRIPCIÓN: incluso desde el último pago (${fechaLarga(base)}) hasta la presentación de la demanda (${fechaLarga(fPres)}) pasaron 5 años o más. La excepción del deudor podría prosperar: revisar con la abogada si hay otro reconocimiento de la deuda (abonos, convenios, refinanciamiento) posterior a esa fecha.`
        );
      }
    } else {
      avisos.push("PRESCRIPCIÓN: falta la fecha del último pago o la de presentación de la demanda; la app no pudo comprobar los 5 años.");
    }
    if (fechaValida(d.fechaMora) && fechaValida(fPres) && sumarAnios(d.fechaMora, 5) <= fPres) {
      avisos.push(
        `PRESCRIPCIÓN: desde que cayó en mora (${fechaLarga(d.fechaMora)}) hasta la demanda (${fechaLarga(fPres)}) pasaron más de 5 años. Por eso la guía NO dice que "no han transcurrido 5 años desde que se hizo exigible": ese argumento jugaría en contra. La defensa se apoya solo en la interrupción por el último pago.`
      );
    }
    bloques.push(p("Por lo manifestado, solicito se rechace la excepción de prescripción planteada por la parte demandada y se continúe con la tramitación de la causa."));
  }

  if (m.falsedad) {
    bloques.push(p({ t: "Nulidad formal o falsedad del título.", negrita: true }));
    bloques.push(
      p(
        `La parte demandada alega en su contestación nulidad formal o falsedad del título, lo cual es alejado de la realidad, pues el pagaré a la orden adjuntado al proceso reúne todos los requisitos determinados en el artículo 187 del Código de Comercio, y así lo consideró Su Autoridad al admitir a trámite la demanda. Los títulos valor incorporan un derecho literal y autónomo que se ejercita por su portador legitimado; se presume su autenticidad, así como la licitud de su causa.`
      )
    );
    bloques.push(
      p(
        `Debe considerarse, ${T}, que la excepción planteada contiene en realidad dos excepciones distintas, sin que se haya indicado con claridad si se trata de nulidad formal o de falsedad del título, lo que impide una defensa clara. En la nulidad formal debe faltar algún requisito que la ley prescribe para la validez del título, lo que no ocurre aquí. Un título es falso cuando no es auténtico, es decir, cuando no ha sido realmente otorgado por las personas y de la manera que en él se expresa, cosa que tampoco ha sucedido: no existe suplantación de personas, adulteraciones ni escritos sobre raspados que cambien la naturaleza del título.`
      )
    );
    bloques.push(
      p(
        "La falsedad está directamente relacionada con la alteración material del título. No es posible discutir en un procedimiento ejecutivo la falsedad ideológica, pues ello supone indagar la causa de la obligación, lo que excede el ámbito cognoscitivo de este procedimiento. Por lo expuesto, solicito se deseche la excepción presentada y se continúe con el proceso."
      )
    );
  }

  if (m.legitimacion || m.prescripcion || m.falsedad) {
    bloques.push(nota(`SI LA EXCEPCIÓN ES ACEPTADA: "${T}, conforme a lo establecido en el artículo 256 del Código Orgánico General de Procesos, apelo el auto interlocutorio emitido por Su Autoridad." Fundamentar de conformidad con el artículo 257 del COGEP.`));
  }

  if (d.ia && d.ia.otrasExcepciones.length) {
    bloques.push({ tipo: "nota", trozos: [{ t: "OTRAS EXCEPCIONES DEL DEUDOR sin texto modelo (detectadas por IA) — preparar respuesta:", ia: true, negrita: true }] });
    bloques.push({ tipo: "lista", items: d.ia.otrasExcepciones.map((o) => [{ t: `${o.nombre}: ${o.resumen}${o.pagina ? ` (pág. ${o.pagina})` : ""}`, ia: true }]) });
    avisos.push(`El deudor planteó excepciones que no están en las guías modelo (${d.ia.otrasExcepciones.map((o) => o.nombre).join(", ")}): hay que preparar la respuesta a mano.`);
  }

  // ---------------- Saneamiento ----------------
  seccion("SANEAMIENTO");
  bloques.push(
    p(
      `${T}, considerando que no existe vulneración de derechos constitucionales que afecte las garantías básicas del debido proceso, la tutela judicial efectiva y la seguridad jurídica, consagradas en los artículos 75, 76 y 82 de la Constitución de la República del Ecuador, ni omisión de solemnidades sustanciales previstas en el artículo 107 del COGEP, y por cuanto la competencia se ha radicado en Su Autoridad, solicito se declare la validez procesal de la causa y se continúe con el respectivo trámite.`
    )
  );

  // ---------------- Fijacion de puntos ----------------
  seccion("FIJACIÓN DE LOS PUNTOS EN DEBATE");
  bloques.push(
    p(
      `${T}, la presente demanda fue planteada para el cobro de la obligación contenida en el pagaré a la orden No. `,
      ...pagareCompleto,
      " por ",
      montoCorto,
      ": el saldo de capital pendiente de pago, que asciende a ",
      v(d.saldoCapital, "saldo de capital", (n) => `USD $ ${formatoDinero(n)}`),
      `; ${rubros()}.`
    )
  );
  bloques.push(nota(`Si Su Autoridad fija los puntos en debate y está bien: "Ninguna observación, ${T}, estoy de acuerdo con el objeto de la controversia fijado por Su Autoridad." Si no, precisarlo.`));

  // ---------------- Conciliacion ----------------
  seccion("CONCILIACIÓN");
  bloques.push(
    p(`${T}, COOPERCO es una institución abierta al diálogo. No obstante, para viabilizar un acuerdo, los demandados deben proponer una fórmula real que cubra el saldo de capital vencido, intereses y costas, debidamente garantizada. De lo contrario, solicitamos continuar con la fase correspondiente.`)
  );
  bloques.push(
    nota(
      `EN CASO DE ACUERDO DE PAGO: "${T}, solicitamos se apruebe el presente acuerdo (base legal: art. 235 COGEP; art. 66 numeral 29 literal d) de la Constitución; arts. 8 y 2348 del Código Civil; art. 130 numeral 11 del COFJ), sea elevado a la categoría de sentencia y surta los efectos de cosa juzgada (art. 2362 del Código Civil)."`
    )
  );

  // ---------------- Alegato de apertura ----------------
  seccion("ALEGATO DE APERTURA");
  bloques.push(
    p(
      deudoresTxt,
      `, solicitaron a la ${hayTexto(d.entidadOriginal) && m.legitimacion ? `${d.entidadOriginal}, ahora ${COOPERATIVA}` : COOPERATIVA}, un crédito de `,
      tipoCredito,
      ", el cual fue aceptado, por lo que el ",
      fecha(d.fechaSuscripcion, "fecha de suscripción"),
      " suscribieron un PAGARÉ A LA ORDEN con vencimientos sucesivos por la suma de ",
      monto,
      ", pactando un interés anual del ",
      tasa,
      `, que está por debajo de las tasas fijadas por el Banco Central del Ecuador para ese segmento de crédito${desgravamen ? ", más el seguro de desgravamen" : ""}, a ser cancelado en un plazo de `,
      plazo,
      ", de conformidad con el detalle de dividendos y fechas contenido en la TABLA DE AMORTIZACIÓN, que también fue suscrita por los deudores."
    )
  );
  if (m.diferimiento) {
    bloques.push(
      p(
        "Posteriormente, la parte deudora presentó el ",
        fecha(d.fechaDiferimiento, "fecha de la solicitud de diferimiento"),
        " una solicitud de diferimiento temporal y extraordinario de las cuotas de su crédito, petición que fue aceptada, generándose una nueva tabla de amortización."
      )
    );
  }
  bloques.push(
    p(
      "A pesar de los múltiples requerimientos realizados por nuestra institución, los deudores cancelaron ",
      v(d.dividendosPagados, "dividendos pagados"),
      " dividendos, quedando en mora desde el dividendo ",
      divMora,
      ", que debió cancelarse el ",
      fecha(d.fechaMora, "fecha de vencimiento del dividendo en mora"),
      ". Acorde con lo pactado en el pagaré, en caso de mora en el pago de uno o más dividendos puede declararse de plazo vencido la totalidad de la obligación. Haciendo uso legítimo de esa cláusula de aceleración, conforme al inciso segundo del artículo 348 del COGEP, la obligación es clara, pura, determinada, líquida, de plazo vencido y actualmente exigible."
    )
  );
  bloques.push(
    p(
      "Con los antecedentes expuestos, fundamentado en los artículos 75, 76 y 82 de la Constitución de la República, los artículos 347, 348 y 349 del Código Orgánico General de Procesos y los artículos 186, 187, 189 y más pertinentes del Código de Comercio, DEMANDO a ",
      deudoresTxt,
      ", para que Su Autoridad, mediante sentencia, ordene el pago del saldo de capital ",
      ...rangoMora,
      ", equivalente a ",
      saldo,
      `; ${rubros()}.`
    )
  );
  bloques.push(p(`Esta es nuestra pretensión, ${T}.`));

  // ---------------- Prueba ----------------
  seccion("ANUNCIO DE LOS MEDIOS DE PRUEBA");
  bloques.push(p("De conformidad con el artículo 142 numeral 7 del Código Orgánico General de Procesos, anuncio como medios de prueba a mi favor los siguientes, que corresponden a prueba documental:"));
  const itemsPrueba: Trozo[][] = [
    [
      { t: "PAGARÉ A LA ORDEN No. " },
      ...pagareCompleto,
      { t: ", por " },
      monto,
      { t: ", debidamente suscrito por " },
      deudoresTxt,
      { t: ". Documento con el que justificaré la existencia de la obligación reclamada y la facultad que me asiste de declarar de plazo vencido la totalidad de la obligación." },
    ],
    [{ t: "TABLA DE AMORTIZACIÓN, en la que se detallan los dividendos a cancelar, parte integrante del referido pagaré y suscrita por los demandados, con la que demostraré que aceptaron cancelar la obligación en la forma detallada en ella." }],
  ];
  if (m.diferimiento) {
    itemsPrueba.push([{ t: "SOLICITUD DE DIFERIMIENTO TEMPORAL Y EXTRAORDINARIO DEL CRÉDITO presentada por la parte deudora el " }, fecha(d.fechaDiferimiento, "fecha de la solicitud de diferimiento"), { t: "." }]);
    itemsPrueba.push([{ t: "TABLA DE AMORTIZACIÓN MODIFICADA por efecto del diferimiento, con la que justificaré que la parte deudora aceptó cancelar la obligación en la forma allí detallada." }]);
  }
  itemsPrueba.push([{ t: "TABLA DE PAGOS REALIZADOS, en una foja, con la que demostraré que los demandados cancelaron parcialmente su obligación, que se encuentran pendientes de pago varios dividendos y que, como efecto de la mora, se declaró de plazo vencido la totalidad de la obligación." }]);
  bloques.push({ tipo: "lista", items: itemsPrueba });
  bloques.push(p(`Este es mi anuncio de prueba, ${T}.`));

  // ---------------- Oposicion a la prueba del deudor ----------------
  const op = d.oposicion;
  if (op && (op.pericia || op.testigos || op.declaracionGerente || op.oficios)) {
    seccion("OPOSICIÓN A LA PRUEBA DE LA PARTE DEMANDADA");
    bloques.push(
      p("La parte demandada ha solicitado prueba que no está directamente relacionada con la controversia principal, que es el pago de la obligación constante en el pagaré a la orden. La prueba debe ser pertinente, útil y conducente para esclarecer los hechos objeto del litigio:")
    );
    const itemsOp: Trozo[][] = [];
    if (op.oficios) itemsOp.push([{ t: "Oficios y certificados solicitados: me opongo por ser prueba impertinente, inconducente e inútil, pues no se refieren al objeto de la controversia, que es el pago de la obligación." }]);
    if (op.pericia)
      itemsOp.push([
        {
          t: "Informe pericial: objeto esta prueba. Conforme al artículo 159 del COGEP, la prueba documental con que cuenten las partes debe adjuntarse a la contestación, y la parte que no tiene acceso al objeto de la pericia debe justificarlo y pedir su práctica en ese momento. La parte demandada, teniendo acceso a la documentación, no lo hizo en el momento procesal oportuno. Además, una pericia grafotécnica debe realizarse sobre el documento original: un estudio sobre copias o fotografías solo permite análisis generales de la escritura.",
        },
      ]);
    if (op.declaracionGerente)
      itemsOp.push([{ t: "Declaración de parte del Gerente: me opongo, pues conforme al artículo 187 del COGEP solo puede declararse sobre los hechos controvertidos, y en concordancia con el artículo 177 numeral 4, el Gerente no intervino personalmente en los hechos controvertidos." }]);
    if (op.testigos)
      itemsOp.push([{ t: "Prueba testimonial: me opongo, pues los testimonios propuestos no se refieren al objeto de la controversia (el pago de la obligación); y si se trata de familiares de la parte demandada, sus testimonios son parcializados." }]);
    bloques.push({ tipo: "lista", items: itemsOp });
    if (op.pericia) {
      bloques.push(nota("PREGUNTAS SUGERIDAS AL PERITO (adaptar al informe):"));
      bloques.push({
        tipo: "lista",
        items: [
          [{ t: "¿Su análisis se realizó sobre los documentos originales o sobre copias o fotografías? ¿No considera que esto limita la fiabilidad de sus conclusiones?" }],
          [{ t: "¿Qué características de la firma analizó? ¿Por qué no incluyó la presión del trazo, la velocidad de ejecución, la proporción y el espaciamiento?" }],
          [{ t: "¿De dónde obtuvo las firmas indubitadas con las que comparó? ¿Constan en este proceso?" }],
        ],
      });
    }
    if (op.testigos) {
      bloques.push(nota("PREGUNTAS SUGERIDAS A LOS TESTIGOS:"));
      bloques.push({
        tipo: "lista",
        items: [
          [{ t: "¿Tiene algún vínculo familiar o de amistad con la parte demandada?" }],
          [{ t: "¿Le consta personalmente que la firma del pagaré no es de la parte demandada? ¿Estuvo presente cuando se suscribió?" }],
        ],
      });
    }
  }

  // ---------------- Produccion ----------------
  seccion("PRODUCCIÓN DE LA PRUEBA");
  bloques.push(p("De acuerdo con el anuncio realizado, procedo a producir la prueba conforme lo determina el artículo 196 numeral 1 del COGEP, exhibiendo los siguientes documentos:"));
  const itemsProd: Trozo[][] = [[{ t: "PAGARÉ A LA ORDEN No. " }, ...pagareCompleto, { t: ", por " }, montoCorto, { t: "." }], [{ t: "TABLA DE AMORTIZACIÓN." }]];
  if (m.diferimiento) itemsProd.push([{ t: "SOLICITUD DE DIFERIMIENTO y TABLA DE AMORTIZACIÓN MODIFICADA." }]);
  itemsProd.push([{ t: "TABLA DE PAGOS REALIZADOS." }]);
  bloques.push({ tipo: "lista", items: itemsProd });

  // ---------------- Alegato final ----------------
  seccion("ALEGATO FINAL");
  bloques.push(p(`Muchas gracias, ${T}. Ratifico que los presupuestos fácticos y jurídicos de nuestra demanda han quedado plenamente demostrados en esta audiencia.`));
  if (m.requisitos) {
    bloques.push(
      p(
        "El pagaré a la orden No. ",
        pagare,
        ", base de esta demanda, cumple con los requisitos del artículo 187 del Código de Comercio: la denominación del documento inserta en su texto, la promesa incondicional de pagar una suma determinada, la indicación del vencimiento, el lugar donde debe efectuarse el pago, el nombre de la persona a cuya orden debe efectuarse, la fecha y el lugar de suscripción y la firma de los deudores."
      )
    );
    if (d.requisitoFechaLugar !== false) {
      bloques.push(p("La parte demandada alega que el pagaré carece de fecha y lugar de suscripción. Esta afirmación se desvanece con la sola revisión del título que consta en autos y que fue producido como prueba en esta audiencia: el documento cuenta de manera clara con la fecha y el lugar donde fue suscrito, cumpliendo el literal g) del artículo 187 del Código de Comercio."));
    }
    if (d.requisitoLugarPago) {
      bloques.push(
        p("Respecto del lugar de pago (literal e del artículo 187), aun si faltara, el artículo 188 del mismo Código establece la regla de suplencia legal: a falta de indicación especial, el lugar de emisión del documento se considera lugar del pago y, al propio tiempo, domicilio del suscriptor. La ley suple de pleno derecho cualquier omisión de ese tipo y el título mantiene intacta su fuerza ejecutiva conforme a los artículos 347 y 348 del COGEP.")
      );
    }
  }
  if (m.legitimacion) {
    bloques.push(
      p(
        `Ha quedado acreditado documentalmente que la ${COOPERATIVA} es la portadora y tenedora legítima del pagaré a la orden No. `,
        pagare,
        ", en virtud del endoso estampado en su reverso el ",
        fecha(d.fechaEndoso, "fecha del endoso"),
        ", que cumple con los artículos 77, 104, 124, 129 y 189 del Código de Comercio. Las alegaciones sobre una supuesta falta de legitimación carecen de todo asidero legal y fáctico."
      )
    );
  }
  if (m.falsedad) {
    bloques.push(
      p("La parte demandada alegó nulidad formal o falsedad del título sin precisar cuál de las dos causales invoca, y nada ha logrado demostrar al respecto: la prueba que presentó no acredita la inexistencia de la obligación, y la prueba pericial no fue introducida al proceso conforme lo exige el artículo 159 del COGEP.")
    );
  }
  if (d.reconoceDeuda) {
    bloques.push(p("Más aún, la propia parte demandada, en su escrito de contestación, reconoce de manera expresa haber contraído este crédito y mantener una obligación pendiente de pago. Quien reconoce haber recibido el dinero y haber suscrito la obligación no puede pretender evadir su responsabilidad."));
  }
  bloques.push(
    p(
      "Mi representada, con los documentos aparejados a la demanda, ha demostrado que el pagaré a la orden es un título ejecutivo que contiene una obligación clara, pura, determinada y actualmente exigible; con la tabla de amortización se demostraron las fechas y cantidades que los demandados debían cancelar; y con la tabla de pagos, que se encuentran pendientes de pago los dividendos ",
      divMora,
      ...(ultimoDividendo ? [{ t: ` al ${ultimoDividendo}` }] : []),
      `. Por lo señalado, solicito a Su Autoridad acepte la demanda y ordene el pago inmediato de cada uno de los rubros reclamados: el saldo de capital a la presente fecha por `,
      saldo,
      `; ${rubros()}.`
    )
  );
  const noVinieron = d.noComparecieron.filter((x) => hayTexto(x));
  if (m.falsedad && noVinieron.length > 0 && noVinieron.length < deudores.length) {
    bloques.push(
      p(
        `En el caso de dar paso a la pretensión de la parte demandada, solicito se tenga en consideración lo establecido en los artículos 121 y 189 del Código de Comercio y se ordene el pago de lo solicitado a ${unirNombres(noVinieron.map((n) => n.toUpperCase()))}, quienes a pesar de haber sido citados legalmente no han comparecido al proceso ni han presentado excepción alguna.`
      )
    );
  }
  const ia = d.ia;
  const pag = (n?: number) => (n ? ` (pág. ${n} de la contestación)` : "");
  if (ia && ia.puntos.length) {
    bloques.push({ tipo: "nota", trozos: [{ t: "RESPUESTA A LOS ARGUMENTOS DEL DEUDOR — sugerido por IA a partir de su contestación. REVISAR antes de usar:", ia: true, negrita: true }] });
    bloques.push({
      tipo: "lista",
      items: ia.puntos.map((x) => [
        { t: `La parte demandada alega que ${minusculaInicial(x.argumento.replace(/\.$/, ""))}${pag(x.pagina)}. `, ia: true },
        { t: x.respuesta, ia: true },
      ]),
    });
  }
  if (ia && ia.contradicciones.length) {
    bloques.push({ tipo: "nota", trozos: [{ t: "CONTRADICCIONES Y ADMISIONES DEL DEUDOR para destacar — sugerido por IA. REVISAR:", ia: true, negrita: true }] });
    bloques.push({ tipo: "lista", items: ia.contradicciones.map((c) => [{ t: `${c.texto}${pag(c.pagina)}`, ia: true }]) });
  }
  bloques.push(p(`Ese ha sido mi alegato de cierre, ${T}. Devuelvo la palabra a Su Autoridad.`));

  // ---------------- Frases de reserva ----------------
  seccion("FRASES DE RESERVA");
  bloques.push(
    nota(
      `SI LA PARTE DEMANDADA NO ASISTE A LA AUDIENCIA: "${T}, en virtud de que la parte demandada no ha comparecido a esta audiencia ni ha justificado su ausencia, solicito expresamente que se la condene al pago de las costas procesales, de conformidad con el artículo 86 del Código Orgánico General de Procesos."`
    )
  );
  bloques.push(nota(`EN CASO DE APELACIÓN: "${T}, conforme a lo establecido en el artículo 256 del Código Orgánico General de Procesos, apelo la decisión emitida por Su Autoridad."`));

  if (d.ia && (d.ia.puntos.length || d.ia.contradicciones.length || d.ia.otrasExcepciones.length)) {
    avisos.push("Las partes en MORADO las redactó la IA leyendo la contestación: revisarlas y corregirlas antes de la audiencia.");
  }

  // ---------------- Revision de coherencia ----------------
  avisos.push(...revisarCoherencia(d));
  return { bloques, avisos, faltantes: faltan.size };
}

/** Revisiones que no dependen de un modulo: montos, fechas y numeros de dividendo. */
export function revisarCoherencia(d: DatosGuia): string[] {
  const a: string[] = [];
  if (hayNumero(d.saldoCapital) && hayNumero(d.montoPagare) && d.saldoCapital > d.montoPagare) {
    a.push(`El saldo de capital (USD ${formatoDinero(d.saldoCapital)}) es MAYOR que el monto del pagaré (USD ${formatoDinero(d.montoPagare)}). Revisar.`);
  }
  if (hayNumero(d.dividendosPagados) && hayNumero(d.dividendoMora) && d.dividendoMora !== d.dividendosPagados + 1) {
    a.push(`Se pagaron ${d.dividendosPagados} dividendos pero la mora empieza en el dividendo ${d.dividendoMora} (lo normal sería el ${d.dividendosPagados + 1}). Revisar, salvo que haya un abono parcial.`);
  }
  if (hayNumero(d.dividendoMora) && hayNumero(d.plazo) && d.unidadPlazo !== "meses" && d.dividendoMora > d.plazo) {
    a.push(`El dividendo en mora (${d.dividendoMora}) es mayor que el total de dividendos (${d.plazo}).`);
  }
  if (fechaValida(d.fechaMora) && fechaValida(d.fechaSuscripcion) && d.fechaMora <= d.fechaSuscripcion) {
    a.push("La fecha de mora es anterior a la fecha de suscripción del pagaré.");
  }
  if (fechaValida(d.fechaMora) && fechaValida(d.fechaPresentacionDemanda) && d.fechaMora > d.fechaPresentacionDemanda) {
    a.push("La fecha de mora es posterior a la presentación de la demanda.");
  }
  const tasa = Number(String(d.tasa ?? "").replace(",", ".").replace("%", ""));
  if (hayTexto(d.tasa) && (!Number.isFinite(tasa) || tasa <= 0 || tasa > 35)) {
    a.push(`La tasa "${d.tasa}" no parece una tasa anual válida.`);
  }
  if (d.modulos.prescripcion && !fechaValida(d.fechaUltimoPago)) {
    // ya avisado en el modulo
  }
  if (!d.deudores.some((x) => hayTexto(x.nombre))) a.push("No hay deudores: escribirlos en el formulario.");
  return a;
}

// ---------------------------------------------------------------------------
// Prellenado desde las actuaciones del SATJE

export interface PrellenadoGuia {
  deudores: DeudorGuia[];
  contestaron: string[];
  noComparecieron: string[];
  contestacionConocida: boolean;
  montoPagare?: number;
  fechaPresentacionDemanda?: string;
  juezNombre?: string;
  trato?: Trato;
  tratoSeguro: boolean;
  abogada?: Abogada;
  audienciaFecha?: string;
  audienciaHora?: string;
  audienciaSala?: string;
  hayExcepcionesPrevias: boolean;
  audienciaConvocada: boolean;
}

export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-ZÑ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mismaPersona(a: string, b: string): boolean {
  const pa = normalizarNombre(a).split(" ").filter(Boolean).sort().join(" ");
  const pb = normalizarNombre(b).split(" ").filter(Boolean).sort().join(" ");
  return pa.length > 0 && pa === pb;
}

const NO_NOMBRE = new Set(["CON", "DEL", "LOS", "LAS", "SUS", "CC", "EN", "SU", "DE", "LA", "Y"]);

function nombresEnMayusculas(trozo: string): string[] {
  const encontrados = trozo.match(/[A-ZÁÉÍÓÚÑÜ]{2,}(?:\s+[A-ZÁÉÍÓÚÑÜ]{2,}){1,5}/g) ?? [];
  return encontrados
    .map((n) => n.split(/\s+/).filter((w) => !NO_NOMBRE.has(w)).join(" "))
    .filter((n) => n.split(" ").length >= 2);
}

/** Deudores y su calidad, desde el auto de calificacion de la demanda. */
export function extraerDeudores(texto: string): DeudorGuia[] {
  const i = texto.search(/en contra de/i);
  if (i < 0) return [];
  let tramo = texto.slice(i + "en contra de".length, i + 900);
  const fin = tramo.search(/una vez examinada|por considerar|c[ií]tese|VISTOS/i);
  if (fin > 0) tramo = tramo.slice(0, fin);
  const resultado: DeudorGuia[] = [];
  const re = /en (?:su )?calidad de\s+(deudor[ae]?s?\s+(?:principal(?:es)?|solidari[oa]s?)|garantes?|codeudor[ae]?s?)/gi;
  let desde = 0;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(tramo))) {
    const rol: RolDeudor = /principal/i.test(mm[1]) ? "principal" : "solidario";
    for (const n of nombresEnMayusculas(tramo.slice(desde, mm.index))) {
      if (!resultado.some((r) => mismaPersona(r.nombre, n))) resultado.push({ nombre: n, rol });
    }
    desde = mm.index + mm[0].length;
  }
  if (resultado.length === 0) {
    for (const n of nombresEnMayusculas(tramo)) resultado.push({ nombre: n, rol: "principal" });
  }
  return resultado;
}

/** "6500,00", "6.500,00", "6,500.00" -> 6500 */
export function leerNumeroMonto(s: string): number | undefined {
  let x = s.trim().replace(/[^\d.,]/g, "");
  if (!x) return undefined;
  const ultimaComa = x.lastIndexOf(",");
  const ultimoPunto = x.lastIndexOf(".");
  const decimalPos = Math.max(ultimaComa, ultimoPunto);
  if (decimalPos >= 0 && x.length - decimalPos - 1 === 2) {
    x = x.slice(0, decimalPos).replace(/[.,]/g, "") + "." + x.slice(decimalPos + 1);
  } else {
    x = x.replace(/[.,]/g, "");
  }
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function extraerDatosGuia(actuaciones: any[], causa: string): PrellenadoGuia {
  const sin = String(causa).replace(/\D/g, "");
  const judPrincipal = sin.slice(0, 5);
  const delPrincipal = (actuaciones ?? []).filter((a) => !judPrincipal || String(a?.idJudicatura ?? "").trim() === judPrincipal);
  const lista = delPrincipal.length ? delPrincipal : actuaciones ?? [];
  const txt = (a: any) => String(a?.actividad ?? "");
  const tipo = (a: any) => String(a?.tipo ?? "").toUpperCase();
  const porFecha = [...lista].sort((x, y) => String(x?.fecha ?? "").localeCompare(String(y?.fecha ?? "")));

  const r: PrellenadoGuia = {
    deudores: [],
    contestaron: [],
    noComparecieron: [],
    contestacionConocida: false,
    tratoSeguro: false,
    hayExcepcionesPrevias: false,
    audienciaConvocada: false,
  };

  // Deudores: auto de calificacion de la demanda (el primero que los traiga)
  for (const a of porFecha) {
    if (!/CALIFICACION|ACTA GENERAL/.test(tipo(a))) continue;
    const ds = extraerDeudores(txt(a));
    if (ds.length) {
      r.deudores = ds;
      break;
    }
  }

  // Acta de sorteo: fecha de presentacion, valor del pagare, juez
  const sorteo = porFecha.find((a) => tipo(a).includes("ACTA DE SORTEO"));
  if (sorteo) {
    r.fechaPresentacionDemanda = fechaEcuador(String(sorteo.fecha ?? ""));
    const mMonto = txt(sorteo).match(/PAGAR[EÉ][^$\n]{0,60}\$\s*([\d.,]+)/i);
    if (mMonto) r.montoPagare = leerNumeroMonto(mMonto[1]);
    const mJuez = txt(sorteo).match(/Juez\(a\):\s*([^.\n]+?)\.\s/i);
    if (mJuez) r.juezNombre = mJuez[1].trim();
    if (!r.deudores.length) {
      const mContra = txt(sorteo).match(/en contra de:\s*([^.\n]+)\./i);
      if (mContra) r.deudores = mContra[1].split(",").map((n) => ({ nombre: n.trim(), rol: "principal" as RolDeudor })).filter((d) => d.nombre);
    }
  }

  // Trato: lo que el propio juez de la causa escribe en sus autos
  const autos = lista.filter((a) => /AUTO|SENTENCIA|ACTA GENERAL/.test(tipo(a))).map(txt).join("\n");
  const fem = (autos.match(/\bJUEZA\b/gi) ?? []).length;
  const masc = (autos.match(/\b(?:calidad de Juez|JUEZ PONENTE:\s*DR\.|EL JUEZ)\b/gi) ?? []).length;
  if (fem && !masc) {
    r.trato = "jueza";
    r.tratoSeguro = true;
  } else if (masc && !fem) {
    r.trato = "juez";
    r.tratoSeguro = true;
  }

  // Convocatoria a audiencia (la mas reciente)
  const convocatorias = porFecha.filter((a) => /AUDIENCIA/i.test(tipo(a) + " " + txt(a)) && /convoca|se[ñn]ala/i.test(txt(a)));
  const conv = convocatorias[convocatorias.length - 1];
  if (conv) {
    const t = txt(conv).replace(/\s+/g, " ");
    const mDia = t.match(/para\s+(?:el\s+)?d[ií]a\s+(.+?),?\s+a\s+las\s+(\d{1,2}\s*[hH:]\s*\d{2})/i);
    if (mDia) {
      r.audienciaConvocada = true;
      r.audienciaFecha = mDia[1].trim();
      r.audienciaHora = mDia[2].replace(/\s+/g, "").toUpperCase();
    }
    const mSala = t.match(/Sala de Audiencias?\s*N[º°o.]*\s*(\d+)/i);
    if (mSala) r.audienciaSala = mSala[1];
    r.hayExcepcionesPrevias = /presentaci[oó]n de excepciones previas/i.test(t);
  }

  // Quien contesto: autos y razones que hablan de comparecencia o contestacion
  const frases = lista
    .map(txt)
    .join("\n")
    .replace(/\s+/g, " ")
    .match(/(?:contestaci[oó]n (?:dada|presentada) por|compareci[oó]|comparecencia de|habiendo comparecido)[^.;]{0,220}/gi) ?? [];
  if (frases.length) {
    r.contestacionConocida = true;
    const juntas = normalizarNombre(frases.join(" "));
    for (const d of r.deudores) {
      const palabras = normalizarNombre(d.nombre).split(" ");
      const estan = palabras.length >= 2 && palabras.every((w) => juntas.includes(w));
      (estan ? r.contestaron : r.noComparecieron).push(d.nombre);
    }
  }

  // Abogada de la cooperativa: la que recibe las notificaciones de ERCO
  const notif = lista.map(txt).join("\n").match(/ERCO[^;]{0,250}?del Dr\.\/Ab\.\s*([^;]+);/i);
  if (notif) {
    const n = normalizarNombre(notif[1]);
    if (n.includes("VERA") && n.includes("DIANA")) r.abogada = "diana";
    else if (n.includes("GONZALEZ") && n.includes("VERONICA")) r.abogada = "veronica";
  }
  return r;
}

// ---------------------------------------------------------------------------
// Validacion de lo que llega del formulario (nunca se confia en el navegador)

function texto(v: unknown, max = 200): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
  return s || undefined;
}

function numero(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v !== "string" || !v.trim()) return undefined;
  return leerNumeroMonto(v) ?? (/^\s*0+([.,]0+)?\s*$/.test(v) ? 0 : undefined);
}

function entero(v: unknown): number | undefined {
  const n = numero(v);
  return n === undefined ? undefined : Math.round(n);
}

function fechaForm(v: unknown): string | undefined {
  const s = texto(v, 10);
  return fechaValida(s) ? s : undefined;
}

const si = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";

export function sanearDatosGuia(b: any): DatosGuia {
  const deudores: DeudorGuia[] = (Array.isArray(b?.deudores) ? b.deudores : [])
    .slice(0, 12)
    .map((x: any) => ({ nombre: texto(x?.nombre, 120) ?? "", rol: x?.rol === "solidario" ? "solidario" : "principal" }) as DeudorGuia)
    .filter((x: DeudorGuia) => x.nombre);
  const nombres = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => texto(x, 120)).filter((x): x is string => Boolean(x)).slice(0, 12);
  const m = b?.modulos ?? {};
  const op = b?.oposicion ?? {};
  return {
    causa: texto(b?.causa, 40) ?? "",
    abogada: b?.abogada === "veronica" ? "veronica" : "diana",
    trato: b?.trato === "jueza" ? "jueza" : "juez",
    deudores,
    contestaron: nombres(b?.contestaron),
    noComparecieron: nombres(b?.noComparecieron),
    numeroPagare: texto(b?.numeroPagare, 40),
    numeroEndoso: texto(b?.numeroEndoso, 40),
    fechaSuscripcion: fechaForm(b?.fechaSuscripcion),
    montoPagare: numero(b?.montoPagare),
    tasa: texto(b?.tasa, 10)?.replace(",", "."),
    tipoCredito: texto(b?.tipoCredito, 80),
    plazo: entero(b?.plazo),
    unidadPlazo: b?.unidadPlazo === "meses" ? "meses" : "dividendos",
    dividendosPagados: entero(b?.dividendosPagados),
    dividendoMora: entero(b?.dividendoMora),
    fechaMora: fechaForm(b?.fechaMora),
    saldoCapital: numero(b?.saldoCapital),
    seguroDesgravamen: si(b?.seguroDesgravamen),
    reconoceDeuda: si(b?.reconoceDeuda),
    fechaPresentacionDemanda: fechaForm(b?.fechaPresentacionDemanda),
    modulos: {
      legitimacion: si(m.legitimacion),
      requisitos: si(m.requisitos),
      falsedad: si(m.falsedad),
      prescripcion: si(m.prescripcion),
      diferimiento: si(m.diferimiento),
    },
    entidadOriginal: texto(b?.entidadOriginal, 160),
    fechaEndoso: fechaForm(b?.fechaEndoso),
    requisitoFechaLugar: si(b?.requisitoFechaLugar),
    requisitoLugarPago: si(b?.requisitoLugarPago),
    oposicion: { pericia: si(op.pericia), testigos: si(op.testigos), declaracionGerente: si(op.declaracionGerente), oficios: si(op.oficios) },
    fechaUltimoPago: fechaForm(b?.fechaUltimoPago),
    dividendoUltimoPago: entero(b?.dividendoUltimoPago),
    fechaCitacion: fechaForm(b?.fechaCitacion),
    fechaDiferimiento: fechaForm(b?.fechaDiferimiento),
    audienciaFecha: texto(b?.audienciaFecha, 120),
    audienciaHora: texto(b?.audienciaHora, 20),
    audienciaSala: texto(b?.audienciaSala, 20),
    juezNombre: texto(b?.juezNombre, 120),
    ia: sanearAportesIA(b?.ia),
  };
}

function sanearAportesIA(v: any): AportesIA | undefined {
  if (!v || typeof v !== "object") return undefined;
  const pag = (n: unknown) => {
    const x = Number(n);
    return Number.isInteger(x) && x > 0 && x < 500 ? x : undefined;
  };
  const lista = (x: unknown) => (Array.isArray(x) ? x : []);
  const ia: AportesIA = {
    puntos: lista(v.puntos)
      .slice(0, 8)
      .map((x: any) => ({ argumento: texto(x?.argumento, 300) ?? "", pagina: pag(x?.pagina), respuesta: texto(x?.respuesta, 900) ?? "" }))
      .filter((x) => x.argumento && x.respuesta),
    contradicciones: lista(v.contradicciones)
      .slice(0, 5)
      .map((x: any) => ({ texto: texto(x?.texto, 400) ?? "", pagina: pag(x?.pagina) }))
      .filter((x) => x.texto),
    otrasExcepciones: lista(v.otrasExcepciones)
      .slice(0, 6)
      .map((x: any) => ({ nombre: texto(x?.nombre, 80) ?? "", resumen: texto(x?.resumen, 300) ?? "", pagina: pag(x?.pagina) }))
      .filter((x) => x.nombre),
  };
  return ia.puntos.length || ia.contradicciones.length || ia.otrasExcepciones.length ? ia : undefined;
}
