"""Pruebas de la autenticacion OAuth del MCP (el servidor actua como servidor de recursos).

Los tokens se firman en la propia prueba con un par de claves RSA generado al vuelo; el
proveedor de identidad real no interviene. Lo que se prueba es la VALIDACION: firma, emisor,
audiencia, vigencia, permisos y usuario autorizado, y que la clave estatica de la API no
sustituya a un token.
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

import app.mcp_server as mcp
from app.config import settings
from app.mcp_oauth import AjustesOAuth, VerificadorToken

EMISOR = "https://idp.ejemplo.test/"
AUDIENCIA = "https://api.asitentekairon.cloud/mcp"
CLAVE_INTERNA = "clave-interna-de-prueba"
URL_PUBLICA = "https://api.asitentekairon.cloud"
METADATOS = f"{URL_PUBLICA}/.well-known/oauth-protected-resource/mcp"


def _par_rsa():
    privada = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return privada, privada.public_key()


PRIVADA, PUBLICA = _par_rsa()
OTRA_PRIVADA, _ = _par_rsa()


def token(**cambios):
    ahora = int(time.time())
    reclamos = {
        "iss": EMISOR,
        "aud": AUDIENCIA,
        "sub": "usuario-1",
        "email": "Andres@Ejemplo.Test",
        "scope": "judicial:read",
        "iat": ahora,
        "exp": ahora + 600,
    }
    reclamos.update(cambios)
    clave = reclamos.pop("_clave", PRIVADA)
    return jwt.encode({k: v for k, v in reclamos.items() if v is not None}, clave, algorithm="RS256", headers={"kid": "k1"})


def ajustes(**cambios):
    base = dict(
        oauth_issuer=EMISOR,
        oauth_audience=AUDIENCIA,
        oauth_scopes="judicial:read",
        oauth_allowed_users="andres@ejemplo.test",
        public_url=URL_PUBLICA,
    )
    base.update(cambios)
    return AjustesOAuth(_env_file=None, **base)


@pytest.fixture()
def cliente(monkeypatch):
    monkeypatch.setattr(settings, "api_keys", CLAVE_INTERNA)
    monkeypatch.setattr(mcp, "ajustes", ajustes())
    # la validacion de firma usa la clave publica de la prueba en lugar de descargar el JWKS
    monkeypatch.setattr(VerificadorToken, "_clave_de_firma", lambda self, tok: PUBLICA)
    llamadas = []

    app = FastAPI()

    def exigir(x_api_key: str | None = Header(default=None)):
        if x_api_key != CLAVE_INTERNA:
            raise HTTPException(status_code=401, detail="API key invalida")

    @app.get("/api/v1/causas/{id_juicio}/sentencia/estado", dependencies=[Depends(exigir)])
    async def sentencia(id_juicio: str, x_api_key: str | None = Header(default=None)):
        llamadas.append(x_api_key)
        return {"success": True, "idJuicio": id_juicio, "determination": "NO_SENTENCE_FOUND"}

    app.include_router(mcp.router)
    c = TestClient(app)
    c.llamadas_rest = llamadas
    return c


def rpc(cliente, tok=None, metodo="tools/list", params=None, extra=None):
    cabeceras = dict(extra or {})
    if tok:
        cabeceras["Authorization"] = f"Bearer {tok}"
    cuerpo = {"jsonrpc": "2.0", "id": 1, "method": metodo}
    if params is not None:
        cuerpo["params"] = params
    return cliente.post("/mcp", json=cuerpo, headers=cabeceras)


# ------------------------------------------------------------- descubrimiento


def test_sin_token_responde_401_con_la_direccion_de_los_metadatos(cliente):
    r = rpc(cliente)
    assert r.status_code == 401
    desafio = r.headers["WWW-Authenticate"]
    assert desafio.startswith("Bearer ")
    assert f'resource_metadata="{METADATOS}"' in desafio
    assert 'scope="judicial:read"' in desafio


@pytest.mark.parametrize("ruta", ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"])
def test_metadatos_del_recurso_protegido(cliente, ruta):
    r = cliente.get(ruta)  # publicos: el cliente los necesita antes de tener un token
    assert r.status_code == 200
    datos = r.json()
    assert datos["resource"] == AUDIENCIA
    assert datos["authorization_servers"] == [EMISOR]
    assert datos["scopes_supported"] == ["judicial:read"]
    assert datos["bearer_methods_supported"] == ["header"]


def test_sin_oauth_configurado_no_hay_metadatos(monkeypatch):
    monkeypatch.setattr(mcp, "ajustes", AjustesOAuth(_env_file=None))
    app = FastAPI()
    app.include_router(mcp.router)
    assert TestClient(app).get("/.well-known/oauth-protected-resource/mcp").status_code == 404


# ------------------------------------------------------------- token valido


def test_un_token_valido_permite_el_protocolo_y_las_herramientas(cliente):
    tok = token()
    assert rpc(cliente, tok, "initialize", {"protocolVersion": "2025-06-18"}).status_code == 200
    assert len(rpc(cliente, tok).json()["result"]["tools"]) == 10
    r = rpc(cliente, tok, "tools/call", {"name": "consultarEstadoSentencia", "arguments": {"idJuicio": "01333202412766"}})
    assert r.status_code == 200 and r.json()["result"]["isError"] is False


def test_la_api_se_consulta_con_la_clave_interna_nunca_con_el_token_del_usuario(cliente):
    tok = token()
    rpc(cliente, tok, "tools/call", {"name": "consultarEstadoSentencia", "arguments": {"idJuicio": "01333202412766"}})
    assert cliente.llamadas_rest == [CLAVE_INTERNA]
    assert tok not in str(cliente.llamadas_rest)


def test_el_permiso_puede_venir_como_lista_scp(cliente):
    assert rpc(cliente, token(scope=None, scp=["judicial:read", "otro"])).status_code == 200


# ------------------------------------------------------------- tokens rechazados


def _rechazado(cliente, tok, estado=401):
    r = rpc(cliente, tok)
    assert r.status_code == estado, r.text
    assert "result" not in r.json()
    assert tok not in r.text  # el token nunca se devuelve
    return r


def test_token_vencido(cliente):
    r = _rechazado(cliente, token(exp=int(time.time()) - 3600, iat=int(time.time()) - 7200))
    assert 'error="invalid_token"' in r.headers["WWW-Authenticate"]


def test_token_aun_no_vigente(cliente):
    _rechazado(cliente, token(nbf=int(time.time()) + 3600))


def test_token_de_otra_audiencia(cliente):
    _rechazado(cliente, token(aud="https://otro.recurso.test/"))


def test_token_de_otro_emisor(cliente):
    _rechazado(cliente, token(iss="https://idp-falso.test/"))


def test_token_firmado_con_otra_clave(cliente):
    _rechazado(cliente, token(_clave=OTRA_PRIVADA))


def test_token_sin_firma_alg_none(cliente):
    sin_firma = jwt.encode({"iss": EMISOR, "aud": AUDIENCIA, "sub": "x", "scope": "judicial:read", "exp": int(time.time()) + 600}, key=None, algorithm="none")
    _rechazado(cliente, sin_firma)


def test_confusion_de_algoritmo_hs256_firmado_con_la_clave_publica(cliente):
    publica_pem = PUBLICA.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    # PyJWT se niega a firmar HS256 con una clave PEM; se arma a mano el token malicioso.
    # El ataque: firmar con HMAC usando como secreto la clave PUBLICA, que es conocida.
    import base64, hashlib, hmac, json

    def b64(b):
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

    cabecera = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": "k1"}).encode())
    cuerpo = b64(json.dumps({"iss": EMISOR, "aud": AUDIENCIA, "sub": "x", "email": "andres@ejemplo.test", "scope": "judicial:read", "exp": int(time.time()) + 600}).encode())
    firma = b64(hmac.new(publica_pem, f"{cabecera}.{cuerpo}".encode(), hashlib.sha256).digest())
    _rechazado(cliente, f"{cabecera}.{cuerpo}.{firma}")


def test_texto_que_no_es_un_token(cliente):
    _rechazado(cliente, "esto-no-es-un-jwt")


def test_la_clave_estatica_de_la_api_enviada_como_bearer_no_sustituye_a_oauth(cliente):
    _rechazado(cliente, CLAVE_INTERNA)


def test_la_clave_estatica_en_x_api_key_no_abre_el_mcp(cliente):
    r = rpc(cliente, None, extra={"X-API-Key": CLAVE_INTERNA})
    assert r.status_code == 401


def test_la_clave_interna_solo_abre_el_mcp_si_se_habilita_expresamente(monkeypatch, cliente):
    monkeypatch.setattr(mcp, "ajustes", ajustes(allow_internal_api_key=True))
    assert rpc(cliente, None, extra={"X-API-Key": CLAVE_INTERNA}).status_code == 200
    assert rpc(cliente, None, extra={"X-API-Key": "otra"}).status_code == 401
    _rechazado(cliente, CLAVE_INTERNA)  # y sigue sin valer como Bearer


# ------------------------------------------------------------- permisos y usuarios


def test_token_sin_el_permiso_requerido(cliente):
    r = _rechazado(cliente, token(scope="otro:permiso"), estado=403)
    assert 'error="insufficient_scope"' in r.headers["WWW-Authenticate"]


def test_token_sin_ningun_permiso(cliente):
    _rechazado(cliente, token(scope=None), estado=403)


def test_usuario_fuera_de_la_lista_autorizada(cliente):
    _rechazado(cliente, token(email="intruso@ejemplo.test", sub="otro"), estado=403)


def test_sin_lista_de_usuarios_configurada_se_niega_a_todos(monkeypatch, cliente):
    monkeypatch.setattr(mcp, "ajustes", ajustes(oauth_allowed_users=""))
    _rechazado(cliente, token(), estado=403)


def test_el_usuario_autorizado_se_reconoce_por_correo_sin_importar_mayusculas_o_por_sub(monkeypatch, cliente):
    assert rpc(cliente, token(email="ANDRES@EJEMPLO.TEST")).status_code == 200
    monkeypatch.setattr(mcp, "ajustes", ajustes(oauth_allowed_users="usuario-1"))
    assert rpc(cliente, token(email=None)).status_code == 200


def test_la_respuesta_a_un_rechazo_no_revela_la_configuracion(cliente):
    r = rpc(cliente, token(email="intruso@ejemplo.test", sub="otro"))
    assert "andres@ejemplo.test" not in r.text.lower()


# ------------------------------------------------------------- JWKS real (sin sustituir la descarga)

import json as _json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _jwk(publica, kid):
    datos = _json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(publica))
    datos.update({"kid": kid, "use": "sig", "alg": "RS256"})
    return datos


@pytest.fixture()
def idp_local():
    """Un 'proveedor de identidad' minimo que sirve el descubrimiento y el JWKS por HTTP."""
    estado = {"claves": [_jwk(PUBLICA, "k1")], "pedidos": []}

    class Manejador(BaseHTTPRequestHandler):
        def do_GET(self):
            estado["pedidos"].append(self.path)
            if self.path == "/.well-known/openid-configuration":
                cuerpo = {"issuer": estado["base"], "jwks_uri": estado["base"] + "jwks-real.json"}
            elif self.path == "/jwks-real.json":
                cuerpo = {"keys": estado["claves"]}
            else:
                self.send_response(404)
                self.end_headers()
                return
            datos = _json.dumps(cuerpo).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(datos)

        def log_message(self, *args):  # silencio
            pass

    servidor = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
    estado["base"] = f"http://127.0.0.1:{servidor.server_address[1]}/"
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    yield estado
    servidor.shutdown()


def _cliente_con_idp_real(monkeypatch, idp):
    monkeypatch.setattr(settings, "api_keys", CLAVE_INTERNA)
    monkeypatch.setattr(mcp, "ajustes", ajustes(oauth_issuer=idp["base"]))
    app = FastAPI()
    app.include_router(mcp.router)
    return TestClient(app)


def test_valida_un_token_con_el_jwks_descubierto_por_http(monkeypatch, idp_local):
    cliente = _cliente_con_idp_real(monkeypatch, idp_local)
    r = rpc(cliente, token(iss=idp_local["base"]))
    assert r.status_code == 200
    assert "/.well-known/openid-configuration" in idp_local["pedidos"] and "/jwks-real.json" in idp_local["pedidos"]


def test_un_token_con_una_clave_que_el_emisor_no_publica_se_rechaza(monkeypatch, idp_local):
    cliente = _cliente_con_idp_real(monkeypatch, idp_local)
    desconocido = jwt.encode(
        {"iss": idp_local["base"], "aud": AUDIENCIA, "sub": "usuario-1", "scope": "judicial:read", "exp": int(time.time()) + 600},
        OTRA_PRIVADA,
        algorithm="RS256",
        headers={"kid": "no-publicada"},
    )
    assert rpc(cliente, desconocido).status_code == 401


def test_si_el_emisor_no_responde_el_acceso_se_niega(monkeypatch):
    monkeypatch.setattr(settings, "api_keys", CLAVE_INTERNA)
    monkeypatch.setattr(mcp, "ajustes", ajustes(oauth_issuer="http://127.0.0.1:9/"))  # puerto sin servicio
    app = FastAPI()
    app.include_router(mcp.router)
    r = rpc(TestClient(app), token(iss="http://127.0.0.1:9/"))
    assert r.status_code == 401


# ------------------------------------------------------------- comprobacion previa del proveedor (solo el emisor)

import importlib


def _verificador_script():
    import sys as _sys
    from pathlib import Path as _P

    _sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
    modulo = importlib.import_module("mcp_oauth_verificar")
    return importlib.reload(modulo)


@pytest.fixture()
def idp_metadatos():
    """Servidor HTTP que imita los metadatos de un proveedor, configurable por prueba."""
    estado = {"meta": {}}

    class Manejador(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path in ("/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"):
                datos = _json.dumps(estado["meta"]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(datos)
            elif self.path == "/.well-known/jwks.json":
                datos = _json.dumps({"keys": [{"kty": "RSA", "kid": "k1"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(datos)
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *args):
            pass

    servidor = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
    estado["base"] = f"http://127.0.0.1:{servidor.server_address[1]}/"
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    yield estado
    servidor.shutdown()


def test_solo_emisor_aprueba_un_proveedor_completo_e_indica_el_valor_exacto_del_emisor(idp_metadatos, capsys):
    base = idp_metadatos["base"]
    idp_metadatos["meta"] = {
        "issuer": base,
        "authorization_endpoint": base + "authorize",
        "token_endpoint": base + "token",
        "jwks_uri": base + ".well-known/jwks.json",
        "registration_endpoint": base + "oidc/register",
        "code_challenge_methods_supported": ["S256", "plain"],
    }
    codigo = _verificador_script().main(["x", "--solo-emisor", base])
    salida = capsys.readouterr().out
    assert codigo == 0
    assert f"MCP_OAUTH_ISSUER={base}" in salida  # el valor exacto para el .env
    assert "registro dinámico de clientes" in salida and "AVISO" not in salida


def test_solo_emisor_senala_lo_que_falta(idp_metadatos, capsys):
    base = idp_metadatos["base"]
    idp_metadatos["meta"] = {"issuer": base, "authorization_endpoint": base + "a", "token_endpoint": base + "t", "jwks_uri": base + "j"}
    codigo = _verificador_script().main(["x", "--solo-emisor", base])
    salida = capsys.readouterr().out
    assert codigo == 1  # sin PKCE S256 no sirve
    assert "FALLO PKCE" in salida or "FALLO PKCE con S256" in salida
    assert "AVISO registro dinámico" in salida  # falta el registro dinamico: aviso, no fallo


def test_solo_emisor_acepta_un_dominio_sin_esquema(idp_metadatos, capsys):
    host = idp_metadatos["base"].replace("http://", "")
    idp_metadatos["meta"] = {"issuer": idp_metadatos["base"], "authorization_endpoint": "a", "token_endpoint": "t", "jwks_uri": "j", "code_challenge_methods_supported": ["S256"]}
    # sin esquema el script prueba https primero; con un servidor http de prueba debe indicar que no pudo leerlo, sin romperse
    codigo = _verificador_script().main(["x", "--solo-emisor", host])
    assert codigo in (0, 1)
