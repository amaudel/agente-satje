from io import BytesIO
from xml.sax.saxutils import escape
from typing import Any
from datetime import UTC, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .schemas import Juicio, JuicioDetalle, JuiciosResumen


def _text(value: Any) -> str:
    if value in (None, ""):
        return "-"
    return str(value)


def _paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(_text(value)), style)


def _actuacion_descripcion(actuacion: dict[str, Any]) -> str:
    descripcion = _text(actuacion.get("descripcion") or actuacion.get("actividad"))
    nombre_archivo = actuacion.get("nombre_archivo")
    origen = actuacion.get("origen")
    codigo = actuacion.get("codigo")

    extras = []
    if nombre_archivo:
        extras.append(f"Archivo: {nombre_archivo}")
    if origen:
        extras.append(f"Origen: {origen}")
    if codigo:
        extras.append(f"Codigo: {codigo}")

    if extras:
        return f"{descripcion}\n" + " | ".join(extras)
    return descripcion


def _kv_table(rows: list[tuple[str, Any]]) -> Table:
    table = Table(
        [[label, _text(value)] for label, value in rows],
        colWidths=[4.2 * cm, 11.4 * cm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f7")),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#1f2937")),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _juicio_rows(juicio: Juicio) -> list[tuple[str, Any]]:
    return [
        ("Numero proceso", juicio.numero_proceso),
        ("Id juicio", juicio.id_juicio),
        ("Judicatura", juicio.judicatura),
        ("Materia", juicio.materia),
        ("Accion", juicio.accion),
        ("Actor", juicio.actor),
        ("Demandado", juicio.demandado),
        ("Fecha ingreso", juicio.fecha_ingreso),
        ("Estado", juicio.estado),
        ("Fuente", juicio.fuente),
    ]


def build_juicio_pdf(detalle: JuicioDetalle) -> bytes:
    buffer = BytesIO()
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        spaceAfter=12,
    )
    section = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        spaceBefore=10,
        spaceAfter=6,
    )
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12)
    act_title = ParagraphStyle(
        "ActuacionTitle",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#1f2937"),
        spaceBefore=6,
        spaceAfter=2,
    )
    act_body = ParagraphStyle(
        "ActuacionBody",
        parent=styles["BodyText"],
        fontSize=8,
        leading=11,
        spaceAfter=4,
    )

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.5 * cm,
        leftMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
        title=f"Extracto judicial {detalle.juicio.numero_proceso}",
    )

    story = [
        Paragraph("Extracto judicial", title),
        Paragraph(
            "Reporte generado desde la API a partir del detalle del proceso y "
            "sus actuaciones en JSON.",
            body,
        ),
        Spacer(1, 8),
        _kv_table(_juicio_rows(detalle.juicio)),
    ]

    incidentes_meta = None
    if isinstance(detalle.juicio.raw, dict):
        incidentes_meta = detalle.juicio.raw.get("incidentes")
    if isinstance(incidentes_meta, list):
        story.extend(
            [
                Spacer(1, 8),
                _kv_table(
                    [
                        ("Total incidentes", len(incidentes_meta)),
                        ("Total actuaciones", len(detalle.actuaciones)),
                        ("Fecha generacion", datetime.now(UTC).isoformat()),
                    ]
                ),
            ]
        )

    story.append(Paragraph("Actuaciones", section))
    if detalle.actuaciones:
        current_incidente = object()
        for index, actuacion in enumerate(detalle.actuaciones, start=1):
            incidente = actuacion.get("incidente")
            if incidente not in (None, current_incidente):
                current_incidente = incidente
                story.append(Paragraph(f"Incidente {escape(_text(incidente))}", section))
            title_text = " | ".join(
                part
                for part in (
                    f"{index}. {_text(actuacion.get('fecha'))}",
                    _text(actuacion.get("tipo")),
                )
                if part != "-"
            )
            story.append(_paragraph(title_text, act_title))
            story.append(_paragraph(_actuacion_descripcion(actuacion), act_body))
    else:
        story.append(Paragraph("No hay actuaciones disponibles para este proceso.", body))

    doc.build(story)
    return buffer.getvalue()


def build_resumen_pdf(resumen: JuiciosResumen, juicios: list[Juicio]) -> bytes:
    buffer = BytesIO()
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        spaceAfter=12,
    )
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.5 * cm,
        leftMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
        title=f"Resumen judicial {resumen.identificacion}",
    )

    story = [
        Paragraph("Resumen judicial", title),
        _kv_table(
            [
                ("Identificacion", resumen.identificacion),
                ("Total procesos", resumen.total),
                ("Activos", resumen.activos),
                ("Finalizados", resumen.finalizados),
                ("Riesgo", resumen.riesgo),
                ("Mensajes", " | ".join(resumen.mensajes)),
            ]
        ),
        Spacer(1, 10),
    ]

    if juicios:
        data = [["Proceso", "Materia", "Accion", "Estado"]]
        for juicio in juicios:
            data.append(
                [
                    _text(juicio.numero_proceso),
                    _text(juicio.materia),
                    _text(juicio.accion),
                    _text(juicio.estado),
                ]
            )
        table = Table(data, colWidths=[4.1 * cm, 3.2 * cm, 5.2 * cm, 3.1 * cm])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(table)
    else:
        story.append(Paragraph("No se encontraron procesos para la identificacion consultada.", body))

    doc.build(story)
    return buffer.getvalue()
