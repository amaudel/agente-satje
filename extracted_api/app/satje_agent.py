import re
from typing import Any

from .errors import ApiError, ErrorCode
from .services import SatjeService, _parse_action_datetime


CEDULA_RUC_RE = re.compile(r"\b\d{10}(?:\d{3})?\b")
PROCESO_RE = re.compile(r"\b\d{5,23}\b")


def _clean_query(value: str) -> str:
    return " ".join(value.strip().split())


def _detect_identifier(query: str, explicit_type: str | None = None) -> tuple[str, str]:
    clean_query = _clean_query(query)
    clean_type = (explicit_type or "auto").strip().lower()
    if clean_type in {"cedula", "ruc", "identificacion"}:
        match = CEDULA_RUC_RE.search(clean_query)
        return "cedula", match.group(0) if match else clean_query
    if clean_type in {"proceso", "numero_proceso", "id_juicio", "idjuicio"}:
        return "proceso", clean_query
    if clean_type != "auto":
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "satjeAgent",
            message="tipoBusqueda debe ser auto, cedula, ruc, identificacion, proceso, numero_proceso o id_juicio.",
            status_code=422,
        )

    cedula_match = CEDULA_RUC_RE.search(clean_query)
    if cedula_match:
        return "cedula", cedula_match.group(0)

    process_candidates = [item for item in PROCESO_RE.findall(clean_query) if len(item) >= 11]
    if process_candidates:
        return "proceso", process_candidates[0]

    raise ApiError(
        ErrorCode.VALIDATION_ERROR,
        "satjeAgent",
        message="No pude identificar una cedula/RUC o numero de proceso en la consulta.",
        status_code=422,
    )


def _format_date(value: Any) -> str | None:
    parsed = _parse_action_datetime(value)
    if not parsed:
        return str(value).strip() if value else None
    return parsed.date().isoformat()


def _case_title(item: dict[str, Any]) -> str:
    parts = [
        item.get("numeroProceso") or item.get("idJuicio"),
        item.get("materia"),
        item.get("accion"),
    ]
    return " | ".join(str(part).strip() for part in parts if part)


def _summarize_case_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "idJuicio": item.get("idJuicio"),
        "numeroProceso": item.get("numeroProceso"),
        "titulo": _case_title(item),
        "estadoActual": item.get("estadoActual"),
        "materia": item.get("materia"),
        "accion": item.get("accion"),
        "judicatura": item.get("judicatura"),
        "fechaIngreso": _format_date(item.get("fechaIngreso")),
        "rolesEncontrados": item.get("rolesEncontrados", []),
    }


def _latest_actions(actuaciones: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for incidente in actuaciones.get("incidentes", []):
        for actuacion in incidente.get("actuaciones", []):
            rows.append(
                {
                    "fecha": actuacion.get("fecha"),
                    "tipo": actuacion.get("tipo"),
                    "actividad": actuacion.get("actividad"),
                    "codigoActuacion": actuacion.get("codigo"),
                    "nombreJudicatura": incidente.get("nombreJudicatura"),
                    "tieneDocumento": bool(actuacion.get("uuid") or actuacion.get("nombreArchivo")),
                }
            )
    rows.sort(key=lambda item: _parse_action_datetime(item.get("fecha")) or _parse_action_datetime("1900-01-01"), reverse=True)
    return [
        {
            **item,
            "fecha": _format_date(item.get("fecha")),
            "actividad": (item.get("actividad") or "")[:700],
        }
        for item in rows[:limit]
    ]


def _build_text_summary_for_search(identifier: str, cases: list[dict[str, Any]]) -> str:
    if not cases:
        return f"No encontre procesos SATJE para la identificacion {identifier}."
    if len(cases) == 1:
        return f"Encontre 1 proceso SATJE para {identifier}: {cases[0]['titulo']}."
    return f"Encontre {len(cases)} procesos SATJE para {identifier}. Conviene elegir una causa antes de ver actuaciones."


def _build_text_summary_for_case(id_juicio: str, actuaciones: dict[str, Any], latest: list[dict[str, Any]]) -> str:
    total = actuaciones.get("totalActuaciones", 0)
    if not latest:
        return f"La causa {id_juicio} existe, pero no encontre actuaciones disponibles."
    last = latest[0]
    date = f" el {last['fecha']}" if last.get("fecha") else ""
    kind = f" ({last['tipo']})" if last.get("tipo") else ""
    return f"La causa {id_juicio} tiene {total} actuaciones. Ultimo movimiento{date}{kind}: {last.get('actividad') or 'sin detalle'}"


class SatjeAgent:
    def __init__(self, service: SatjeService | None = None) -> None:
        self.service = service or SatjeService()

    async def run(
        self,
        query: str,
        *,
        tipo_busqueda: str | None = None,
        incluir_actuaciones: bool = True,
        max_actuaciones: int = 5,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        if not query.strip():
            raise ApiError(ErrorCode.VALIDATION_ERROR, "satjeAgent", status_code=422)

        identifier_type, identifier = _detect_identifier(query, tipo_busqueda)
        if identifier_type == "cedula":
            search = await self.service.buscar_causas_por_cedula(
                identifier,
                roles=["actor", "demandado"],
                incluir_todas_las_paginas=True,
                request_id=request_id,
            )
            cases = [_summarize_case_item(item) for item in search.get("data", [])]
            return {
                "success": True,
                "agent": "satje_consultor",
                "intent": "buscar_causas",
                "source": "SATJE",
                "mode": search.get("mode"),
                "retrievedAt": search.get("retrievedAt"),
                "input": {"query": query, "tipoBusqueda": identifier_type, "identificador": identifier},
                "answer": _build_text_summary_for_search(identifier, cases),
                "cases": cases,
                "nextActions": [
                    {
                        "type": "select_case",
                        "label": "Seleccionar causa",
                        "required": len(cases) > 1,
                    },
                    {
                        "type": "fetch_case_acts",
                        "label": "Ver ultimas actuaciones",
                        "enabled": len(cases) == 1,
                        "idJuicio": cases[0]["idJuicio"] if len(cases) == 1 else None,
                    },
                ],
                "requestId": search.get("requestId"),
            }

        actuaciones = await self.service.actuaciones_por_juicio(identifier, request_id=request_id)
        latest = _latest_actions(actuaciones, max(1, min(max_actuaciones, 20))) if incluir_actuaciones else []
        return {
            "success": True,
            "agent": "satje_consultor",
            "intent": "consultar_causa",
            "source": "SATJE",
            "mode": actuaciones.get("mode"),
            "retrievedAt": actuaciones.get("retrievedAt"),
            "input": {"query": query, "tipoBusqueda": identifier_type, "identificador": identifier},
            "answer": _build_text_summary_for_case(identifier, actuaciones, latest),
            "case": {
                "idJuicio": actuaciones.get("idJuicio"),
                "totalIncidentes": actuaciones.get("totalIncidentes"),
                "totalActuaciones": actuaciones.get("totalActuaciones"),
                "ultimasActuaciones": latest,
            },
            "nextActions": [
                {"type": "fetch_resolutions", "label": "Buscar resoluciones", "idJuicio": actuaciones.get("idJuicio")},
                {"type": "generate_pdf", "label": "Generar PDF", "idJuicio": actuaciones.get("idJuicio")},
            ],
            "partialErrors": actuaciones.get("partialErrors", []),
            "requestId": actuaciones.get("requestId"),
        }
