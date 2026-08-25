import base64
import binascii
import calendar
from datetime import UTC, date, datetime
from typing import Any

from .cache import get_cached, set_cached
from .config import settings
from .errors import ApiError, ErrorCode
from .observability import mask_cedula, new_request_id, operation_timer, set_request_id
from .pdf_text import extract_pdf_text
from .satje_client import SatjeClient, build_actuaciones_payload, extract_incidentes, get_satje_client
from .schemas import Juicio, JuicioDetalle
from .source import _extract_actuaciones, _extract_rows, _normalize_juicio

ABANDONO_LEGAL_MONTHS = 6
ABANDONO_LEGAL_REFERENCE = (
    "COGEP arts. 245 y 246: el art. 245 establece el plazo legal aplicable "
    "para el abandono y el art. 246 regula el computo desde el dia siguiente "
    "de la ultima notificacion o actuacion procesal. Referencia usada como "
    "alerta preventiva conforme a criterios publicados por la Funcion Judicial."
)
RESOLUTION_KEYWORDS = (
    "sentencia",
    "resolucion",
    "resolución",
    "auto resolutorio",
    "auto resolutivo",
    "aceptacion de demanda",
    "aceptación de demanda",
    "acepta la demanda",
    "acepta demanda",
    "rechazo de demanda",
    "rechaza la demanda",
    "rechaza demanda",
    "archivo",
    "divorcio declarado",
    "terminacion del proceso",
    "terminación del proceso",
)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _parse_action_date(value: Any) -> date | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _parse_action_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.combine(date.fromisoformat(text[:10]), datetime.min.time())
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def _add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _abandono_status(days_remaining: int, alert_days: int) -> str:
    if days_remaining < 0:
        return "vencido"
    if days_remaining <= 15:
        return "critico"
    if days_remaining <= alert_days:
        return "alerta"
    return "vigilancia"


def _is_deprecada_candidate(incidente: dict[str, Any], actuacion: dict[str, Any], main_judicatura: str | None) -> bool:
    judicatura = str(incidente.get("nombreJudicatura") or "").strip()
    if main_judicatura and judicatura and judicatura != main_judicatura:
        return True
    haystack = " ".join(
        str(part or "")
        for part in (
            judicatura,
            actuacion.get("tipo"),
            actuacion.get("actividad"),
            actuacion.get("origen"),
            actuacion.get("raw"),
        )
    ).lower()
    keywords = (
        "deprec",
        "unidad judicial multicompetente",
        "teniente politico",
        "teniente político",
        "registro de la propiedad",
        "citacion",
        "citación",
    )
    return any(keyword in haystack for keyword in keywords)


def document_id_from_code(code: str) -> str:
    encoded = base64.urlsafe_b64encode(code.encode("utf-8")).decode("ascii").rstrip("=")
    return f"doc_{encoded}"


def code_from_document_id(document_id: str) -> str:
    clean_id = document_id.strip()
    if not clean_id.startswith("doc_"):
        return clean_id
    encoded = clean_id[4:]
    padding = "=" * (-len(encoded) % 4)
    try:
        return base64.urlsafe_b64decode(f"{encoded}{padding}").decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "documentId",
            message="documentoId no cumple el formato esperado.",
            status_code=422,
        ) from exc


def normalize_actuacion_v1(actuacion: dict[str, Any]) -> dict[str, Any]:
    return {
        "codigo": actuacion.get("codigo"),
        "idJuicio": actuacion.get("id_juicio"),
        "idJudicatura": actuacion.get("id_judicatura"),
        "fecha": actuacion.get("fecha"),
        "tipo": actuacion.get("tipo"),
        "actividad": actuacion.get("descripcion"),
        "visible": actuacion.get("visible"),
        "origen": actuacion.get("origen"),
        "uuid": actuacion.get("uuid"),
        "nombreArchivo": actuacion.get("nombre_archivo"),
        "ieDocumentoAdjunto": actuacion.get("documento_adjunto"),
        "ieTablaReferencia": actuacion.get("tabla_referencia"),
        "escapeOut": actuacion.get("escape_out"),
        "alias": actuacion.get("alias"),
        "tipoIngreso": actuacion.get("tipo_ingreso"),
        "idTablaReferencia": actuacion.get("id_tabla_referencia"),
        "raw": actuacion.get("raw"),
    }


