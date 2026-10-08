"""Pruebas de la capa MCP (Streamable HTTP).

Se usa una aplicacion FastAPI de mentira que imita las rutas REST del servidor
(las del repositorio y las que solo existen en el VPS: resolver, medidas-cautelares,
sentencia/estado) y registra cada llamada, para comprobar que el MCP las invoca
con los parametros, la autenticacion y el orden correctos.
"""
import json

import pytest
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.testclient import TestClient

from app.config import settings
from app.mcp_server import TOOLS, router

CLAVE = "clave-de-prueba"
ID_REAL = "01333202412766"


def _app(registro: list):
    app = FastAPI()

    def exigir(x_api_key: str | None = Header(default=None)):
        if x_api_key != CLAVE:
            raise HTTPException(status_code=401, detail="API key invalida")

    async def anotar(request: Request):
        cuerpo = None
        if request.method == "POST":
            cuerpo = await request.json()
        registro.append((request.method, request.url.path, dict(request.query_params), cuerpo))

    @app.get("/api/v1/causas/resolver/{numero_proceso}", dependencies=[Depends(exigir)])
    async def resolver(numero_proceso: str, request: Request):
        await anotar(request)
        if numero_proceso == "99999-2099-99999":
            raise HTTPException(status_code=404, detail="No existe")
        if numero_proceso == "88888-2088-88888":
            raise HTTPException(status_code=500, detail="resolver caido")
        return {"success": True, "idJuicio": numero_proceso.replace("-", ""), "numeroProceso": numero_proceso}

    for sufijo in ["actuaciones", "actuaciones/paginadas", "resoluciones", "medidas-cautelares", "sentencia/estado", "abandono/riesgo"]:

        def hacer(s):
            @app.get(f"/api/v1/causas/{{id_juicio}}/{s}", dependencies=[Depends(exigir)], name=s)
            async def ruta(id_juicio: str, request: Request):
                await anotar(request)
                if id_juicio == "000":
                    raise HTTPException(status_code=422, detail="id invalido")
                return {"success": True, "idJuicio": id_juicio, "ruta": s}

        hacer(sufijo)

    @app.get("/api/v1/causas/{id_juicio}/actuaciones/{codigo}/documentos", dependencies=[Depends(exigir)])
    async def documentos(id_juicio: str, codigo: str, request: Request):
        await anotar(request)
        return {"success": True, "idJuicio": id_juicio, "codigoActuacion": codigo, "data": []}

    @app.post("/api/v1/causas/buscar", dependencies=[Depends(exigir)])
    async def buscar(request: Request):
        await anotar(request)
        cuerpo = await request.json()
        roles = cuerpo.get("roles") or ["actor", "demandado"]
        if cuerpo["cedula"] == "0000000001" and "demandado" in roles:
            raise HTTPException(status_code=504, detail="SATJE_TIMEOUT")
        datos = []
        if "actor" in roles:
            datos.append({"idJuicio": "A1", "accion": "ARCHIVO", "rolesEncontrados": ["actor"]})
        if "demandado" in roles:
            datos += [{"idJuicio": "D1", "accion": "COBRO", "rolesEncontrados": ["demandado"]}, {"idJuicio": "A1", "accion": "ARCHIVO", "rolesEncontrados": ["demandado"]}]
        return {"success": True, "partial": False, "source": "SATJE", "mode": "live", "retrievedAt": "2026-10-08T00:00:00+00:00", "cedula": cuerpo["cedula"], "total": len(datos), "data": datos, "partialErrors": [], "requestId": "req-" + "-".join(roles)}

    @app.post("/api/v1/documentos/hba/extract-text", dependencies=[Depends(exigir)])
    async def texto(request: Request):
        await anotar(request)
        return {"success": True, "text": "contenido"}

    @app.get("/api/v1/ops/metrics", dependencies=[Depends(exigir)])
    async def metricas(request: Request):
        await anotar(request)
        return {"secreto": True}

    app.include_router(router)
    return app


