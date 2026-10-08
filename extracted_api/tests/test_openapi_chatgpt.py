import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "scripts"))

from openapi_para_chatgpt import OPERACIONES, reducir  # noqa: E402

OPENAPI_REPO = json.loads((RAIZ / "docs" / "openapi.json").read_text(encoding="utf-8"))


def _refs(nodo):
    """Todas las referencias $ref que aparecen en un documento."""
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            if k == "$ref":
                yield v
            else:
                yield from _refs(v)
    elif isinstance(nodo, list):
        for v in nodo:
            yield from _refs(v)


def _mini_spec():
    """Esquema minimo con las 3 rutas que solo existen en el servidor desplegado."""
    spec = json.loads(json.dumps(OPENAPI_REPO))
    spec["paths"]["/api/v1/causas/{id_juicio}/medidas-cautelares"] = {
        "get": {
            "operationId": "x_medidas",
            "parameters": [
                {"name": "id_juicio", "in": "path", "required": True, "schema": {"type": "string"}},
                {"name": "x-api-key", "in": "header", "required": False, "schema": {"type": "string"}},
            ],
            "responses": {"200": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Medidas"}}}}},
        }
    }
    spec["paths"]["/api/v1/causas/{id_juicio}/sentencia/estado"] = {
        "get": {
            "operationId": "x_sentencia",
            "parameters": [{"name": "id_juicio", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Sentencia"}}}}},
        }
    }
    spec["paths"]["/api/v1/causas/resolver/{numero_proceso}"] = {
        "get": {
            "operationId": "x_resolver",
            "parameters": [{"name": "numero_proceso", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"content": {"application/json": {"schema": {"type": "object"}}}}},
        }
    }
    spec["components"]["schemas"]["Medidas"] = {
        "type": "object",
        "properties": {"summary": {"$ref": "#/components/schemas/ResumenMedidas"}},
    }
    spec["components"]["schemas"]["ResumenMedidas"] = {
        "type": "object",
        "properties": {"evidencia": {"type": "array", "items": {"$ref": "#/components/schemas/Evidencia"}}},
    }
    spec["components"]["schemas"]["Evidencia"] = {"type": "object", "properties": {"texto": {"type": "string"}}}
    spec["components"]["schemas"]["Sentencia"] = {"type": "object", "properties": {"determination": {"type": "string"}}}
    spec["components"]["schemas"]["NoUsado"] = {"type": "object"}
    return spec


def test_deja_solo_las_operaciones_pedidas_con_sus_nombres():
    salida, faltantes = reducir(_mini_spec())
    ids = {op["operationId"] for ruta in salida["paths"].values() for op in ruta.values()}
    assert ids == {
        "buscarJuiciosPorCedula",
        "resolverNumeroProceso",
        "consultarActuacionesPaginadas",
        "buscarResolucionesCandidatas",
        "listarDocumentosDeActuacion",
        "consultarRiesgoAbandono",
        "consultarMedidasCautelares",
        "consultarEstadoSentencia",
    }
    assert faltantes == []


def test_no_incluye_rutas_internas_ni_obsoletas():
    salida, _ = reducir(_mini_spec())
    for ruta in salida["paths"]:
        assert "/ops/" not in ruta and "/pdf" not in ruta and "/health" not in ruta
        assert not ruta.startswith("/api/juicio")


def test_la_clave_se_declara_como_autenticacion_y_no_como_parametro():
    salida, _ = reducir(_mini_spec())
    esquema = salida["components"]["securitySchemes"]["ApiKeyAuth"]
    assert esquema == {"type": "apiKey", "in": "header", "name": "X-API-Key"}
    assert salida["security"] == [{"ApiKeyAuth": []}]
    for ruta in salida["paths"].values():
        for op in ruta.values():
            nombres = [p["name"].lower() for p in op.get("parameters", [])]
            assert "x-api-key" not in nombres


def test_incluye_los_modelos_anidados_y_descarta_los_que_no_se_usan():
    salida, _ = reducir(_mini_spec())
    esquemas = salida["components"]["schemas"]
    assert {"Medidas", "ResumenMedidas", "Evidencia", "Sentencia"} <= set(esquemas)
    assert "NoUsado" not in esquemas


def test_todas_las_referencias_se_pueden_resolver():
    salida, _ = reducir(_mini_spec())
    for ref in _refs(salida):
        assert ref.startswith("#/components/schemas/")
        assert ref.split("/")[-1] in salida["components"]["schemas"], ref


def test_las_descripciones_caben_en_el_limite_de_chatgpt():
    salida, _ = reducir(_mini_spec())
    for ruta in salida["paths"].values():
        for op in ruta.values():
            assert 0 < len(op["description"]) <= 300
            assert len(op["summary"]) <= 120


def test_indica_las_operaciones_que_faltan_en_el_esquema_de_origen():
    # El OpenAPI del repositorio no trae las rutas nuevas del servidor desplegado.
    salida, faltantes = reducir(OPENAPI_REPO)
    assert "consultarMedidasCautelares" in faltantes
    assert "consultarEstadoSentencia" in faltantes
    assert "buscarJuiciosPorCedula" not in faltantes


def test_servidor_https_y_todas_las_operaciones_conocidas_cubiertas():
    salida, _ = reducir(_mini_spec())
    assert salida["servers"][0]["url"].startswith("https://")
    assert len(OPERACIONES) == 8


def _spec_como_el_del_servidor():
    """Igual que el que genera FastAPI en el servidor: cada operacion trae su propio
    'security' con un esquema (APIKeyHeader) que el script no conserva."""
    spec = _mini_spec()
    for ruta in spec["paths"].values():
        for op in ruta.values():
            op["security"] = [{"APIKeyHeader": []}]
    spec["components"]["securitySchemes"] = {"APIKeyHeader": {"type": "apiKey", "in": "header", "name": "X-API-Key"}}
    return spec


def test_ninguna_operacion_apunta_a_un_esquema_de_seguridad_que_no_existe():
    salida, _ = reducir(_spec_como_el_del_servidor())
    definidos = set(salida["components"]["securitySchemes"])
    for ruta in salida["paths"].values():
        for op in ruta.values():
            for req in op.get("security", []):
                assert set(req) <= definidos, req
    # la autenticacion queda solo a nivel global
    assert all("security" not in op for ruta in salida["paths"].values() for op in ruta.values())


def test_quita_los_titulos_automaticos_para_reducir_el_tamano():
    spec = _mini_spec()
    spec["components"]["schemas"]["Evidencia"]["properties"]["texto"]["title"] = "Texto"
    salida, _ = reducir(spec)
    assert '"title"' not in json.dumps(salida)


def test_explica_como_llenar_los_identificadores_y_la_busqueda_por_cedula():
    spec = _spec_como_el_del_servidor()
    spec["paths"]["/api/v1/causas/{id_juicio}/actuaciones/paginadas"]["get"]["parameters"][0]["schema"] = {"type": "string"}
    salida, _ = reducir(spec)
    pagina = salida["paths"]["/api/v1/causas/{id_juicio}/actuaciones/paginadas"]["get"]
    id_param = next(p for p in pagina["parameters"] if p["name"] == "id_juicio")
    assert "sin guiones" in id_param["description"]
    solicitud = salida["components"]["schemas"]["BuscarCausasRequest"]["properties"]
    assert "10 d" in solicitud["cedula"]["description"]
    assert solicitud["roles"]["items"]["enum"] == ["actor", "demandado"]
