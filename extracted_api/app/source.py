import json
import re
from collections.abc import Iterable
from html import unescape
from html.parser import HTMLParser
from typing import Any

import httpx

from .config import settings
from .schemas import Juicio, JuicioDetalle


class SourceUnavailable(RuntimeError):
    pass


MOCK_JUICIOS = [
    Juicio(
        id_juicio="01283-2024-00123",
        numero_proceso="01283-2024-00123",
        judicatura="Unidad Judicial Civil de Cuenca",
        materia="Civil",
        accion="Cobro de dinero",
        actor="Demo Actor",
        demandado="Demo Demandado",
        fecha_ingreso="2024-05-10",
        estado="En tramite",
        raw={"mock": True},
    ),
    Juicio(
        id_juicio="01333-2023-00456",
        numero_proceso="01333-2023-00456",
        judicatura="Unidad Judicial Laboral de Azuay",
        materia="Laboral",
        accion="Pago de haberes",
        actor="Demo Trabajador",
        demandado="Demo Empresa",
        fecha_ingreso="2023-11-18",
        estado="Finalizado",
        raw={"mock": True},
    ),
]

SATJE_ACTUACIONES_PATH = (
    "/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales"
)
SATJE_BUSCAR_CAUSAS_PATH = (
    "/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas"
)
SATJE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://procesosjudiciales.funcionjudicial.gob.ec",
    "Referer": "https://procesosjudiciales.funcionjudicial.gob.ec/",
    "User-Agent": "Mozilla/5.0 judicial-api-prototype/0.1",
}


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def get_text(self) -> str:
        return " ".join(self.parts)


def _clean_text(value: Any) -> str | None:
    if value in (None, ""):
        return None

    text = str(value).strip()
    if not text:
        return None

    if "<" in text and ">" in text:
        parser = _HTMLTextExtractor()
        parser.feed(text)
        text = parser.get_text()

    text = unescape(text).replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(line for line in lines if line)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def _first_value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return _clean_text(value) if isinstance(value, str) else value
    return None


def _party_text(value: Any) -> str | None:
    if value in (None, ""):
        return None

    if isinstance(value, str):
        return _clean_text(value)

    if isinstance(value, dict):
        parts = [
            _first_value(
                value,
                "nombre",
                "nombres",
                "nombreActor",
                "nombreDemandado",
                "nombreCompleto",
                "razonSocial",
                "identificacion",
                "cedula",
            )
        ]
        return _clean_text(" ".join(str(part) for part in parts if part not in (None, "")))

    if isinstance(value, list):
        parts = [_party_text(item) for item in value]
        return _clean_text("; ".join(part for part in parts if part))

    return _clean_text(value)


def _extract_rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if not isinstance(data, dict):
        return []

    direct = (
        data.get("data")
        or data.get("items")
        or data.get("content")
        or data.get("causas")
        or data.get("procesos")
        or data.get("resultados")
        or data.get("causasEncontradas")
    )
    if isinstance(direct, list):
        return [item for item in direct if isinstance(item, dict)]

    for value in data.values():
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            return value

    return []


def _normalize_juicio(item: dict[str, Any]) -> Juicio:
    numero = (
        _first_value(
            item,
            "numeroProceso",
            "numero_proceso",
            "numeroCausa",
            "numeroCausaSatje",
            "idJuicio",
            "id",
            "idMovimientoJuicioIncidente",
        )
        or ""
    )
    actor = _first_value(item, "actor", "actores", "ofendido", "actorOfendido")
    demandado = _first_value(item, "demandado", "demandados", "procesado", "demandadoProcesado")

    return Juicio(
        id_juicio=str(
            _first_value(
                item,
                "idJuicio",
                "id",
                "idMovimientoJuicioIncidente",
                "idJuicioIncidente",
                "idProceso",
            )
            or numero
        ).strip(),
        numero_proceso=str(numero).strip(),
        judicatura=_first_value(item, "judicatura", "dependencia", "nombreJudicatura", "unidadJudicial"),
        materia=_first_value(item, "materia", "nombreMateria"),
        accion=_first_value(
            item,
            "accion",
            "accionInfraccion",
            "nombreTipoAccion",
            "tipoAccion",
            "nombreDelito",
        ),
        actor=_party_text(actor),
        demandado=_party_text(demandado),
        fecha_ingreso=_first_value(item, "fechaIngreso", "fecha_ingreso", "fechaSorteo", "fecha"),
        estado=_first_value(item, "estado", "estadoActual", "nombreEstado"),
        raw=item,
    )