@pytest.fixture()
def contexto(monkeypatch):
    monkeypatch.setattr(settings, "api_keys", CLAVE)
    registro: list = []
    cliente = TestClient(_app(registro))
    return cliente, registro


def rpc(cliente, metodo, params=None, id=1, clave=CLAVE, cabecera="x-api-key"):
    cuerpo = {"jsonrpc": "2.0", "method": metodo, "id": id}
    if params is not None:
        cuerpo["params"] = params
    cabeceras = {}
    if clave:
        cabeceras = {"x-api-key": clave} if cabecera == "x-api-key" else {"Authorization": f"Bearer {clave}"}
    return cliente.post("/mcp", json=cuerpo, headers=cabeceras)


def llamar(cliente, herramienta, argumentos):
    r = rpc(cliente, "tools/call", {"name": herramienta, "arguments": argumentos})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- protocolo


def test_initialize_negocia_la_version_y_anuncia_herramientas(contexto):
    cliente, _ = contexto
    r = rpc(cliente, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    assert r.status_code == 200
    resultado = r.json()["result"]
    assert resultado["protocolVersion"] == "2025-03-26"
    assert "tools" in resultado["capabilities"]
    assert resultado["serverInfo"]["name"]
    assert r.json()["id"] == 1


def test_initialize_con_version_desconocida_responde_la_mas_reciente_que_soporta(contexto):
    cliente, _ = contexto
    r = rpc(cliente, "initialize", {"protocolVersion": "1999-01-01"})
    assert r.json()["result"]["protocolVersion"] == "2025-06-18"


def test_la_notificacion_initialized_responde_202_sin_cuerpo(contexto):
    cliente, _ = contexto
    r = cliente.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers={"x-api-key": CLAVE})
    assert r.status_code == 202
    assert r.content == b""


def test_ping_y_metodo_desconocido(contexto):
    cliente, _ = contexto
    assert rpc(cliente, "ping").json()["result"] == {}
    err = rpc(cliente, "metodo/inexistente").json()["error"]
    assert err["code"] == -32601