def _flatten_actuaciones(result: dict[str, Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for incidente in result.get("incidentes", []):
        for actuacion in incidente.get("actuaciones", []):
            flattened.append(
                {
                    **actuacion,
                    "idIncidenteJudicatura": incidente.get("idIncidenteJudicatura"),
                    "idMovimientoJuicioIncidente": incidente.get("idMovimientoJuicioIncidente"),
                    "incidente": incidente.get("incidente"),
                    "idJudicaturaIncidente": incidente.get("idJudicatura"),
                    "nombreJudicatura": incidente.get("nombreJudicatura"),
                }
            )
    return flattened


def _action_sort_key(actuacion: dict[str, Any]) -> tuple[datetime, str]:
    action_datetime = _parse_action_datetime(actuacion.get("fecha")) or datetime.min
    return action_datetime, str(actuacion.get("codigo") or "")


def _parse_filter_date(value: str | None, field: str) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            field,
            message=f"{field} debe usar formato AAAA-MM-DD.",
            status_code=422,
        ) from exc


def _has_document(actuacion: dict[str, Any]) -> bool:
    uuid = str(actuacion.get("uuid") or "").strip()
    attachment = str(actuacion.get("ieDocumentoAdjunto") or "").strip().lower()
    filename = str(actuacion.get("nombreArchivo") or "").strip()
    return bool(uuid or filename or attachment in {"s", "si", "sí", "true", "1", "y", "yes"})


def _document_count(actuacion: dict[str, Any]) -> int:
    return 1 if _has_document(actuacion) else 0


def _filter_actuaciones(
    actuaciones: list[dict[str, Any]],
    *,
    fecha_desde: str | None = None,
    fecha_hasta: str | None = None,
    tipo: str | None = None,
    tiene_documento: bool | None = None,
) -> list[dict[str, Any]]:
    start_date = _parse_filter_date(fecha_desde, "fechaDesde")
    end_date = _parse_filter_date(fecha_hasta, "fechaHasta")
    clean_tipo = tipo.strip().lower() if tipo else None
    filtered: list[dict[str, Any]] = []
    for actuacion in actuaciones:
        action_date = _parse_action_date(actuacion.get("fecha"))
        if start_date and (not action_date or action_date < start_date):
            continue
        if end_date and (not action_date or action_date > end_date):
            continue
        if clean_tipo and clean_tipo not in str(actuacion.get("tipo") or "").lower():
            continue
        if tiene_documento is not None and _has_document(actuacion) is not tiene_documento:
            continue
        filtered.append(actuacion)
    return filtered


def _actuacion_page_item(actuacion: dict[str, Any]) -> dict[str, Any]:
    return {
        "idIncidenteJudicatura": actuacion.get("idIncidenteJudicatura"),
        "incidente": actuacion.get("incidente"),
        "idJudicatura": actuacion.get("idJudicatura") or actuacion.get("idJudicaturaIncidente"),
        "nombreJudicatura": actuacion.get("nombreJudicatura"),
        "codigoActuacion": actuacion.get("codigo"),
        "fecha": actuacion.get("fecha"),
        "tipo": actuacion.get("tipo"),
        "actividad": _summarize_activity(actuacion.get("actividad"), limit=1200),
        "tieneDocumento": _has_document(actuacion),
    }


def _resolution_evidence(actuacion: dict[str, Any]) -> list[str]:
    haystack = " ".join(
        str(part or "")
        for part in (
            actuacion.get("tipo"),
            actuacion.get("actividad"),
            actuacion.get("alias"),
            actuacion.get("nombreArchivo"),
        )
    ).lower()
    evidence = [keyword for keyword in RESOLUTION_KEYWORDS if keyword in haystack]
    if evidence and _has_document(actuacion):
        evidence.append("documento_adjunto")
    return evidence


def _confidence_level(evidence: list[str], actuacion: dict[str, Any]) -> str:
    strong_terms = {"sentencia", "resolucion", "resolución", "auto resolutorio", "auto resolutivo"}
    if any(item in strong_terms for item in evidence) and _has_document(actuacion):
        return "alto"
    if any(item in strong_terms for item in evidence) or _has_document(actuacion):
        return "medio"
    return "bajo"


def _summarize_activity(value: Any, limit: int = 500) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3].rstrip()}..."