def _search_payload(identificacion: str) -> dict[str, Any]:
    return {
        "numeroCausa": "",
        "actor": {
            "cedulaActor": identificacion,
            "nombreActor": "",
        },
        "demandado": {
            "cedulaDemandado": "",
            "nombreDemandado": "",
        },
        "provincia": "",
        "numeroFiscalia": "",
        "recaptcha": "verdad",
        "first": 1,
        "pageSize": 10,
    }


def _official_candidates(identificacion: str) -> Iterable[tuple[str, str, dict[str, Any], dict[str, Any]]]:
    yield "POST", SATJE_BUSCAR_CAUSAS_PATH, _search_payload(identificacion), {
        "page": 1,
        "size": 10,
    }

    # Legacy guesses kept as a fallback only. The captured SATJE route above is
    # the preferred search route for browser-equivalent consultas por cedula.
    params = {
        "criterio": identificacion,
        "busqueda": identificacion,
        "texto": identificacion,
        "identificacion": identificacion,
        "numeroProceso": identificacion,
    }
    yield "GET", "/expel-juicios", {}, params
    yield "GET", "/expel-busqueda-inteligente", {}, params
    yield "GET", "/busqueda-filtros", {}, params
    yield "GET", "/busqueda", {}, params
    yield "GET", "/movimientos", {}, params
    yield "GET", "/expel-movimientos", {}, params
    yield "GET", "/api/causas", {}, {"criterio": identificacion}
    yield "GET", "/api/juicios/{identificacion}", {}, {}


def _captured_detail_payload(id_juicio: str) -> dict[str, Any] | None:
    if not settings.source_detail_payload_json:
        return None

    payload = json.loads(settings.source_detail_payload_json)
    if not isinstance(payload, dict):
        raise ValueError("SOURCE_DETAIL_PAYLOAD_JSON debe ser un objeto JSON")

    payload.setdefault("idJuicio", id_juicio)
    return payload


def _detail_payload(id_juicio: str) -> dict[str, Any]:
    captured_payload = _captured_detail_payload(id_juicio)
    if captured_payload is not None:
        return captured_payload

    return {
        "idJuicio": id_juicio,
        "idMovimientoJuicioIncidente": id_juicio,
        "numeroProceso": id_juicio,
        "id": id_juicio,
        "aplicativo": "web",
    }


def _detail_candidates(id_juicio: str) -> Iterable[tuple[str, str, dict[str, Any]]]:
    payload = _detail_payload(id_juicio)
    yield "POST", SATJE_ACTUACIONES_PATH, payload
    # Legacy guesses kept as fallback while the search endpoint is still being
    # mapped. The official capture above is the preferred SATJE detail route.
    yield "POST", "/actuaciones", payload
    yield "POST", "/expel-actuaciones", payload
    yield "POST", "/movimientos", payload
    yield "POST", "/expel-movimientos", payload
    yield "GET", "/api/juicio/{id_juicio}", {}


def _payload_id_juicio(payload: dict[str, Any]) -> str:
    value = _first_value(payload, "idJuicio", "numeroProceso", "id", "idMovimientoJuicioIncidente")
    return str(value or "satje").strip()


def _official_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.source_base_url,
        timeout=settings.request_timeout_seconds,
        headers=SATJE_HEADERS,
        follow_redirects=True,
    )


async def _fetch_detail_payload(payload: dict[str, Any]) -> Any:
    async with _official_client() as client:
        response = await client.post(SATJE_ACTUACIONES_PATH, json=payload)
        response.raise_for_status()
        return response.json()


def _normalize_actuacion(item: dict[str, Any]) -> dict[str, Any]:
    descripcion = _first_value(
        item,
        "descripcion",
        "detalle",
        "texto",
        "extracto",
        "providencia",
        "observacion",
        "actividad",
    )
    nombre_archivo = _first_value(item, "nombreArchivo", "archivo", "documento")

    return {
        "fecha": _first_value(
            item,
            "fecha",
            "fechaActuacion",
            "fechaActividad",
            "fechaProvidencia",
            "fechaIngreso",
        ),
        "tipo": _first_value(
            item,
            "tipo",
            "tipoActuacion",
            "nombreActuacion",
            "titulo",
            "actividad",
        ),
        "descripcion": descripcion,
        "codigo": _first_value(item, "codigo", "idActuacion"),
        "id_judicatura": _first_value(item, "idJudicatura"),
        "id_juicio": _first_value(item, "idJuicio"),
        "id_movimiento": _first_value(item, "idMovimientoJuicioIncidente"),
        "visible": _first_value(item, "visible"),
        "origen": _first_value(item, "origen"),
        "tabla_referencia": _first_value(item, "ieTablaReferencia"),
        "documento_adjunto": _first_value(item, "ieDocumentoAdjunto"),
        "escape_out": _first_value(item, "escapeOut"),
        "nombre_archivo": nombre_archivo,
        "uuid": _first_value(item, "uuid"),
        "alias": _first_value(item, "alias"),
        "tipo_ingreso": _first_value(item, "tipoIngreso"),
        "id_tabla_referencia": _first_value(item, "idTablaReferencia"),
        "raw": item,
    }