def test_json_invalido_es_error_de_parseo(contexto):
    cliente, _ = contexto
    r = cliente.post("/mcp", content=b"{no es json", headers={"x-api-key": CLAVE, "content-type": "application/json"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == -32700


def test_lote_de_mensajes_devuelve_lista_de_respuestas(contexto):
    cliente, _ = contexto
    lote = [{"jsonrpc": "2.0", "id": 1, "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/initialized"}, {"jsonrpc": "2.0", "id": 2, "method": "ping"}]
    r = cliente.post("/mcp", json=lote, headers={"x-api-key": CLAVE})
    assert r.status_code == 200
    assert [x["id"] for x in r.json()] == [1, 2]


def test_get_y_delete_no_estan_permitidos(contexto):
    cliente, _ = contexto
    assert cliente.get("/mcp", headers={"x-api-key": CLAVE}).status_code == 405
    assert cliente.delete("/mcp", headers={"x-api-key": CLAVE}).status_code == 405


# ---------------------------------------------------------------- autenticacion


def test_sin_clave_o_con_clave_incorrecta_responde_401(contexto):
    cliente, registro = contexto
    assert rpc(cliente, "tools/list", clave=None).status_code == 401
    r = rpc(cliente, "tools/list", clave="otra")
    assert r.status_code == 401
    assert "WWW-Authenticate" in r.headers
    assert registro == []


def test_acepta_la_clave_como_bearer(contexto):
    cliente, _ = contexto
    assert rpc(cliente, "tools/list", cabecera="bearer").status_code == 200


def test_la_clave_no_aparece_en_ninguna_respuesta_de_error(contexto):
    cliente, _ = contexto
    texto = rpc(cliente, "tools/list", clave="otra-clave-secreta").text
    assert "otra-clave-secreta" not in texto and CLAVE not in texto


# ---------------------------------------------------------------- herramientas

ESPERADAS = {
    "buscarJuiciosPorCedula",
    "resolverNumeroProceso",
    "consultarActuacionesCompletas",
    "consultarActuacionesPaginadas",
    "buscarResolucionesCandidatas",
    "listarDocumentosDeActuacion",
    "leerTextoDocumento",
    "consultarRiesgoAbandono",
    "consultarMedidasCautelares",
    "consultarEstadoSentencia",
}


def test_tools_list_expone_las_diez_herramientas_de_consulta(contexto):
    cliente, _ = contexto
    herramientas = rpc(cliente, "tools/list").json()["result"]["tools"]
    assert {h["name"] for h in herramientas} == ESPERADAS
    for h in herramientas:
        assert h["description"]
        assert h["inputSchema"]["type"] == "object"
        assert h["annotations"]["readOnlyHint"] is True


def test_no_expone_rutas_administrativas_ni_de_depuracion(contexto):
    cliente, _ = contexto
    for t in TOOLS.values():
        assert "/ops/" not in t["path"] and "/health" not in t["path"] and "/pdf" not in t["path"]
        assert not t["path"].startswith("/api/juicio")


def test_paginadas_conserva_todos_los_filtros(contexto):
    cliente, registro = contexto
    r = llamar(
        cliente,
        "consultarActuacionesPaginadas",
        {"idJuicio": ID_REAL, "page": 2, "pageSize": 10, "orden": "asc", "fechaDesde": "2024-11-01", "fechaHasta": "2025-01-31", "tipo": "OFICIO", "tieneDocumento": True},
    )
    assert r["result"]["isError"] is False
    metodo, ruta, query, _ = registro[-1]
    assert (metodo, ruta) == ("GET", f"/api/v1/causas/{ID_REAL}/actuaciones/paginadas")
    assert query == {"page": "2", "pageSize": "10", "orden": "asc", "fechaDesde": "2024-11-01", "fechaHasta": "2025-01-31", "tipo": "OFICIO", "tieneDocumento": "true"}


def test_resoluciones_riesgo_y_el_resto_usan_su_ruta_y_parametros(contexto):
    cliente, registro = contexto
    llamar(cliente, "buscarResolucionesCandidatas", {"idJuicio": ID_REAL, "limit": 5, "incluirSinDocumento": False})
    assert registro[-1][1:3] == (f"/api/v1/causas/{ID_REAL}/resoluciones", {"limit": "5", "incluirSinDocumento": "false"})
    llamar(cliente, "consultarRiesgoAbandono", {"idJuicio": ID_REAL, "fechaCorte": "2026-10-08", "alertaDias": 60})
    assert registro[-1][1:3] == (f"/api/v1/causas/{ID_REAL}/abandono/riesgo", {"fechaCorte": "2026-10-08", "alertaDias": "60"})
    llamar(cliente, "consultarMedidasCautelares", {"idJuicio": ID_REAL})
    assert registro[-1][1] == f"/api/v1/causas/{ID_REAL}/medidas-cautelares"
    llamar(cliente, "consultarEstadoSentencia", {"idJuicio": ID_REAL})
    assert registro[-1][1] == f"/api/v1/causas/{ID_REAL}/sentencia/estado"
    llamar(cliente, "consultarActuacionesCompletas", {"idJuicio": ID_REAL})
    assert registro[-1][1] == f"/api/v1/causas/{ID_REAL}/actuaciones"
    llamar(cliente, "listarDocumentosDeActuacion", {"idJuicio": ID_REAL, "codigoActuacion": "68880635"})
    assert registro[-1][1] == f"/api/v1/causas/{ID_REAL}/actuaciones/68880635/documentos"


def test_buscar_por_cedula_con_un_rol_envia_ese_rol(contexto):
    cliente, registro = contexto
    llamar(cliente, "buscarJuiciosPorCedula", {"cedula": "0000000000", "roles": ["demandado"], "incluirTodasLasPaginas": True})
    assert len(registro) == 1
    metodo, ruta, _, cuerpo = registro[-1]
    assert (metodo, ruta) == ("POST", "/api/v1/causas/buscar")
    assert cuerpo == {"cedula": "0000000000", "roles": ["demandado"], "incluirTodasLasPaginas": True}


def test_sin_roles_consulta_cada_rol_por_separado_y_une_los_resultados(contexto):
    cliente, registro = contexto
    r = llamar(cliente, "buscarJuiciosPorCedula", {"cedula": "0000000000"})
    cuerpos = sorted(json.dumps(x[3]["roles"]) for x in registro)
    assert cuerpos == ['["actor"]', '["demandado"]'], "cada rol debe ir en su propia llamada"
    datos = json.loads(r["result"]["content"][0]["text"])
    assert datos["success"] is True and datos["partial"] is False
    ids = sorted(x["idJuicio"] for x in datos["data"])
    assert ids == ["A1", "D1"] and datos["total"] == 2  # A1 aparece en los dos roles y no se duplica
    a1 = next(x for x in datos["data"] if x["idJuicio"] == "A1")
    assert sorted(a1["rolesEncontrados"]) == ["actor", "demandado"]
    assert sorted(datos["requestIds"]) == ["req-actor", "req-demandado"]


def test_si_un_rol_falla_devuelve_lo_que_hay_marcado_como_parcial_y_no_como_vacio(contexto):
    cliente, _ = contexto
    r = llamar(cliente, "buscarJuiciosPorCedula", {"cedula": "0000000001"})
    assert r["result"]["isError"] is False
    datos = json.loads(r["result"]["content"][0]["text"])
    assert datos["partial"] is True and datos["success"] is False
    assert [x["idJuicio"] for x in datos["data"]] == ["A1"]  # lo del rol que si respondio
    errores = datos["partialErrors"]
    assert any(e.get("role") == "demandado" and "504" in e.get("message", "") for e in errores)


def test_si_fallan_todos_los_roles_es_un_error_y_no_una_lista_vacia(contexto):
    cliente, _ = contexto
    r = llamar(cliente, "buscarJuiciosPorCedula", {"cedula": "0000000001", "roles": ["demandado"]})
    assert r["result"]["isError"] is True
    assert "504" in r["result"]["content"][0]["text"]


def test_leer_texto_documento_envia_el_documento(contexto):
    cliente, registro = contexto
    r = llamar(cliente, "leerTextoDocumento", {"documentoId": "abc123"})
    assert registro[-1][3] == {"documentoId": "abc123"}
    assert r["result"]["isError"] is False


def test_un_numero_con_guiones_se_resuelve_antes_de_consultar(contexto):
    cliente, registro = contexto
    llamar(cliente, "consultarMedidasCautelares", {"idJuicio": "01333-2024-12766"})
    rutas = [x[1] for x in registro]
    assert rutas == ["/api/v1/causas/resolver/01333-2024-12766", f"/api/v1/causas/{ID_REAL}/medidas-cautelares"]


def test_un_id_sin_guiones_no_llama_al_resolver(contexto):
    cliente, registro = contexto
    llamar(cliente, "consultarMedidasCautelares", {"idJuicio": ID_REAL})
    assert [x[1] for x in registro] == [f"/api/v1/causas/{ID_REAL}/medidas-cautelares"]


def test_si_el_resolver_dice_que_el_proceso_no_existe_se_informa_y_no_se_adivina(contexto):
    cliente, registro = contexto
    r = llamar(cliente, "consultarEstadoSentencia", {"idJuicio": "99999-2099-99999"})
    assert r["result"]["isError"] is True
    assert "404" in r["result"]["content"][0]["text"]
    assert len(registro) == 1, "no debe seguir consultando con un numero inventado"


def test_si_el_resolver_no_esta_disponible_se_usa_el_numero_sin_guiones(contexto):
    # Solo ante un fallo del propio resolver (5xx), no ante un "no existe".
    cliente, registro = contexto
    r = llamar(cliente, "consultarEstadoSentencia", {"idJuicio": "88888-2088-88888"})
    assert [x[1] for x in registro] == [
        "/api/v1/causas/resolver/88888-2088-88888",
        "/api/v1/causas/88888208888888/sentencia/estado",
    ]
    assert r["result"]["isError"] is False


def test_resolver_numero_proceso_devuelve_el_identificador(contexto):
    cliente, _ = contexto
    r = llamar(cliente, "resolverNumeroProceso", {"numeroProceso": "01333-2024-12766"})
    assert json.loads(r["result"]["content"][0]["text"])["idJuicio"] == ID_REAL


# ---------------------------------------------------------------- errores y seguridad


def test_un_error_del_rest_llega_como_resultado_de_error_no_como_fallo_del_protocolo(contexto):
    cliente, _ = contexto
    r = llamar(cliente, "consultarMedidasCautelares", {"idJuicio": "000"})
    assert "error" not in r
    assert r["result"]["isError"] is True
    assert "422" in r["result"]["content"][0]["text"]


def test_herramienta_desconocida_y_argumentos_invalidos(contexto):
    cliente, _ = contexto
    assert rpc(cliente, "tools/call", {"name": "borrarTodo", "arguments": {}}).json()["error"]["code"] == -32602
    falta = rpc(cliente, "tools/call", {"name": "consultarMedidasCautelares", "arguments": {}}).json()
    assert falta["error"]["code"] == -32602 and "idJuicio" in falta["error"]["message"]
    extra = rpc(cliente, "tools/call", {"name": "consultarMedidasCautelares", "arguments": {"idJuicio": ID_REAL, "otro": 1}}).json()
    assert extra["error"]["code"] == -32602
    tipo = rpc(cliente, "tools/call", {"name": "consultarActuacionesPaginadas", "arguments": {"idJuicio": ID_REAL, "page": "dos"}}).json()
    assert tipo["error"]["code"] == -32602


@pytest.mark.parametrize("malo", ["../ops/metrics", "..", "a/b", "01333/../../ops", "a?b=1", "a#b", " ", "x" * 65])
def test_los_identificadores_no_pueden_escapar_de_su_ruta(contexto, malo):
    cliente, registro = contexto
    r = rpc(cliente, "tools/call", {"name": "consultarMedidasCautelares", "arguments": {"idJuicio": malo}}).json()
    assert r["error"]["code"] == -32602
    assert registro == []


def test_nunca_llega_a_las_rutas_operativas(contexto):
    cliente, registro = contexto
    rpc(cliente, "tools/call", {"name": "consultarMedidasCautelares", "arguments": {"idJuicio": "../ops/metrics"}})
    assert not any("/ops/" in x[1] for x in registro)


# ---------------------------------------------------------------- errores inesperados


def test_un_fallo_inesperado_se_informa_como_error_de_herramienta_y_no_como_500(contexto, monkeypatch):
    import app.mcp_server as mcp

    async def roto(*args, **kwargs):
        raise RuntimeError("fallo interno con datos sensibles: clave-de-prueba")

    monkeypatch.setattr(mcp, "_ejecutar", roto)
    cliente, _ = contexto
    r = rpc(cliente, "tools/call", {"name": "consultarMedidasCautelares", "arguments": {"idJuicio": ID_REAL}})
    assert r.status_code == 200
    resultado = r.json()["result"]
    assert resultado["isError"] is True
    texto = resultado["content"][0]["text"]
    assert "RuntimeError" in texto  # dice de que tipo fue, para poder diagnosticar
    assert "clave-de-prueba" not in texto and "datos sensibles" not in texto  # pero no filtra el mensaje


def test_las_instrucciones_del_servidor_piden_tratar_los_expedientes_como_datos(contexto):
    cliente, _ = contexto
    texto = rpc(cliente, "initialize", {"protocolVersion": "2025-06-18"}).json()["result"]["instructions"].lower()
    assert "datos" in texto and "instrucciones" in texto
