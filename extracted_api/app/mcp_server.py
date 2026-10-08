"""Capa MCP (Model Context Protocol, transporte Streamable HTTP) sobre la API REST.

No duplica logica: cada herramienta llama, dentro del mismo proceso, a la ruta REST
correspondiente (via ASGI), asi que conserva sus validaciones, filtros, paginacion,
cache, metricas y manejo de errores. La autenticacion es la misma clave de API del
servidor (`API_KEYS`), que se presenta en la cabecera `X-API-Key` o como
`Authorization: Bearer <clave>`. Ninguna clave esta en el codigo.

Solo se exponen consultas de lectura. No se exponen las rutas administrativas
(`/health/satje`, `/api/v1/ops/metrics`), las de generacion de PDF ni las rutas
`/api/juicio*` marcadas como obsoletas.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .config import settings

logger = logging.getLogger("mcp")

router = APIRouter()

PROTOCOLOS_SOPORTADOS = ("2025-06-18", "2025-03-26", "2024-11-05")
NOMBRE_SERVIDOR = "consulta-judicial-ecuador"
VERSION_SERVIDOR = "1.0.0"
MAX_CARACTERES_RESPUESTA = 150_000

# Identificadores aceptados: los mismos caracteres que valida la API REST. Se rechazan
# ademas "..", que permitiria salir de la ruta prevista.
_ID_VALIDO = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_ID_SIN_SEPARADORES = re.compile(r"^[A-Za-z0-9]+$")

_ID_JUICIO = {
    "type": "string",
    "minLength": 1,
    "maxLength": 64,
    "description": (
        "Identificador del juicio. Use el formato sin guiones (ej. 01333202412766). "
        "Si le dan el número con guiones (ej. 01333-2024-12766) también se acepta: "
        "se convierte automáticamente con resolverNumeroProceso."
    ),
}
_FECHA = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}

INSTRUCCIONES = (
    "Consulta de juicios del SATJE (Función Judicial del Ecuador). Todas las herramientas son de solo lectura. "
    "Si una respuesta trae partial=true, success=false o partialErrors no vacío, SATJE respondió a medias: "
    "los datos pueden estar incompletos y conviene repetir la consulta antes de concluir que algo no existe. "
    "Una búsqueda por cédula puede devolver causas penales y de otros acreedores; filtre por rol y por acción."
)

# nombre -> especificacion. 'query' y 'body' mapean argumento -> tipo; 'ids' son los argumentos
# que contienen identificadores y se validan/resuelven; 'path' usa los nombres de argumento.
TOOLS: dict[str, dict[str, Any]] = {
    "buscarJuiciosPorCedula": {
        "title": "Buscar juicios por cédula",
        "description": (
            "Busca los juicios donde la persona figura como actor y/o demandado. Devuelve idJuicio, número, acción, "
            "fecha de ingreso y roles. Si 'partial' es true la lista puede estar incompleta: repita la búsqueda. "
            "Consulte un rol por vez para evitar tiempos agotados."
        ),
        "method": "POST",
        "path": "/api/v1/causas/buscar",
        "body": {"cedula": "string", "roles": "roles", "incluirTodasLasPaginas": "boolean"},
        "props": {
            "cedula": {"type": "string", "pattern": r"^\d{10}(?:001)?$", "description": "Cédula de 10 dígitos (o RUC de 13 terminado en 001), solo números."},
            "roles": {"type": "array", "maxItems": 2, "items": {"type": "string", "enum": ["actor", "demandado"]}, "description": "Roles a buscar; por defecto ambos."},
            "incluirTodasLasPaginas": {"type": "boolean", "description": "true recorre todas las páginas de SATJE (más lento)."},
        },
        "required": ["cedula"],
        "ids": [],
        "timeout": 90,
    },
    "resolverNumeroProceso": {
        "title": "Resolver número de proceso",
        "description": "Convierte un número de proceso con guiones (ej. 01333-2024-12766) en el identificador interno idJuicio que usan las demás consultas.",
        "method": "GET",
        "path": "/api/v1/causas/resolver/{numeroProceso}",
        "props": {"numeroProceso": {"type": "string", "minLength": 1, "maxLength": 64, "description": "Número de proceso, con o sin guiones."}},
        "required": ["numeroProceso"],
        "ids": ["numeroProceso"],
        "timeout": 60,
    },
    "consultarActuacionesCompletas": {
        "title": "Actuaciones completas de un juicio",
        "description": (
            "Todas las actuaciones del juicio, agrupadas por incidente y judicatura (incluye deprecatorios). "
            "Puede ser una respuesta muy grande; para juicios extensos use consultarActuacionesPaginadas."
        ),
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/actuaciones",
        "props": {"idJuicio": _ID_JUICIO},
        "required": ["idJuicio"],
        "ids": ["idJuicio"],
        "timeout": 90,
    },
    "consultarActuacionesPaginadas": {
        "title": "Actuaciones de un juicio, por páginas",
        "description": "Actuaciones del juicio con paginación y filtros por fecha, tipo y presencia de documento. Si partialErrors no está vacío, faltan actuaciones.",
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/actuaciones/paginadas",
        "query": {"page": "integer", "pageSize": "integer", "orden": "string", "fechaDesde": "string", "fechaHasta": "string", "tipo": "string", "tieneDocumento": "boolean"},
        "props": {
            "idJuicio": _ID_JUICIO,
            "page": {"type": "integer", "minimum": 1, "description": "Número de página, desde 1."},
            "pageSize": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Actuaciones por página (1 a 50)."},
            "orden": {"type": "string", "enum": ["asc", "desc"], "description": "asc: más antiguas primero; desc: más recientes primero."},
            "fechaDesde": {**_FECHA, "description": "Fecha mínima AAAA-MM-DD."},
            "fechaHasta": {**_FECHA, "description": "Fecha máxima AAAA-MM-DD."},
            "tipo": {"type": "string", "minLength": 1, "description": "Filtra por texto del tipo de actuación (ej. SENTENCIA, OFICIO)."},
            "tieneDocumento": {"type": "boolean", "description": "true: solo actuaciones con documento adjunto."},
        },
        "required": ["idJuicio"],
        "ids": ["idJuicio"],
        "timeout": 90,
    },
    "buscarResolucionesCandidatas": {
        "title": "Resoluciones candidatas de un juicio",
        "description": "Actuaciones del juicio que pueden ser resoluciones (sentencias, autos), con su documento si lo tienen.",
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/resoluciones",
        "query": {"limit": "integer", "fechaDesde": "string", "fechaHasta": "string", "incluirSinDocumento": "boolean"},
        "props": {
            "idJuicio": _ID_JUICIO,
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Máximo de resoluciones (1 a 50)."},
            "fechaDesde": {**_FECHA, "description": "Fecha mínima AAAA-MM-DD."},
            "fechaHasta": {**_FECHA, "description": "Fecha máxima AAAA-MM-DD."},
            "incluirSinDocumento": {"type": "boolean", "description": "true incluye también las que no tienen documento adjunto."},
        },
        "required": ["idJuicio"],
        "ids": ["idJuicio"],
        "timeout": 90,
    },
    "listarDocumentosDeActuacion": {
        "title": "Documentos de una actuación",
        "description": "Lista los documentos adjuntos a una actuación (nombre e identificador). El código sale de las herramientas de actuaciones o resoluciones.",
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/actuaciones/{codigoActuacion}/documentos",
        "props": {
            "idJuicio": _ID_JUICIO,
            "codigoActuacion": {"type": "string", "minLength": 1, "maxLength": 64, "description": "Código de la actuación (campo 'codigo')."},
        },
        "required": ["idJuicio", "codigoActuacion"],
        "ids": ["idJuicio", "codigoActuacion"],
        "timeout": 60,
    },
    "leerTextoDocumento": {
        "title": "Leer el texto de un documento",
        "description": "Extrae el texto de un documento adjunto (usa OCR si es una imagen; puede tardar). El documentoId sale de listarDocumentosDeActuacion.",
        "method": "POST",
        "path": "/api/v1/documentos/hba/extract-text",
        "body": {"documentoId": "string"},
        "props": {"documentoId": {"type": "string", "minLength": 1, "maxLength": 200, "description": "Identificador del documento."}},
        "required": ["documentoId"],
        "ids": [],
        "timeout": 150,
    },
    "consultarRiesgoAbandono": {
        "title": "Riesgo de abandono procesal",
        "description": "Riesgo de abandono (COGEP art. 245-247): días restantes y estado de alerta del proceso principal y de la unidad deprecada. Es un indicador preventivo, no una declaración judicial.",
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/abandono/riesgo",
        "query": {"fechaCorte": "string", "alertaDias": "integer"},
        "props": {
            "idJuicio": _ID_JUICIO,
            "fechaCorte": {"type": "string", "description": "Fecha de corte AAAA-MM-DD; si se omite se usa hoy."},
            "alertaDias": {"type": "integer", "minimum": 1, "maximum": 180, "description": "Días de anticipación para la alerta (1 a 180)."},
        },
        "required": ["idJuicio"],
        "ids": ["idJuicio"],
        "timeout": 90,
    },
    "consultarMedidasCautelares": {
        "title": "Medidas cautelares de un juicio",
        "description": "Medidas cautelares (prohibición de enajenar, embargo, retención) con orden, oficio, inscripción y evidencia. 'determination' resume el estado; PARTIAL_ANALYSIS indica resultado no concluyente.",
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/medidas-cautelares",
        "props": {"idJuicio": _ID_JUICIO},
        "required": ["idJuicio"],
        "ids": ["idJuicio"],
        "timeout": 120,
    },
    "consultarEstadoSentencia": {
        "title": "Estado de la sentencia de un juicio",
        "description": "Si el juicio tiene sentencia y si consta la razón de ejecutoria, con la evidencia. 'determination' resume el estado; PARTIAL_ANALYSIS indica resultado no concluyente.",
        "method": "GET",
        "path": "/api/v1/causas/{idJuicio}/sentencia/estado",
        "props": {"idJuicio": _ID_JUICIO},
        "required": ["idJuicio"],
        "ids": ["idJuicio"],
        "timeout": 120,
    },
}


class ErrorArgumentos(Exception):
    """Argumentos invalidos: se responde como error de protocolo (-32602)."""


# ---------------------------------------------------------------- autenticacion


def _clave_presentada(request: Request) -> str | None:
    clave = request.headers.get("x-api-key")
    if not clave:
        autorizacion = request.headers.get("authorization", "")
        if autorizacion.lower().startswith("bearer "):
            clave = autorizacion[7:].strip()
    return clave or None


def _clave_valida(request: Request) -> str | None:
    presentada = _clave_presentada(request)
    if not presentada:
        return None
    coincide = False
    for permitida in settings.allowed_api_keys:  # se recorren todas: tiempo constante
        coincide = hmac.compare_digest(presentada.encode(), permitida.encode()) or coincide
    return presentada if coincide else None


# ---------------------------------------------------------------- validacion


def _es_identificador(valor: Any) -> bool:
    return isinstance(valor, str) and bool(_ID_VALIDO.match(valor)) and ".." not in valor


def _validar(nombre: str, spec: dict[str, Any], argumentos: Any) -> dict[str, Any]:
    if argumentos is None:
        argumentos = {}
    if not isinstance(argumentos, dict):
        raise ErrorArgumentos("'arguments' debe ser un objeto.")
    desconocidos = [k for k in argumentos if k not in spec["props"]]
    if desconocidos:
        raise ErrorArgumentos(f"Argumento no reconocido en {nombre}: {str(desconocidos[0])[:40]}")
    for requerido in spec["required"]:
        if requerido not in argumentos or argumentos[requerido] in (None, ""):
            raise ErrorArgumentos(f"Falta el argumento obligatorio '{requerido}' en {nombre}.")
    for clave, valor in argumentos.items():
        esquema = spec["props"][clave]
        tipo = esquema["type"]
        if tipo == "integer" and (isinstance(valor, bool) or not isinstance(valor, int)):
            raise ErrorArgumentos(f"'{clave}' debe ser un número entero.")
        if tipo == "boolean" and not isinstance(valor, bool):
            raise ErrorArgumentos(f"'{clave}' debe ser verdadero o falso.")
        if tipo == "string" and not isinstance(valor, str):
            raise ErrorArgumentos(f"'{clave}' debe ser texto.")
        if tipo == "array":
            if not isinstance(valor, list) or not all(isinstance(x, str) for x in valor):
                raise ErrorArgumentos(f"'{clave}' debe ser una lista de textos.")
            permitidos = esquema.get("items", {}).get("enum")
            if permitidos and any(x not in permitidos for x in valor):
                raise ErrorArgumentos(f"'{clave}' solo admite: {', '.join(permitidos)}.")
        if "enum" in esquema and valor not in esquema["enum"]:
            raise ErrorArgumentos(f"'{clave}' solo admite: {', '.join(esquema['enum'])}.")
    for nombre_id in spec.get("ids", []):
        if nombre_id in argumentos and not _es_identificador(argumentos[nombre_id]):
            raise ErrorArgumentos(f"'{nombre_id}' no es un identificador válido (letras, números, punto, guion; máximo 64).")
    return argumentos


# ---------------------------------------------------------------- llamada a la API REST


def _texto_de_respuesta(respuesta: httpx.Response) -> str:
    try:
        return json.dumps(respuesta.json(), ensure_ascii=False, separators=(",", ":"))
    except ValueError:
        return respuesta.text


def _resultado(texto: str, es_error: bool) -> dict[str, Any]:
    if len(texto) > MAX_CARACTERES_RESPUESTA:
        texto = (
            f"La respuesta tiene {len(texto)} caracteres y supera el límite ({MAX_CARACTERES_RESPUESTA}). "
            "Acote la consulta: use paginación y filtros de fecha o tipo."
        )
        es_error = True
    return {"content": [{"type": "text", "text": texto}], "isError": es_error}


async def _ejecutar(app: Any, nombre: str, spec: dict[str, Any], argumentos: dict[str, Any], clave: str) -> dict[str, Any]:
    cabeceras = {"X-API-Key": clave}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://mcp.interno", timeout=float(spec.get("timeout", 60))
    ) as cliente:
        valores = dict(argumentos)

        # Un número con guiones no es un idJuicio (la API REST responde 404 con guiones): se
        # convierte con el resolver del servidor. Si el resolver no está disponible o falla,
        # se usa el número sin separadores, que es el identificador que ya aceptan las demás
        # rutas, y la propia consulta informa si el juicio no existe.
        if "idJuicio" in spec.get("ids", []):
            id_juicio = valores["idJuicio"]
            if not _ID_SIN_SEPARADORES.match(id_juicio):
                resuelto_id = None
                resuelto = await cliente.get(f"/api/v1/causas/resolver/{quote(id_juicio, safe='')}", headers=cabeceras)
                if resuelto.status_code == 200:
                    try:
                        resuelto_id = resuelto.json()["idJuicio"]
                    except (ValueError, KeyError, TypeError):
                        resuelto_id = None
                if not resuelto_id:
                    logger.warning("mcp resolver no disponible (HTTP %s): se usa el número sin separadores", resuelto.status_code)
                    resuelto_id = re.sub(r"[^A-Za-z0-9]", "", id_juicio)
                if not resuelto_id:
                    return _resultado("El identificador del juicio no tiene letras ni números.", True)
                valores["idJuicio"] = resuelto_id

        ruta = spec["path"]
        for campo in re.findall(r"{(\w+)}", ruta):
            ruta = ruta.replace("{" + campo + "}", quote(str(valores[campo]), safe=""))

        parametros = None
        if spec.get("query"):
            parametros = {}
            for campo in spec["query"]:
                if campo in valores:
                    v = valores[campo]
                    parametros[campo] = ("true" if v else "false") if isinstance(v, bool) else v

        cuerpo = None
        if spec["method"] == "POST":
            cuerpo = {campo: valores[campo] for campo in spec.get("body", {}) if campo in valores}

        respuesta = await cliente.request(spec["method"], ruta, params=parametros, json=cuerpo, headers=cabeceras)
        logger.info("mcp tools/call %s -> HTTP %s", nombre, respuesta.status_code)
        if respuesta.status_code >= 400:
            return _resultado(f"HTTP {respuesta.status_code}: {_texto_de_respuesta(respuesta)[:2000]}", True)
        return _resultado(_texto_de_respuesta(respuesta), False)


# ---------------------------------------------------------------- JSON-RPC


def _error(id_: Any, codigo: int, mensaje: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": codigo, "message": mensaje}}


def _lista_herramientas() -> list[dict[str, Any]]:
    return [
        {
            "name": nombre,
            "title": spec["title"],
            "description": spec["description"],
            "inputSchema": {"type": "object", "properties": spec["props"], "required": spec["required"], "additionalProperties": False},
            "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True},
        }
        for nombre, spec in TOOLS.items()
    ]


async def _procesar(mensaje: Any, request: Request, clave: str) -> dict[str, Any] | None:
    if not isinstance(mensaje, dict) or mensaje.get("jsonrpc") != "2.0":
        return _error(None, -32600, "Solicitud JSON-RPC inválida.")
    if "method" not in mensaje:
        return None  # respuesta del cliente: no requiere contestación
    metodo = mensaje["method"]
    es_notificacion = "id" not in mensaje
    id_ = mensaje.get("id")
    params = mensaje.get("params") or {}

    if es_notificacion:
        return None
    if metodo == "initialize":
        pedida = params.get("protocolVersion") if isinstance(params, dict) else None
        version = pedida if pedida in PROTOCOLOS_SOPORTADOS else PROTOCOLOS_SOPORTADOS[0]
        return {
            "jsonrpc": "2.0",
            "id": id_,
            "result": {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": NOMBRE_SERVIDOR, "version": VERSION_SERVIDOR},
                "instructions": INSTRUCCIONES,
            },
        }
    if metodo == "ping":
        return {"jsonrpc": "2.0", "id": id_, "result": {}}
    if metodo == "tools/list":
        return {"jsonrpc": "2.0", "id": id_, "result": {"tools": _lista_herramientas()}}
    if metodo == "tools/call":
        if not isinstance(params, dict):
            return _error(id_, -32602, "Parámetros inválidos.")
        nombre = params.get("name")
        spec = TOOLS.get(nombre) if isinstance(nombre, str) else None
        if spec is None:
            return _error(id_, -32602, f"Herramienta desconocida: {str(nombre)[:60]}")
        try:
            argumentos = _validar(nombre, spec, params.get("arguments"))
        except ErrorArgumentos as exc:
            return _error(id_, -32602, str(exc))
        try:
            resultado = await _ejecutar(request.app, nombre, spec, argumentos, clave)
        except httpx.TimeoutException:
            resultado = _resultado("La consulta tardó demasiado. SATJE puede estar lento: vuelva a intentarlo.", True)
        except httpx.HTTPError as exc:
            resultado = _resultado(f"Error interno al consultar el servicio ({type(exc).__name__}).", True)
        except Exception as exc:  # noqa: BLE001 - nunca debe escapar como un 500 sin explicacion
            logger.exception("mcp tools/call %s fallo", nombre)
            resultado = _resultado(f"Error interno del servidor MCP ({type(exc).__name__}). Revise el registro del servicio.", True)
        return {"jsonrpc": "2.0", "id": id_, "result": resultado}
    return _error(id_, -32601, f"Método no soportado: {str(metodo)[:60]}")


@router.post("/mcp", include_in_schema=False)
async def mcp_post(request: Request) -> Response:
    clave = _clave_valida(request)
    if clave is None:
        return JSONResponse(
            _error(None, -32001, "No autorizado: falta la clave de API o no es válida."),
            status_code=401,
            headers={"WWW-Authenticate": 'Bearer realm="consulta-judicial-ecuador"'},
        )
    try:
        cuerpo = await request.json()
    except ValueError:
        return JSONResponse(_error(None, -32700, "JSON inválido."), status_code=400)

    if isinstance(cuerpo, list):
        respuestas = [r for r in [await _procesar(m, request, clave) for m in cuerpo] if r is not None]
        return JSONResponse(respuestas) if respuestas else Response(status_code=202)
    respuesta = await _procesar(cuerpo, request, clave)
    return JSONResponse(respuesta) if respuesta is not None else Response(status_code=202)


@router.api_route("/mcp", methods=["GET", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def mcp_metodo_no_permitido() -> Response:
    return Response(status_code=405, headers={"Allow": "POST"})