def _extract_actuaciones(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [_normalize_actuacion(item) for item in data if isinstance(item, dict)]
    if not isinstance(data, dict):
        return []

    for key in ("actuaciones", "data", "items", "movimientos", "actividades", "providencias"):
        value = data.get(key)
        if isinstance(value, list):
            return [_normalize_actuacion(item) for item in value if isinstance(item, dict)]

    return [_normalize_actuacion(item) for item in _extract_rows(data)]


def _extract_juicio_data(data: Any, id_juicio: str) -> dict[str, Any]:
    if isinstance(data, dict):
        for key in ("juicio", "proceso", "causa", "cabecera", "datosProceso"):
            value = data.get(key)
            if isinstance(value, dict):
                return value

        rows = _extract_rows(data)
        if rows:
            return rows[0]

    return {"idJuicio": id_juicio, "numeroProceso": id_juicio}


async def buscar_juicios(identificacion: str) -> list[Juicio]:
    if settings.effective_satje_mode == "fixture":
        return MOCK_JUICIOS

    async with _official_client() as client:
        last_error: Exception | None = None
        for method, path, payload, params in _official_candidates(identificacion):
            try:
                url = path.format(identificacion=identificacion)
                if method == "POST":
                    response = await client.post(url, json=payload, params=params)
                else:
                    response = await client.get(url, params=params)
                if response.status_code >= 500:
                    continue
                response.raise_for_status()
                data = response.json()
                return [_normalize_juicio(row) for row in _extract_rows(data)]
            except Exception as exc:  # noqa: BLE001
                last_error = exc

    raise SourceUnavailable(f"No se pudo consultar la fuente oficial: {last_error}")


async def obtener_detalle(id_juicio: str) -> JuicioDetalle:
    if settings.effective_satje_mode == "fixture":
        juicio = next((item for item in MOCK_JUICIOS if item.id_juicio == id_juicio), MOCK_JUICIOS[0])
        return JuicioDetalle(
            juicio=juicio,
            actuaciones=[
                {
                    "fecha": "2024-05-11",
                    "tipo": "Ingreso",
                    "descripcion": "Actuacion de ejemplo para pruebas comerciales.",
                }
            ],
        )

    async with _official_client() as client:
        last_error: Exception | None = None
        for method, path, payload in _detail_candidates(id_juicio):
            try:
                url = path.format(id_juicio=id_juicio)
                if method == "POST":
                    response = await client.post(url, json=payload)
                else:
                    response = await client.get(url, params=payload)
                if response.status_code >= 500:
                    continue
                response.raise_for_status()
                data = response.json()
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        else:
            raise SourceUnavailable(f"No se pudo consultar el detalle oficial: {last_error}")

    juicio_data = _extract_juicio_data(data, id_juicio)
    actuaciones = _extract_actuaciones(data)
    return JuicioDetalle(juicio=_normalize_juicio(juicio_data), actuaciones=actuaciones)


async def obtener_detalle_por_payload(payload: dict[str, Any]) -> JuicioDetalle:
    id_juicio = _payload_id_juicio(payload)
    if settings.effective_satje_mode == "fixture":
        juicio = next((item for item in MOCK_JUICIOS if item.id_juicio == id_juicio), MOCK_JUICIOS[0])
        return JuicioDetalle(
            juicio=juicio.model_copy(update={"id_juicio": id_juicio, "numero_proceso": id_juicio}),
            actuaciones=[
                {
                    "fecha": "2024-05-11",
                    "tipo": "Ingreso",
                    "descripcion": "Actuacion de ejemplo generada desde payload SATJE.",
                }
            ],
        )

    try:
        data = await _fetch_detail_payload(payload)
    except Exception as exc:  # noqa: BLE001
        raise SourceUnavailable(f"No se pudo consultar actuaciones SATJE: {exc}") from exc

    juicio_data = _extract_juicio_data(data, id_juicio)
    actuaciones = _extract_actuaciones(data)
    return JuicioDetalle(juicio=_normalize_juicio(juicio_data), actuaciones=actuaciones)
