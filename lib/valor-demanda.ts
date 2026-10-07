// Valor (cuantia) por el que se demanda, leido de los documentos del expediente.
//
// SATJE no entrega ese dato como campo: esta en el texto de la demanda o de los
// autos del inicio. Se lee con un modelo de lenguaje, pero NADA de lo que diga se
// acepta sin comprobar: el valor tiene que figurar literalmente en el documento.

export interface DocTexto {
  codigoActuacion: string | number;
  tipo: string;
  fecha: string | null;
  nombreArchivo?: string;
  texto: string;
}

export interface ValorDemanda {
  encontrado: boolean;
  valor?: number;
  moneda?: string;
  concepto?: string;
  evidencia?: string;
  fuente?: { codigoActuacion: string | number; tipo: string; fecha: string | null; nombreArchivo?: string };
  motivo?: string;
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

// Actuaciones del inicio del juicio cuyo documento puede traer la cuantia: la
// demanda y los autos de calificacion o mandamiento. Se descartan sorteos,
// caratulas y razones, que no la traen.
export function elegirActuacionesParaValor(actuaciones: any[], max: number = 3): any[] {
  const candidatas = (actuaciones ?? []).filter((a) => {
    if (a?.codigo === undefined || a?.codigo === null) return false;
    const tipo = normalizar(String(a?.tipo ?? ""));
    return ["ESCRITO", "CALIFICACION", "DEMANDA", "MANDAMIENTO"].some((p) => tipo.includes(p));
  });
  candidatas.sort((x, y) => String(x?.fecha ?? "").localeCompare(String(y?.fecha ?? "")));
  return candidatas.slice(0, max);
}

function agrupar(entero: number, separador: string): string {
  return String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, separador);
}

// Comprueba que el valor aparece en el texto en alguno de los formatos habituales
// (5234.10, 5.234,10, 5,234.10). Un numero dentro de otro mayor no cuenta.
export function valorApareceEnTexto(valor: number, texto: string): boolean {
  if (!Number.isFinite(valor) || !texto) return false;
  const entero = Math.trunc(valor);
  const decimales = String(Math.round((valor - entero) * 100)).padStart(2, "0");
  const formas = [
    `${entero}.${decimales}`,
    `${entero},${decimales}`,
    `${agrupar(entero, ",")}.${decimales}`,
    `${agrupar(entero, ".")},${decimales}`,
  ];
  if (decimales === "00") formas.push(String(entero), agrupar(entero, ","), agrupar(entero, "."));
  return formas.some((f) => {
    const esc = f.replace(/[.,]/g, (c) => "\\" + c);
    return new RegExp(`(?<![\\d.,])${esc}(?!\\d|[.,]\\d)`).test(texto);
  });
}

export function interpretarRespuestaValor(respuesta: any, docs: DocTexto[]): ValorDemanda {
  if (!respuesta || respuesta.encontrado !== true) {
    return { encontrado: false, motivo: "No se encontró el valor de la demanda en los documentos del inicio del juicio." };
  }
  const valor = typeof respuesta.valor === "number" ? respuesta.valor : Number(String(respuesta.valor ?? "").replace(/[^\d.]/g, "") || NaN);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { encontrado: false, motivo: "El modelo no entregó un valor numérico válido." };
  }

  // El documento que cito el modelo primero; si el valor no esta ahi, se busca en los demas.
  const indice = Number.isInteger(respuesta.documento) ? respuesta.documento : -1;
  const orden = [...(docs[indice] ? [docs[indice]] : []), ...docs.filter((_, i) => i !== indice)];
  const doc = orden.find((d) => valorApareceEnTexto(valor, d.texto));
  if (!doc) {
    return { encontrado: false, motivo: "El valor que propuso el modelo no figura en los documentos leídos, así que no se muestra." };
  }

  const evidencia = typeof respuesta.evidencia === "string" ? respuesta.evidencia.trim() : "";
  const textoPlano = normalizar(doc.texto).replace(/\s+/g, " ");
  const citaValida = evidencia && textoPlano.includes(normalizar(evidencia).replace(/\s+/g, " "));

  return {
    encontrado: true,
    valor,
    moneda: typeof respuesta.moneda === "string" && respuesta.moneda ? respuesta.moneda : "USD",
    concepto: typeof respuesta.concepto === "string" ? respuesta.concepto : undefined,
    evidencia: citaValida ? evidencia : undefined,
    fuente: { codigoActuacion: doc.codigoActuacion, tipo: doc.tipo, fecha: doc.fecha, nombreArchivo: doc.nombreArchivo },
  };
}

export const PROMPT_SISTEMA_VALOR = `Eres un asistente jurídico de Ecuador. Recibes el texto de documentos del inicio de un juicio (demanda, autos de calificación, mandamiento).
Tu única tarea es encontrar el VALOR POR EL QUE SE DEMANDA (la cuantía o la cantidad que se reclama: capital, "cantidad de USD ...", "cuantía de ...").
Reglas:
- Responde SOLO un JSON: {"encontrado": boolean, "valor": number|null, "moneda": "USD", "concepto": "cuantía"|"capital"|"cantidad reclamada"|"otro", "evidencia": "frase LITERAL copiada del documento", "documento": índice numérico del documento donde está}.
- El valor debe aparecer escrito en el texto. NO calcules, NO sumes, NO estimes.
- Si hay varios valores, elige el que corresponde a lo que se reclama como cuantía o capital, no honorarios, costas ni valores de ejemplo.
- Si no lo encuentras con certeza, responde {"encontrado": false, "valor": null}.`;

export function promptUsuarioValor(docs: DocTexto[]): string {
  return docs
    .map((d, i) => `### Documento ${i} — ${d.tipo} (${d.fecha ?? "s/f"})\n${d.texto}`)
    .join("\n\n");
}
