# Autenticación OAuth del servidor MCP

ChatGPT no admite claves de API personalizadas para autenticar un conector MCP (según la
documentación de OpenAI citada por el responsable del proyecto: `developers.openai.com/plugins/build/auth`;
**quien escribió esto no pudo abrir esa página**, así que lo que sigue se apoya en la especificación MCP de
autorización y debe contrastarse con ella).

## Qué hace cada pieza

| Pieza | Quién la hace | Estado |
|---|---|---|
| Emitir tokens, inicio de sesión, PKCE, registro de clientes (servidor de autorización) | **Un proveedor de identidad mantenido** (Auth0, Keycloak, Okta, Stytch, WorkOS u otro) | ⏳ **Pendiente: hay que elegirlo y configurarlo** |
| Publicar los metadatos del recurso protegido (RFC 9728) | `app/mcp_server.py` | ✅ implementado y probado |
| Desafío `401` con `WWW-Authenticate: Bearer resource_metadata=…` | `app/mcp_server.py` | ✅ implementado y probado |
| Validar el token: firma, emisor, audiencia, vigencia, permiso, usuario autorizado | `app/mcp_oauth.py` con **PyJWT** | ✅ implementado y probado |
| Llamar a la API REST | El MCP usa una clave **interna** del servidor; el token del usuario nunca se reenvía | ✅ |

El servidor **no implementa** un servidor de autorización propio (a propósito).

## Reglas que aplica el servidor
- Solo acepta tokens JWT firmados con algoritmos asimétricos (`RS256`, `ES256`). Rechaza `none` y `HS*`.
- La firma se verifica con el JWKS del emisor (descubierto desde `/.well-known/openid-configuration`
  o `/.well-known/oauth-authorization-server`, o fijado con `MCP_OAUTH_JWKS_URL`).
- `iss` debe ser **exactamente** `MCP_OAUTH_ISSUER`; `aud` debe ser el recurso (`MCP_OAUTH_AUDIENCE`,
  por defecto `https://api.asitentekairon.cloud/mcp`); `exp` obligatorio; `nbf` respetado (margen 30 s).
- El token debe traer el permiso `judicial:read` (`scope` o `scp`). Falta el permiso → `403 insufficient_scope`.
- **Lista cerrada de usuarios** (`MCP_OAUTH_ALLOWED_USERS`, correos o `sub`). Sin lista no entra nadie.
  Un token válido de un usuario que no está en la lista recibe `403`.
- La clave estática de la API **no** vale como `Bearer` ni en `X-API-Key` cuando OAuth está activo
  (salvo `MCP_ALLOW_INTERNAL_API_KEY=true`, pensado solo para pruebas internas; déjelo apagado).
- Mientras `MCP_OAUTH_ISSUER` **no** esté configurado, `/mcp` conserva la autenticación por clave
  de la API (no apta para ChatGPT). Configurar el emisor la desactiva.

## Variables (no son secretas)
```env
MCP_OAUTH_ISSUER=https://TU-PROVEEDOR/          # el `iss` exacto de los tokens (suele terminar en /)
MCP_OAUTH_AUDIENCE=https://api.asitentekairon.cloud/mcp
MCP_OAUTH_SCOPES=judicial:read
MCP_OAUTH_ALLOWED_USERS=correo1@dominio,correo2@dominio
MCP_PUBLIC_URL=https://api.asitentekairon.cloud
# opcionales: MCP_OAUTH_JWKS_URL=…  MCP_OAUTH_ALGORITHMS=RS256,ES256  MCP_OAUTH_LEEWAY_SECONDS=30
```
Las lee de `.env` o del entorno del servicio. Dependencia nueva: `PyJWT[crypto]` (ya en `requirements.txt`).

## Lista de comprobación del proveedor de identidad
Debe cumplir todo esto (contraste cada punto con la documentación de OpenAI, que no pude leer):

1. **PKCE con S256** anunciado (`code_challenge_methods_supported`).
2. **Registro de clientes:** ChatGPT debe poder obtener un `client_id`. Según el proveedor y lo que exija
   OpenAI, será *registro dinámico* (`registration_endpoint`, RFC 7591) o un cliente **preregistrado**.
3. **Direcciones de retorno (redirect URIs) de ChatGPT:** cópielas de la documentación de OpenAI y regístrelas
   en el cliente. No las conozco con certeza.
4. **Audiencia:** el token de acceso debe llevar `aud` = `https://api.asitentekairon.cloud/mcp` (parámetro
   `resource` / API de recurso, según el proveedor).
5. **Tokens JWT** firmados con RS256/ES256 (no tokens opacos).
6. **Permiso** `judicial:read` definido y concedido a los usuarios autorizados.
7. **Registro de usuarios cerrado** (sin auto-registro) y solo las personas autorizadas; la lista
   `MCP_OAUTH_ALLOWED_USERS` es una segunda barrera, no la única.
8. Emisor: anote el valor **exacto** de `iss` (con o sin `/` final) y póngalo en `MCP_OAUTH_ISSUER`.

## Despliegue en el servidor
```bash
cd /home/ubuntu/.openclaw/workspace/projects/ecuador-judicial-api
.venv/bin/pip install "PyJWT[crypto]>=2.8"                 # 1. dependencia
# 2. copiar app/mcp_oauth.py y app/mcp_server.py; agregar las variables MCP_* al .env
.venv/bin/python -B -c "import app.main; print('importa OK')"
systemctl restart ecuador-judicial-api
.venv/bin/python scripts/mcp_oauth_verificar.py --base https://api.asitentekairon.cloud
```
Con un token real del proveedor (obtenido por sus medios): `MCP_TOKEN=… .venv/bin/python scripts/mcp_oauth_verificar.py --proceso 01333-2024-12766`.
El verificador no imprime el token.

## Rotación de la clave de la API
`scripts/rotar_clave.py` la hace en dos tiempos y **nunca imprime la clave**:
1. `--agregar`: agrega una clave nueva a `API_KEYS` (las anteriores siguen valiendo), la guarda en
   `nueva-clave-api.txt` (permisos 600) y hace respaldo del `.env`. Se reinicia el servicio.
2. Se actualizan los consumidores con la clave del archivo: panel en Vercel (`SATJE_API_KEY`), Worker de
   Cloudflare si lo usa, scripts del servidor, y cualquier acción de GPT que la tenga.
3. Se comprueba que todo responde y entonces `--retirar-anteriores --confirmo` deja solo la nueva.
4. Se borra `nueva-clave-api.txt`.

## Estado y límites
- **No verificado:** la conexión real desde ChatGPT; el proveedor de identidad (aún no existe); qué exige
  OpenAI exactamente (registro, redirect URIs, parámetros).
- Las pruebas del servidor usan tokens firmados con claves generadas en la prueba y un servidor HTTP local que
  imita el JWKS y el descubrimiento. No prueban ningún proveedor real.
