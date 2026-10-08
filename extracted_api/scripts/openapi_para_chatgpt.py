#!/usr/bin/env python3
"""Reduce el OpenAPI completo de la API a uno listo para un GPT personalizado de
ChatGPT (Actions).

Deja solo las operaciones que usa el GPT, con nombres claros, declara la clave de
API como autenticacion (cabecera X-API-Key) en vez de como un parametro mas, y
descarta los modelos que ya nadie usa. NO incluye ninguna clave.

Uso (en el servidor, que es el que tiene el esquema real):

    cd <carpeta del proyecto> && .venv/bin/python -B -c \\
      "import json; from app.main import app; print(json.dumps(app.openapi()))" > openapi-vps.json
    python3 openapi_para_chatgpt.py openapi-vps.json > openapi-chatgpt.json
"""
from __future__ import annotations

import copy
import json
import sys

URL_SERVIDOR = "https://api.asitentekairon.cloud"

# (metodo, ruta) -> (operationId, resumen, descripcion de <= 300 caracteres)
OPERACIONES: dict[tuple[str, str], tuple[str, str, str]] = {
    ("post", "/api/v1/causas/buscar"): (
        "buscarJuiciosPorCedula",
        "Busca los juicios de una cédula",
        "Devuelve los juicios donde la persona figura como actor y/o demandado. Si 'partial' es true, SATJE respondió a medias: la lista puede estar incompleta y conviene repetir la búsqueda. Para ver solo los demandados use roles=['demandado'].",
    ),
    ("get", "/api/v1/causas/resolver/{numero_proceso}"): (
        "resolverNumeroProceso",
        "Convierte un número de proceso en el identificador interno",
        "Recibe un número de proceso con guiones (por ejemplo 01333-2024-12766) y devuelve el idJuicio sin guiones que usan las demás consultas.",
    ),
    ("get", "/api/v1/causas/{id_juicio}/actuaciones/paginadas"): (
        "consultarActuacionesPaginadas",
        "Lista las actuaciones de un juicio, por páginas",
        "Actuaciones del juicio con paginación y filtros por fecha, tipo y presencia de documento. Si partialErrors no está vacío, faltan actuaciones. Use el idJuicio sin guiones.",
    ),
    ("get", "/api/v1/causas/{id_juicio}/resoluciones"): (
        "buscarResolucionesCandidatas",
        "Busca resoluciones candidatas de un juicio",
        "Actuaciones del juicio que pueden ser resoluciones (sentencias, autos), con su documento si lo tienen. Sirve para ubicar la resolución que luego se lee con listarDocumentosDeActuacion.",
    ),
    ("get", "/api/v1/causas/{id_juicio}/actuaciones/{codigo_actuacion}/documentos"): (
        "listarDocumentosDeActuacion",
        "Lista los documentos de una actuación",
        "Documentos adjuntos a una actuación (nombre e identificador). El código de actuación sale de consultarActuacionesPaginadas o buscarResolucionesCandidatas.",
    ),
    ("get", "/api/v1/causas/{id_juicio}/abandono/riesgo"): (
        "consultarRiesgoAbandono",
        "Calcula el riesgo de abandono procesal",
        "Riesgo de abandono (COGEP art. 245-247): días restantes y estado de alerta del proceso principal y de la unidad deprecada. Es un indicador preventivo, no una declaración judicial.",
    ),
    ("get", "/api/v1/causas/{id_juicio}/medidas-cautelares"): (
        "consultarMedidasCautelares",
        "Detecta las medidas cautelares de un juicio",
        "Medidas cautelares (prohibición de enajenar, embargo, retención) con su orden, oficio e inscripción y la evidencia. La clave 'determination' resume el estado; si es PARTIAL_ANALYSIS el resultado no es concluyente.",
    ),
    ("get", "/api/v1/causas/{id_juicio}/sentencia/estado"): (
        "consultarEstadoSentencia",
        "Indica si el juicio tiene sentencia y si está ejecutoriada",
        "Estado de la sentencia: si existe, si consta la razón de ejecutoria y la evidencia. La clave 'determination' resume el estado; si es PARTIAL_ANALYSIS el resultado no es concluyente.",
    ),
}


def _refs(nodo) -> set[str]:
    encontrados: set[str] = set()
    if isinstance(nodo, dict):
        for clave, valor in nodo.items():
            if clave == "$ref" and isinstance(valor, str) and valor.startswith("#/components/schemas/"):
                encontrados.add(valor.rsplit("/", 1)[-1])
            else:
                encontrados |= _refs(valor)
    elif isinstance(nodo, list):
        for valor in nodo:
            encontrados |= _refs(valor)
    return encontrados


def reducir(spec: dict) -> tuple[dict, list[str]]:
    """Devuelve (esquema_reducido, operaciones_que_no_estaban_en_el_original)."""
    paths: dict[str, dict] = {}
    faltantes: list[str] = []

    for (metodo, ruta), (operation_id, resumen, descripcion) in OPERACIONES.items():
        original = spec.get("paths", {}).get(ruta, {}).get(metodo)
        if original is None:
            faltantes.append(operation_id)
            continue
        op = copy.deepcopy(original)
        op["operationId"] = operation_id
        op["summary"] = resumen
        op["description"] = descripcion
        op["parameters"] = [p for p in op.get("parameters", []) if str(p.get("name", "")).lower() != "x-api-key"]
        if not op["parameters"]:
            del op["parameters"]
        op.pop("tags", None)
        paths.setdefault(ruta, {})[metodo] = op

    # Solo los modelos que usan las operaciones que quedaron (y los que ellos usan).
    todos = spec.get("components", {}).get("schemas", {})
    necesarios: set[str] = set()
    pendientes = _refs(paths)
    while pendientes:
        nombre = pendientes.pop()
        if nombre in necesarios or nombre not in todos:
            continue
        necesarios.add(nombre)
        pendientes |= _refs(todos[nombre])

    info = copy.deepcopy(spec.get("info", {}))
    info["title"] = "Consulta Judicial Ecuador (SATJE)"
    info["description"] = (
        "Consulta de juicios, actuaciones, resoluciones, medidas cautelares, sentencias y riesgo de "
        "abandono en el SATJE de la Función Judicial del Ecuador. Los identificadores de juicio van sin guiones."
    )

    salida = {
        "openapi": spec.get("openapi", "3.1.0"),
        "info": info,
        "servers": [{"url": (spec.get("servers") or [{"url": URL_SERVIDOR}])[0]["url"]}],
        "security": [{"ApiKeyAuth": []}],
        "paths": paths,
        "components": {
            "securitySchemes": {"ApiKeyAuth": {"type": "apiKey", "in": "header", "name": "X-API-Key"}},
            "schemas": {n: todos[n] for n in sorted(necesarios)},
        },
    }
    return salida, faltantes


def main() -> int:
    if len(sys.argv) != 2:
        print("Uso: openapi_para_chatgpt.py <openapi-completo.json>  > openapi-chatgpt.json", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)
    salida, faltantes = reducir(spec)
    for nombre in faltantes:
        print(f"AVISO: la operación {nombre} no está en el esquema de origen", file=sys.stderr)
    json.dump(salida, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
