"""Validacion de tokens OAuth 2.1 para el servidor MCP (servidor de recursos).

Este modulo NO es un servidor de autorizacion: la emision de tokens, el inicio de sesion, el
registro de clientes y PKCE son del proveedor de identidad (IdP) que se configure. Aqui solo se
valida lo que el MCP recibe, con PyJWT (biblioteca mantenida) y siguiendo la especificacion de
autorizacion de MCP (RFC 9728 para los metadatos del recurso protegido, RFC 6750 para el desafio
`WWW-Authenticate`):

- firma verificada contra el JWKS del emisor, solo con algoritmos asimetricos permitidos
  (se rechazan `none` y los HS*, que permitirian confundir la clave publica con un secreto);
- emisor (`iss`), audiencia (`aud`, este recurso), vigencia (`exp`, `nbf`);
- permiso requerido (`scope` o `scp`);
- usuario autorizado (lista cerrada: si no hay lista, no entra nadie).

Configuracion por variables de entorno o `.env` (prefijo MCP_). Ninguna es un secreto.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("mcp.oauth")


class AjustesOAuth(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MCP_", env_file=".env", extra="ignore")

    oauth_issuer: str = ""  # URL exacta del emisor (el `iss` de los tokens). Vacio = OAuth desactivado.
    oauth_audience: str = ""  # identificador de este recurso; por defecto <public_url>/mcp
    oauth_jwks_url: str = ""  # opcional; si falta se descubre desde el emisor
    oauth_scopes: str = "judicial:read"  # permisos requeridos (separados por espacio o coma)
    oauth_allowed_users: str = ""  # correos o `sub` autorizados, separados por coma
    oauth_algorithms: str = "RS256,ES256"
    oauth_leeway_seconds: int = 30
    public_url: str = "https://api.asitentekairon.cloud"
    # Solo para integraciones internas (p. ej. el verificador): acepta X-API-Key en /mcp.
    allow_internal_api_key: bool = False

    @property
    def habilitado(self) -> bool:
        return bool(self.oauth_issuer.strip())

    @property
    def audiencia(self) -> str:
        return self.oauth_audience.strip() or f"{self.public_url.rstrip('/')}/mcp"

    @property
    def permisos(self) -> list[str]:
        return [p for p in self.oauth_scopes.replace(",", " ").split() if p]

    @property
    def usuarios(self) -> set[str]:
        return {u.strip().lower() for u in self.oauth_allowed_users.split(",") if u.strip()}

    @property
    def algoritmos(self) -> list[str]:
        return [a.strip() for a in self.oauth_algorithms.split(",") if a.strip()]

    @property
    def url_metadatos(self) -> str:
        return f"{self.public_url.rstrip('/')}/.well-known/oauth-protected-resource/mcp"


class ErrorToken(Exception):
    """Token rechazado. `codigo` es el valor `error` de RFC 6750 (o None si no hay token)."""

    def __init__(self, estado: int, codigo: str | None, descripcion: str):
        super().__init__(descripcion)
        self.estado = estado
        self.codigo = codigo
        self.descripcion = descripcion


class VerificadorToken:
    def __init__(self, ajustes: AjustesOAuth):
        self.ajustes = ajustes
        self._cliente_jwks: PyJWKClient | None = None

    # -- JWKS ------------------------------------------------------------

    def _url_jwks(self) -> str:
        if self.ajustes.oauth_jwks_url.strip():
            return self.ajustes.oauth_jwks_url.strip()
        base = self.ajustes.oauth_issuer.rstrip("/")
        for ruta in ("/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"):
            try:
                respuesta = httpx.get(base + ruta, timeout=10)
                if respuesta.status_code == 200 and respuesta.json().get("jwks_uri"):
                    return respuesta.json()["jwks_uri"]
            except (httpx.HTTPError, ValueError):
                continue
        return base + "/.well-known/jwks.json"

    def _clave_de_firma(self, token: str) -> Any:
        """Clave publica que firmo el token (JWKS del emisor, en cache)."""
        if self._cliente_jwks is None:
            self._cliente_jwks = PyJWKClient(self._url_jwks(), cache_keys=True, lifespan=3600, timeout=10)
        return self._cliente_jwks.get_signing_key_from_jwt(token).key

    # -- validacion --------------------------------------------------------

    def verificar(self, token: str) -> dict[str, Any]:
        a = self.ajustes
        try:
            cabecera = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise ErrorToken(401, "invalid_token", "El token no tiene formato válido") from None
        if cabecera.get("alg") not in a.algoritmos:
            raise ErrorToken(401, "invalid_token", "Algoritmo de firma no permitido")

        try:
            clave = self._clave_de_firma(token)
        except Exception:  # noqa: BLE001 - JWKS inaccesible o clave desconocida
            logger.warning("mcp oauth: no se pudo obtener la clave de firma")
            raise ErrorToken(401, "invalid_token", "No se pudo validar la firma del token") from None

        try:
            reclamos = jwt.decode(
                token,
                clave,
                algorithms=a.algoritmos,
                audience=a.audiencia,
                issuer=a.oauth_issuer,
                leeway=a.oauth_leeway_seconds,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.ExpiredSignatureError:
            raise ErrorToken(401, "invalid_token", "El token venció") from None
        except jwt.PyJWTError:
            raise ErrorToken(401, "invalid_token", "Token inválido") from None

        concedidos = self._permisos_concedidos(reclamos)
        faltantes = [p for p in a.permisos if p not in concedidos]
        if faltantes:
            raise ErrorToken(403, "insufficient_scope", "El token no tiene el permiso requerido")

        if not self._usuario_autorizado(reclamos):
            logger.warning("mcp oauth: usuario no autorizado (sub=%s)", str(reclamos.get("sub", ""))[:12])
            raise ErrorToken(403, None, "Usuario no autorizado")
        return reclamos

    @staticmethod
    def _permisos_concedidos(reclamos: dict[str, Any]) -> set[str]:
        valor = reclamos.get("scope", reclamos.get("scp"))
        if isinstance(valor, str):
            return set(valor.replace(",", " ").split())
        if isinstance(valor, list):
            return {str(x) for x in valor}
        return set()

    def _usuario_autorizado(self, reclamos: dict[str, Any]) -> bool:
        permitidos = self.ajustes.usuarios
        if not permitidos:
            return False  # sin lista no entra nadie: nunca acceso abierto
        sub = str(reclamos.get("sub", "")).strip().lower()
        if sub and sub in permitidos:
            return True
        correo = str(reclamos.get("email", "")).strip().lower()
        return bool(correo) and reclamos.get("email_verified") is not False and correo in permitidos
