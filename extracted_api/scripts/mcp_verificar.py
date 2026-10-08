#!/usr/bin/env python3
"""Verifica una capa MCP desplegada y responde si la API acepta numeros con guiones.

Lee la clave de la variable de entorno SATJE_API_KEY (nunca se imprime) y solo usa la
biblioteca estandar. Imprime estados y nombres de campos, NO el contenido de los juicios.

Uso:
    SATJE_API_KEY=... python mcp_verificar.py [--base http://127.0.0.1:8010] [--proceso 01333-2024-12766]
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8010"
PROCESO = "01333-2024-12766"
CLAVE = os.environ.get("SATJE_API_KEY", "")
fallos = 0


def llamar(metodo: str, ruta: str, cuerpo=None, clave: str | None = CLAVE, timeout: int = 150):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    cabeceras = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if clave:
        cabeceras["X-API-Key"] = clave
    pedido = urllib.request.Request(BASE + ruta, data=datos, headers=cabeceras, method=metodo)
    try:
        with urllib.request.urlopen(pedido, timeout=timeout) as r:
            texto = r.read().decode("utf-8", "replace")
            return r.status, texto
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 0, f"{type(e).__name__}"


def rpc(metodo: str, params=None, id_=1, clave: str | None = CLAVE):
    cuerpo = {"jsonrpc": "2.0", "id": id_, "method": metodo}
    if params is not None:
        cuerpo["params"] = params
    estado, texto = llamar("POST", "/mcp", cuerpo, clave=clave)
    try:
        return estado, json.loads(texto) if texto else None
    except ValueError:
        return estado, None


def verificar(descripcion: str, condicion: bool, detalle: str = ""):
    global fallos
    print(("OK    " if condicion else "FALLO ") + descripcion + (f"  [{detalle}]" if detalle else ""))
    if not condicion:
        fallos += 1


def forma(valor, profundidad=0):
    """Solo la estructura (nombres de campos y tipos), nunca los valores."""
    if isinstance(valor, dict):
        return "{" + ",".join(sorted(valor)) + "}" if profundidad else "{" + ",".join(sorted(valor)) + "}"
    if isinstance(valor, list):
        return f"lista({len(valor)})"
    return type(valor).__name__


def resultado_de(herramienta: str, argumentos: dict):
    estado, cuerpo = rpc("tools/call", {"name": herramienta, "arguments": argumentos}, id_=9)
    if not cuerpo or "result" not in cuerpo:
        return estado, None, False, (cuerpo or {}).get("error")
    r = cuerpo["result"]
    texto = r["content"][0]["text"] if r.get("content") else ""
    try:
        datos = json.loads(texto)
    except ValueError:
        datos = None
    return estado, datos, bool(r.get("isError")), texto[:160] if datos is None else None


def main(argv: list[str]) -> int:
    global BASE, PROCESO
    if "--base" in argv:
        BASE = argv[argv.index("--base") + 1].rstrip("/")
    if "--proceso" in argv:
        PROCESO = argv[argv.index("--proceso") + 1]
    if not CLAVE:
        print("Falta la variable SATJE_API_KEY.")
        return 2
    print(f"Verificando {BASE}/mcp con el proceso {PROCESO}\n")

    # 1. autenticacion
    estado, _ = rpc("tools/list", clave=None)
    verificar("sin clave responde 401", estado == 401, f"HTTP {estado}")
    estado, _ = rpc("tools/list", clave="clave-incorrecta-de-prueba")
    verificar("con clave incorrecta responde 401", estado == 401, f"HTTP {estado}")

    # 2. initialize
    estado, cuerpo = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "verificador", "version": "1"}})
    ok = estado == 200 and bool(cuerpo) and "result" in cuerpo
    verificar("initialize", ok, f"protocolVersion={cuerpo['result']['protocolVersion']} servidor={cuerpo['result']['serverInfo']['name']}" if ok else f"HTTP {estado}")

    # 3. notificacion
    estado, _ = llamar("POST", "/mcp", {"jsonrpc": "2.0", "method": "notifications/initialized"})
    verificar("notifications/initialized responde 202", estado == 202, f"HTTP {estado}")

    # 4. tools/list
    estado, cuerpo = rpc("tools/list")
    nombres = sorted(t["name"] for t in cuerpo["result"]["tools"]) if cuerpo and "result" in cuerpo else []
    verificar("tools/list", estado == 200 and len(nombres) == 10, f"{len(nombres)} herramientas")
    for n in nombres:
        print("        -", n)

    # 5. resolver
    estado, datos, es_error, extra = resultado_de("resolverNumeroProceso", {"numeroProceso": PROCESO})
    verificar("resolverNumeroProceso", datos is not None and not es_error and "idJuicio" in datos, f"idJuicio={datos.get('idJuicio')}" if datos else str(extra))
    id_real = (datos or {}).get("idJuicio")

    # 6. consultas reales a traves de MCP, con el numero CON guiones
    for herramienta in ("consultarMedidasCautelares", "consultarEstadoSentencia"):
        estado, datos, es_error, extra = resultado_de(herramienta, {"idJuicio": PROCESO})
        ok = datos is not None and not es_error
        detalle = f"success={datos.get('success')} partial={datos.get('partial')} determination={datos.get('determination')}" if ok else str(extra)
        verificar(f"{herramienta} (número con guiones, vía MCP)", ok, detalle)

    estado, datos, es_error, extra = resultado_de("consultarActuacionesPaginadas", {"idJuicio": id_real or PROCESO, "pageSize": 1})
    ok = datos is not None and not es_error
    verificar("consultarActuacionesPaginadas (pageSize=1)", ok, f"campos={forma(datos)} pagination={datos.get('pagination')}" if ok else str(extra))

    estado, datos, es_error, extra = resultado_de("consultarRiesgoAbandono", {"idJuicio": id_real or PROCESO})
    ok = datos is not None and not es_error
    verificar("consultarRiesgoAbandono", ok, f"success={datos.get('success')} partial={datos.get('partial')}" if ok else str(extra))

    # 7. ¿la API REST acepta numeros con guiones directamente? (sin pasar por MCP)
    print("\nREST directo: ¿acepta el número con guiones? (código HTTP)")
    print(f"{'ruta':45} {'sin guiones':>12} {'con guiones':>12}")
    id_plano = id_real or PROCESO.replace("-", "")
    for sufijo in ("actuaciones", "actuaciones/paginadas?pageSize=1", "resoluciones?limit=1", "medidas-cautelares", "sentencia/estado", "abandono/riesgo"):
        plano, _ = llamar("GET", f"/api/v1/causas/{id_plano}/{sufijo}")
        guiones, _ = llamar("GET", f"/api/v1/causas/{PROCESO}/{sufijo}")
        print(f"{sufijo:45} {plano:>12} {guiones:>12}")

    print(f"\n{'TODO OK' if fallos == 0 else str(fallos) + ' VERIFICACIÓN(ES) FALLARON'}")
    return 0 if fallos == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