def juicio_to_frontend(juicio: Juicio, roles: set[str]) -> dict[str, Any]:
    return {
        "idJuicio": juicio.id_juicio,
        "numeroProceso": juicio.numero_proceso,
        "estadoActual": juicio.estado,
        "materia": juicio.materia,
        "accion": juicio.accion,
        "judicatura": juicio.judicatura,
        "fechaIngreso": juicio.fecha_ingreso,
        "rolesEncontrados": sorted(roles),
        "raw": juicio.raw,
    }


class SatjeService:
    def __init__(self, client: SatjeClient | None = None) -> None:
        self.client = client or get_satje_client()

    async def buscar_causas_por_cedula(
        self,
        cedula: str,
        *,
        roles: list[str] | None = None,
        incluir_todas_las_paginas: bool = True,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        set_request_id(request_id)
        requested_roles = roles or ["actor", "demandado"]
        if not cedula.strip():
            raise ApiError(ErrorCode.VALIDATION_ERROR, "buscarCausas", status_code=422)

        cache_key = (
            f"v2:buscar:{self.client.mode}:{self.client.__class__.__name__}:{cedula}:"
            f"{','.join(sorted(requested_roles))}:{incluir_todas_las_paginas}:"
            f"{settings.satje_page_size}:{settings.satje_max_pages}"
        )
        cached = get_cached(cache_key)
        if cached is not None:
            cached["requestId"] = request_id
            cached["cache"] = {"hit": True, "ttlSeconds": settings.cache_ttl_seconds}
            return cached

        by_id: dict[str, tuple[Juicio, set[str]]] = {}
        with operation_timer(
            requestId=request_id,
            endpoint="/api/v1/causas/buscar",
            stage="buscarCausasFlow",
            mode=self.client.mode,
            cedula=mask_cedula(cedula),
        ) as state:
            for role in requested_roles:
                page = 1
                while True:
                    raw = await self.client.buscar_causas_por_cedula(
                        cedula,
                        role=role,
                        page=page,
                        size=settings.satje_page_size,
                    )
                    rows = _extract_rows(raw)
                    for row in rows:
                        juicio = _normalize_juicio(row)
                        if not juicio.id_juicio:
                            continue
                        existing = by_id.setdefault(juicio.id_juicio, (juicio, set()))
                        existing[1].add(role)
                    if not incluir_todas_las_paginas or len(rows) < settings.satje_page_size:
                        break
                    page += 1
                    if page > settings.satje_max_pages:
                        break
            state["causas"] = len(by_id)

        data = [juicio_to_frontend(juicio, roles_found) for juicio, roles_found in by_id.values()]
        result = {
            "success": True,
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": now_iso(),
            "cedula": cedula,
            "total": len(data),
            "data": data,
            "requestId": request_id,
            "cache": {"hit": False, "ttlSeconds": settings.cache_ttl_seconds},
        }
        set_cached(cache_key, {**result, "requestId": None})
        return result

    async def actuaciones_por_juicio(self, id_juicio: str, *, request_id: str | None = None) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        set_request_id(request_id)
        clean_id = id_juicio.strip()
        if not clean_id:
            raise ApiError(ErrorCode.VALIDATION_ERROR, "getIncidenteJudicatura", status_code=422)

        cache_key = f"v2:actuaciones:{self.client.mode}:{self.client.__class__.__name__}:{clean_id}"
        cached = get_cached(cache_key)
        if cached is not None:
            cached["requestId"] = request_id
            cached["cache"] = {"hit": True, "ttlSeconds": settings.cache_ttl_seconds}
            return cached

        incidentes_response = await self.client.obtener_incidentes_por_juicio(clean_id)
        incidentes = extract_incidentes(incidentes_response, clean_id)
        if not incidentes:
            raise ApiError(ErrorCode.INCIDENT_NOT_FOUND, "getIncidenteJudicatura", status_code=404)

        grouped: list[dict[str, Any]] = []
        total_actuaciones = 0
        partial_errors: list[dict[str, Any]] = []
        with operation_timer(
            requestId=request_id,
            endpoint="/api/v1/causas/{idJuicio}/actuaciones",
            stage="actuacionesFlow",
            mode=self.client.mode,
            idJuicio=clean_id,
        ) as state:
            for incidente in incidentes:
                payload = build_actuaciones_payload(incidente, clean_id)
                try:
                    actuaciones_raw = await self.client.obtener_actuaciones(payload)
                    actuaciones = [normalize_actuacion_v1(item) for item in _extract_actuaciones(actuaciones_raw)]
                except ApiError as exc:
                    actuaciones = []
                    partial_errors.append(exc.payload(request_id)["error"])

                total_actuaciones += len(actuaciones)
                grouped.append(
                    {
                        "idIncidenteJudicatura": payload.get("idIncidenteJudicatura"),
                        "idMovimientoJuicioIncidente": payload.get("idMovimientoJuicioIncidente"),
                        "incidente": payload.get("incidente"),
                        "idJudicatura": payload.get("idJudicatura"),
                        "nombreJudicatura": payload.get("nombreJudicatura"),
                        "totalActuaciones": len(actuaciones),
                        "actuaciones": actuaciones,
                    }
                )
            state["incidentes"] = len(grouped)
            state["actuaciones"] = total_actuaciones

        result = {
            "success": not partial_errors,
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": now_iso(),
            "idJuicio": clean_id,
            "totalIncidentes": len(grouped),
            "totalActuaciones": total_actuaciones,
            "incidentes": grouped,
            "partialErrors": partial_errors,
            "requestId": request_id,
            "cache": {"hit": False, "ttlSeconds": settings.cache_ttl_seconds},
        }
        if not partial_errors:
            set_cached(cache_key, {**result, "requestId": None})
        return result

    async def actuaciones_paginadas_por_juicio(
        self,
        id_juicio: str,
        *,
        page: int = 1,
        page_size: int = 20,
        orden: str = "desc",
        fecha_desde: str | None = None,
        fecha_hasta: str | None = None,
        tipo: str | None = None,
        tiene_documento: bool | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        result = await self.actuaciones_por_juicio(id_juicio, request_id=request_id)
        actuaciones = _flatten_actuaciones(result)
        actuaciones = _filter_actuaciones(
            actuaciones,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            tipo=tipo,
            tiene_documento=tiene_documento,
        )
        reverse = orden != "asc"
        actuaciones.sort(key=_action_sort_key, reverse=reverse)

        total_items = len(actuaciones)
        total_pages = (total_items + page_size - 1) // page_size if total_items else 0
        start = (page - 1) * page_size
        end = start + page_size

        return {
            "success": result.get("success", True),
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": result.get("retrievedAt") or now_iso(),
            "idJuicio": result["idJuicio"],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "totalItems": total_items,
                "totalPages": total_pages,
                "hasNext": page < total_pages,
                "hasPrevious": page > 1 and total_pages > 0,
            },
            "data": [_actuacion_page_item(actuacion) for actuacion in actuaciones[start:end]],
            "partialErrors": result.get("partialErrors", []),
            "requestId": request_id,
            "cache": result.get("cache", {"hit": False, "ttlSeconds": settings.cache_ttl_seconds}),
        }

    async def resoluciones_por_juicio(
        self,
        id_juicio: str,
        *,
        limit: int = 20,
        fecha_desde: str | None = None,
        fecha_hasta: str | None = None,
        incluir_sin_documento: bool = True,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        result = await self.actuaciones_por_juicio(id_juicio, request_id=request_id)
        actuaciones = _filter_actuaciones(
            _flatten_actuaciones(result),
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
        )
        actuaciones = sorted(actuaciones, key=_action_sort_key, reverse=True)

        data: list[dict[str, Any]] = []
        for actuacion in actuaciones:
            evidence = _resolution_evidence(actuacion)
            if not evidence:
                continue
            tiene_documento = _has_document(actuacion)
            if not incluir_sin_documento and not tiene_documento:
                continue
            data.append(
                {
                    "codigoActuacion": actuacion.get("codigo"),
                    "fecha": actuacion.get("fecha"),
                    "tipo": actuacion.get("tipo"),
                    "actividad": _summarize_activity(actuacion.get("actividad")),
                    "nombreJudicatura": actuacion.get("nombreJudicatura"),
                    "tieneDocumento": tiene_documento,
                    "cantidadDocumentos": _document_count(actuacion),
                    "documentoId": document_id_from_code(str(actuacion["uuid"]))
                    if str(actuacion.get("uuid") or "").strip()
                    else None,
                    "criterioCoincidencia": evidence,
                    "nivelConfianza": _confidence_level(evidence, actuacion),
                    "advertencia": "Candidata por metadatos SATJE; no afirma contenido de sentencia sin revisar el documento.",
                }
            )
            if len(data) >= limit:
                break

        return {
            "success": result.get("success", True),
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": result.get("retrievedAt") or now_iso(),
            "idJuicio": result["idJuicio"],
            "total": len(data),
            "data": data,
            "partialErrors": result.get("partialErrors", []),
            "requestId": request_id,
            "cache": result.get("cache", {"hit": False, "ttlSeconds": settings.cache_ttl_seconds}),
        }

    async def documentos_hba_por_actuacion(
        self,
        id_juicio: str,
        codigo_actuacion: str,
        *,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        result = await self.actuaciones_por_juicio(id_juicio, request_id=request_id)
        clean_codigo = str(codigo_actuacion).strip()
        documentos: list[dict[str, Any]] = []
        actuacion_encontrada = False

        for incidente in result["incidentes"]:
            for actuacion in incidente["actuaciones"]:
                if str(actuacion.get("codigo") or "").strip() != clean_codigo:
                    continue
                actuacion_encontrada = True

                # SATJE separa el documento principal de una actuacion de sus
                # "anexos" (ej. un OFICIO puede traer el oficio en si y un
                # certificado adjunto) en un endpoint distinto al de
                # actuaciones. Si esta disponible, se listan todos los
                # documentos reales en vez de solo la constancia de ingreso.
                anexos: list[dict[str, Any]] = []
                tabla_referencia = actuacion.get("ieTablaReferencia")
                # SATJE espera el codigo propio de la actuacion en
                # IdTablaReferencia -- el campo "idTablaReferencia" que trae
                # la actuacion NO sirve para esto: en produccion coincide con
                # idMovimientoJuicioIncidente del incidente, no con el codigo.
                codigo_actuacion_ref = actuacion.get("codigo")
                if tabla_referencia and codigo_actuacion_ref is not None:
                    anexos_payload = {
                        "TablaReferencia": tabla_referencia,
                        "IdTablaReferencia": codigo_actuacion_ref,
                        "IdIndiceElectronico": 0,
                        "idmovimientojuicioincidente": incidente.get("idMovimientoJuicioIncidente"),
                        "tipoActuacion": actuacion.get("tipo"),
                    }
                    try:
                        anexos_raw = await self.client.obtener_anexos_actuacion(anexos_payload)
                        if isinstance(anexos_raw, list):
                            anexos = anexos_raw
                    except Exception:
                        anexos = []

                if anexos:
                    for anexo in anexos:
                        if not isinstance(anexo, dict):
                            continue
                        anexo_uuid = str(anexo.get("UUID") or anexo.get("uuid") or "").strip()
                        if not anexo_uuid:
                            continue
                        documentos.append(
                            {
                                "documentoId": document_id_from_code(anexo_uuid),
                                "nombre": anexo.get("descripcion") or anexo.get("nombreArchivo") or "HBA",
                                "nombreArchivo": anexo.get("nombreArchivo") or f"{clean_codigo}.pdf",
                                "paginas": anexo.get("paginas"),
                                "tipo": "application/pdf",
                                "disponible": True,
                                "codigoActuacion": actuacion.get("codigo"),
                                "fechaActuacion": actuacion.get("fecha"),
                            }
                        )
                    continue

                # Sin anexos disponibles (endpoint no aplico o no devolvio
                # nada): se mantiene el comportamiento anterior de exponer el
                # documento principal via el uuid propio de la actuacion.
                code = str(actuacion.get("uuid") or "").strip()
                if not code:
                    continue
                documentos.append(
                    {
                        "documentoId": document_id_from_code(code),
                        "nombre": actuacion.get("alias") or actuacion.get("tipo") or "HBA",
                        "nombreArchivo": actuacion.get("nombreArchivo") or f"{clean_codigo}.pdf",
                        "tipo": "application/pdf",
                        "disponible": True,
                        "codigoActuacion": actuacion.get("codigo"),
                        "fechaActuacion": actuacion.get("fecha"),
                    }
                )

        if not actuacion_encontrada:
            raise ApiError(
                ErrorCode.DOCUMENT_NOT_FOUND,
                "documentosHba",
                message="No se encontro la actuacion solicitada dentro del proceso.",
                status_code=404,
            )

        return {
            "success": True,
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": now_iso(),
            "idJuicio": result["idJuicio"],
            "codigoActuacion": clean_codigo,
            "total": len(documentos),
            "data": documentos,
            "requestId": request_id,
            "cache": result.get("cache", {"hit": False, "ttlSeconds": settings.cache_ttl_seconds}),
        }

    async def riesgo_abandono_por_juicio(
        self,
        id_juicio: str,
        *,
        fecha_corte: str | None = None,
        alerta_dias: int = 30,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        result = await self.actuaciones_por_juicio(id_juicio, request_id=request_id)
        corte = _parse_action_date(fecha_corte) if fecha_corte else datetime.now(UTC).date()
        if corte is None:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "abandonoRiesgo",
                message="fechaCorte debe usar formato ISO, por ejemplo 2026-07-14.",
                status_code=422,
            )

        main_judicatura = None
        main_actions: list[tuple[date, dict[str, Any], dict[str, Any]]] = []
        all_actions: list[tuple[date, dict[str, Any], dict[str, Any]]] = []
        deprecada_actions: list[tuple[date, dict[str, Any], dict[str, Any]]] = []
        for incidente in result["incidentes"]:
            main_judicatura = main_judicatura or incidente.get("nombreJudicatura")
            for actuacion in incidente["actuaciones"]:
                action_date = _parse_action_date(actuacion.get("fecha"))
                if action_date is None:
                    continue
                item = (action_date, incidente, actuacion)
                all_actions.append(item)
                if _is_deprecada_candidate(incidente, actuacion, main_judicatura):
                    deprecada_actions.append(item)
                else:
                    main_actions.append(item)

        if not all_actions:
            raise ApiError(
                ErrorCode.ACTUATIONS_NOT_FOUND,
                "abandonoRiesgo",
                message="No existen actuaciones fechadas suficientes para calcular riesgo de abandono.",
                status_code=404,
            )

        def build_clock(name: str, items: list[tuple[date, dict[str, Any], dict[str, Any]]]) -> dict[str, Any] | None:
            if not items:
                return None
            action_date, incidente, actuacion = max(items, key=lambda item: item[0])
            inicio = action_date.toordinal() + 1
            inicio_date = date.fromordinal(inicio)
            fecha_limite = _add_months(inicio_date, ABANDONO_LEGAL_MONTHS)
            days_remaining = (fecha_limite - corte).days
            return {
                "ambito": name,
                "ultimaActuacion": {
                    "fecha": action_date.isoformat(),
                    "codigo": actuacion.get("codigo"),
                    "tipo": actuacion.get("tipo"),
                    "actividadResumen": (actuacion.get("actividad") or "")[:500],
                    "idIncidenteJudicatura": incidente.get("idIncidenteJudicatura"),
                    "incidente": incidente.get("incidente"),
                    "nombreJudicatura": incidente.get("nombreJudicatura"),
                },
                "inicioComputo": inicio_date.isoformat(),
                "plazoLegalMeses": ABANDONO_LEGAL_MONTHS,
                "fechaReferencialAbandono": fecha_limite.isoformat(),
                "diasRestantes": days_remaining,
                "estadoAlerta": _abandono_status(days_remaining, alerta_dias),
            }

        reloj_principal = build_clock("proceso_principal", main_actions or all_actions)
        reloj_deprecada = build_clock("unidad_deprecada", deprecada_actions)
        clocks = [clock for clock in (reloj_principal, reloj_deprecada) if clock]
        worst_clock = min(clocks, key=lambda item: item["diasRestantes"])

        return {
            "success": True,
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": now_iso(),
            "idJuicio": result["idJuicio"],
            "fechaCorte": corte.isoformat(),
            "baseLegalReferencial": ABANDONO_LEGAL_REFERENCE,
            "reglaApp": "Generar alerta si el proceso principal o la unidad deprecada tienen reloj en estado alerta, critico o vencido.",
            "relojProcesoPrincipal": reloj_principal,
            "relojUnidadDeprecada": reloj_deprecada,
            "alertaGeneral": {
                "estadoAlerta": worst_clock["estadoAlerta"],
                "ambitoMasCercano": worst_clock["ambito"],
                "diasRestantes": worst_clock["diasRestantes"],
                "fechaReferencialAbandono": worst_clock["fechaReferencialAbandono"],
            },
            "advertencias": [
                "Es una alerta preventiva y no una declaratoria juridica de abandono.",
                "La app debe mostrar ambos relojes cuando exista unidad deprecada.",
                "Una actuacion util posterior puede reiniciar el computo.",
                "Si la demora depende del juzgado o de una diligencia pendiente de despacho, requiere revision juridica.",
            ],
            "partialErrors": result.get("partialErrors", []),
            "requestId": request_id,
            "cache": result.get("cache", {"hit": False, "ttlSeconds": settings.cache_ttl_seconds}),
        }

    async def detalle_para_pdf(self, id_juicio: str, *, request_id: str | None = None) -> tuple[JuicioDetalle, dict[str, Any]]:
        result = await self.actuaciones_por_juicio(id_juicio, request_id=request_id)
        actuaciones: list[dict[str, Any]] = []
        judicatura = None
        for incidente in result["incidentes"]:
            judicatura = judicatura or incidente.get("nombreJudicatura")
            for actuacion in incidente["actuaciones"]:
                normalized = {
                    "fecha": actuacion.get("fecha"),
                    "tipo": actuacion.get("tipo"),
                    "descripcion": actuacion.get("actividad"),
                    "codigo": actuacion.get("codigo"),
                    "origen": actuacion.get("origen"),
                    "nombre_archivo": actuacion.get("nombreArchivo"),
                    "incidente": incidente.get("incidente"),
                    "id_incidente_judicatura": incidente.get("idIncidenteJudicatura"),
                }
                actuaciones.append(normalized)

        juicio = Juicio(
            id_juicio=result["idJuicio"],
            numero_proceso=result["idJuicio"],
            judicatura=judicatura,
            raw={"incidentes": result["incidentes"]},
        )
        return JuicioDetalle(juicio=juicio, actuaciones=actuaciones), result

    async def extraer_texto_documento_hba(self, code: str, *, request_id: str | None = None) -> dict[str, Any]:
        request_id = request_id or new_request_id()
        set_request_id(request_id)
        clean_code = code_from_document_id(code)
        if not clean_code:
            raise ApiError(ErrorCode.VALIDATION_ERROR, "documentHba", status_code=422)

        cache_key = f"v3:document-hba-text:{self.client.mode}:{self.client.__class__.__name__}:{clean_code}"
        cached = get_cached(cache_key)
        if cached is not None:
            cached["requestId"] = request_id
            cached["cache"] = {"hit": True, "ttlSeconds": settings.cache_ttl_seconds}
            return cached

        with operation_timer(
            requestId=request_id,
            endpoint="/api/v1/documentos/hba/extract-text",
            stage="documentHbaTextFlow",
            mode=self.client.mode,
        ) as state:
            document = await self.client.obtener_documento_hba(clean_code)
            pdf_bytes = document.get("bytes")
            if not isinstance(pdf_bytes, bytes):
                raise ApiError(ErrorCode.SATJE_INVALID_RESPONSE, "documentHba", status_code=502)
            extracted = extract_pdf_text(pdf_bytes)
            state["bytes"] = len(pdf_bytes)
            state["pages"] = int(extracted["pages"])
            state["ocr"] = 1 if extracted.get("extractionMethod") == "ocr" else 0

        result = {
            "success": True,
            "source": "SATJE",
            "mode": self.client.mode,
            "retrievedAt": now_iso(),
            "documentoId": document_id_from_code(clean_code),
            "contentType": document.get("contentType"),
            "contentLength": document.get("contentLength") or len(pdf_bytes),
            "pages": extracted["pages"],
            "extractionMethod": extracted["extractionMethod"],
            "text": extracted["text"],
            "pageTexts": extracted["pageTexts"],
            "requestId": request_id,
            "cache": {"hit": False, "ttlSeconds": settings.cache_ttl_seconds},
        }
        set_cached(cache_key, {**result, "requestId": None})
        return result
