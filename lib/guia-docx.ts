// Convierte la guia armada (lib/guia-audiencia.ts) en un archivo Word.
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from "docx";
import type { GuiaArmada, Trozo } from "./guia-audiencia.js";

const FUENTE = "Arial";

function corridas(trozos: Trozo[], extra: { italics?: boolean; color?: string } = {}): TextRun[] {
  return trozos.map(
    (t) =>
      new TextRun({
        text: t.t,
        bold: t.negrita || t.completar,
        italics: t.ia ? false : extra.italics,
        color: t.completar ? "9A3412" : t.ia ? "7C3AED" : extra.color,
        highlight: t.completar ? "yellow" : undefined,
        font: FUENTE,
      })
  );
}

/** El Word en base64 (asi viaja en la respuesta JSON). */
export async function guiaADocx(guia: GuiaArmada): Promise<string> {
  const hijos: Paragraph[] = [];
  let lista = 0;

  // Cuadro de revision automatica al inicio: se borra antes de imprimir.
  const revision: string[] = [];
  if (guia.faltantes > 0) revision.push(`Faltan ${guia.faltantes} dato(s): están resaltados en amarillo como [COMPLETAR].`);
  revision.push(...guia.avisos);
  if (revision.length) {
    const borde = { style: BorderStyle.SINGLE, size: 8, color: "B45309", space: 4 };
    const cuadro = { border: { top: borde, bottom: borde, left: borde, right: borde }, shading: { type: ShadingType.CLEAR, color: "auto", fill: "FEF3C7" } };
    hijos.push(
      new Paragraph({
        ...cuadro,
        spacing: { after: 0 },
        children: [new TextRun({ text: "REVISIÓN AUTOMÁTICA — borrar este cuadro antes de imprimir", bold: true, font: FUENTE, color: "92400E" })],
      })
    );
    for (const r of revision) {
      hijos.push(new Paragraph({ ...cuadro, spacing: { after: 0 }, children: [new TextRun({ text: `• ${r}`, font: FUENTE, size: 20 })] }));
    }
    hijos.push(
      new Paragraph({
        ...cuadro,
        spacing: { after: 240 },
        children: [new TextRun({ text: "Borrador generado automáticamente: la abogada debe revisarlo antes de la audiencia.", italics: true, font: FUENTE, size: 18 })],
      })
    );
  }

  for (const b of guia.bloques) {
    switch (b.tipo) {
      case "titulo":
        hijos.push(new Paragraph({ style: "Title", alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.texto, font: FUENTE })] }));
        break;
      case "seccion":
        hijos.push(new Paragraph({ style: "Heading1", children: [new TextRun({ text: b.texto, font: FUENTE })] }));
        break;
      case "parrafo":
        hijos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 300 }, children: corridas(b.trozos) }));
        break;
      case "nota":
        hijos.push(new Paragraph({ spacing: { after: 160 }, children: corridas(b.trozos, { italics: true, color: "1D4ED8" }) }));
        break;
      case "lista": {
        const ref = `lista${lista++}`;
        for (const item of b.items) {
          hijos.push(new Paragraph({ numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 300 }, children: corridas(item) }));
        }
        break;
      }
    }
  }

  const listas = Array.from({ length: lista }, (_, i) => ({
    reference: `lista${i}`,
    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
  }));

  const doc = new Document({
    creator: "Agente SATJE",
    title: "Guía de audiencia única",
    numbering: { config: listas },
    styles: {
      default: { document: { run: { font: FUENTE, size: 24 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: FUENTE, size: 32, bold: true }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 24, bold: true, color: "1E3A8A" }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 0 } },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1500, right: 1300 } } },
        children: hijos,
      },
    ],
  });
  return Packer.toBase64String(doc);
}

export function nombreArchivoGuia(causa: string): string {
  return `GUIA_AUDIENCIA_UNICA_${String(causa).replace(/\D/g, "") || "juicio"}.docx`;
}
