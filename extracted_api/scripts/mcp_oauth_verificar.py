#!/usr/bin/env python3
"""Verifica la autenticacion OAuth del MCP desplegado. Solo usa la biblioteca estandar.

Comprueba: metadatos del recurso protegido, desafio 401 con `resource_metadata`, rechazo de
credenciales invalidas (incluida la clave estatica de la API usada como clave o como Bearer),
capacidades del servidor de autorizacion (PKCE S256, registro dinamico) y, si se entrega un
token real en la variable MCP_TOKEN, las llamadas MCP autenticadas.

Nunca imprime el token ni la clave de la API.

Antes de desplegar nada, solo con el dominio del proveedor:
    python mcp_oauth_verificar.py --solo-emisor https://TU-TENANT.us.auth0.com

Uso completo:
    MCP_TOKEN=<token de acceso> SATJE_API_KEY=<clave> python mcp_oauth_verificar.py \\
        [--base https://api.asitentekairon.cloud] [--proceso 01333-2024-12766]
(MCP_TOKEN y SATJE_API_KEY son opcionales; sin ellos se omiten esas comprobaciones.)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://api.asitentekairon.cloud"
PROCESO = ""
TOKEN = os.environ.get("MCP_TOKEN", "")
CLAVE = os.environ.get("SATJE_API_KEY", "")
fallos = 0


def http(metodo: str, url: str, cuerpo=None, cabeceras: dict | None = None, timeout: int = 60):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    todas = {"Accept": "application/json, text/event-stream", **({"Content-Type": "application/json"} if cuerpo is not None else {}), **(cabeceras or {})}
    pedido = urllib.request.Request(url, data=datos, headers=todas, method=metodo)
    try:
        with urllib.request.urlopen(pedido, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 0, {}, type(e).__name__


def mcp(metodo: str, params=None, cabeceras: dict | None = None):
    cuerpo = {"jsonrpc": "2.0", "id": 1, "method": metodo, **({"params": params} if params is not None else {})}
    return http("POST", BASE + "/mcp", cuerpo, cabeceras)


def verificar(descripcion: str, condicion: bool, detalle: str = "", critico: bool = True):
    global fallos
    marca = "OK    " if condicion else ("FALLO " if critico else "AVISO ")
    print(marca + descripcion + (f"  [{detalle}]" if detalle else ""))
    if not condicion and critico:
        fallos += 1


def json_o_nada(texto: str):
    try:
        return json.loads(texto)
    except ValueError:
        return None


def comprobar_servidor_de_autorizacion(emisor: str) -> dict | None:
    """Lee los metadatos publicos del proveedor y comprueba lo que ChatGPT necesita."""
    base = emisor if "://" in emisor else "https://" + emisor
    meta = None
    for ruta in ("/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"):
        estado, _, texto = http("GET", base.rstrip("/") + ruta, timeout=20)
        if estado == 200 and isinstance(json_o_nada(texto), dict):
            meta = json_o_nada(texto)
            break
    if meta is None:
        verificar("metadatos del servidor de autorización", False, "no se pudieron leer (¿dominio correcto?)")
        return None
    verificar("PKCE con S256 anunciado", "S256" in (meta.get("code_challenge_methods_supported") or []), "ChatGPT exige PKCE S256")
    verificar(
        "registro dinámico de clientes disponible",
        bool(meta.get("registration_endpoint")),
        "si falta, hay que activarlo o registrar a mano el cliente de ChatGPT",
        critico=False,
    )
    for campo in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        verificar(f"{campo} anunciado", bool(meta.get(campo)))
    if meta.get("jwks_uri"):
        estado, _, texto = http("GET", meta["jwks_uri"], timeout=20)
        claves = (json_o_nada(texto) or {}).get("keys") if estado == 200 else None
        verificar("claves de firma publicadas (JWKS)", bool(claves), f"{len(claves or [])} clave(s)")
    print(f"\n      Emisor EXACTO para el .env (el 'iss' de los tokens):\n      MCP_OAUTH_ISSUER={meta.get('issuer', '')}\n")
    return meta


def main(argv: list[str]) -> int:
    global BASE, PROCESO
    if "--solo-emisor" in argv:
        emisor = argv[argv.index("--solo-emisor") + 1]
        print(f"Comprobando el proveedor de identidad {emisor}\n")
        comprobar_servidor_de_autorizacion(emisor)
        print(f"{'TODO OK' if fallos == 0 else str(fallos) + ' VERIFICACIÓN(ES) FALLARON'}")
        return 0 if fallos == 0 else 1
    if "--base" in argv:
        BASE = argv[argv.index("--base") + 1].rstrip("/")
    if "--proceso" in argv:
        PROCESO = argv[argv.index("--proceso") + 1]
    print(f"Verificando OAuth de {BASE}/mcp\n")

    # 1. metadatos del recurso protegido (RFC 9728)
    estado, _, texto = http("GET", BASE + "/.well-known/oauth-protected-resource/mcp")
    datos = json_o_nada(texto) if estado == 200 else None
    ok = bool(datos) and bool(datos.get("authorization_servers")) and bool(datos.get("resource"))
    verificar("metadatos del recurso protegido", ok, f"HTTP {estado}" + (f" resource={datos['resource']} servidor={datos['authorization_servers'][0]} permisos={datos.get('scopes_supported')}" if ok else " (¿OAuth sin configurar?)"))
    emisor = datos["authorization_servers"][0] if ok else ""

    # 2. sin credenciales: 401 y desafio que apunta a los metadatos
    estado, cab, _ = mcp("tools/list")
    desafio = cab.get("www-authenticate", "")
    verificar("sin credenciales responde 401 con resource_metadata", estado == 401 and "resource_metadata=" in desafio, f"HTTP {estado}")

    # 3. token basura
    estado, cab, _ = mcp("tools/list", cabeceras={"Authorization": "Bearer esto.no.es-un-token"})
    verificar("un token inválido responde 401 invalid_token", estado == 401 and "invalid_token" in cab.get("www-authenticate", ""), f"HTTP {estado}")

    # 4. la clave estatica de la API no sustituye a OAuth
    if CLAVE:
        estado, _, _ = mcp("tools/list", cabeceras={"X-API-Key": CLAVE})
        verificar("X-API-Key no abre el MCP", estado == 401, f"HTTP {estado}")
        estado, _, _ = mcp("tools/list", cabeceras={"Authorization": f"Bearer {CLAVE}"})
        verificar("la clave de la API como Bearer no abre el MCP", estado == 401, f"HTTP {estado}")
    else:
        print("      (se omiten las pruebas con la clave de la API: falta SATJE_API_KEY)")

    # 5. capacidades del servidor de autorizacion
    if emisor:
        comprobar_servidor_de_autorizacion(emisor)

    # 6. con un token real
    if TOKEN:
        cab = {"Authorization": f"Bearer {TOKEN}"}
        estado, _, texto = mcp("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "verificador", "version": "1"}}, cab)
        verificar("initialize con token válido", estado == 200 and "result" in (json_o_nada(texto) or {}), f"HTTP {estado}")
        estado, _, texto = mcp("tools/list", cabeceras=cab)
        herramientas = ((json_o_nada(texto) or {}).get("result") or {}).get("tools") or []
        verificar("tools/list con token válido", estado == 200 and len(herramientas) == 10, f"HTTP {estado}, {len(herramientas)} herramientas")
        if PROCESO:
            estado, _, texto = mcp("tools/call", {"name": "resolverNumeroProceso", "arguments": {"numeroProceso": PROCESO}}, cab)
            r = ((json_o_nada(texto) or {}).get("result") or {})
            verificar("tools/call con token válido", estado == 200 and r.get("isError") is False, f"HTTP {estado}")
    else:
        print("      (se omiten las llamadas autenticadas: falta MCP_TOKEN con un token real del proveedor)")

    print(f"\n{'TODO OK' if fallos == 0 else str(fallos) + ' VERIFICACIÓN(ES) FALLARON'}")
    return 0 if fallos == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
