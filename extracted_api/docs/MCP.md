# Servidor MCP de Consulta Judicial Ecuador

Capa MCP (Model Context Protocol, transporte **Streamable HTTP**) montada sobre la
misma API REST. No duplica lógica: cada herramienta llama a la ruta REST
correspondiente dentro del mismo proceso, así que conserva sus validaciones,
filtros, paginación, caché, métricas y errores.

- **Código:** `app/mcp_server.py`. Se activa con dos líneas al final de `app/main.py`
  (las agrega `scripts/install_mcp.py`, con respaldo).
- **Endpoint:** `POST /mcp` (misma dirección y puerto que la API; en producción
  `https://api.asitentekairon.cloud/mcp`, una vez instalada y reiniciada la API).
- **Transporte:** Streamable HTTP, respuestas `application/json`, sin sesión (`Mcp-Session-Id`
  no se emite), sin flujo SSE (`GET /mcp` responde 405). Versiones de protocolo soportadas:
  `2025-06-18`, `2025-03-26`, `2024-11-05`.
- **Autenticación:** la misma clave de API del servidor (`API_KEYS` en el `.env`), enviada
  como cabecera `X-API-Key: <clave>` **o** `Authorization: Bearer <clave>`. Sin clave o con
  clave incorrecta responde `401`. La clave no está en el código.
- **Solo lectura:** todas las herramientas llevan `readOnlyHint: true`.

## Herramientas

| Herramienta | Ruta REST que usa | Notas |
|---|---|---|
| `buscarJuiciosPorCedula` | `POST /api/v1/causas/buscar` | `cedula`, `roles[]` (actor, demandado), `incluirTodasLasPaginas`. |
| `resolverNumeroProceso` | `GET /api/v1/causas/resolver/{numero}` | Número con guiones → `idJuicio`. |
| `consultarActuacionesCompletas` | `GET /api/v1/causas/{id}/actuaciones` | Respuesta muy grande: sobre 150 000 caracteres devuelve un error que pide paginar. |
| `consultarActuacionesPaginadas` | `GET /api/v1/causas/{id}/actuaciones/paginadas` | `page`, `pageSize` (1-50), `orden`, `fechaDesde`, `fechaHasta`, `tipo`, `tieneDocumento`. |
| `buscarResolucionesCandidatas` | `GET /api/v1/causas/{id}/resoluciones` | `limit` (1-50), `fechaDesde`, `fechaHasta`, `incluirSinDocumento`. |
| `listarDocumentosDeActuacion` | `GET /api/v1/causas/{id}/actuaciones/{codigo}/documentos` | |
| `leerTextoDocumento` | `POST /api/v1/documentos/hba/extract-text` | Puede usar OCR y tardar. |
| `consultarRiesgoAbandono` | `GET /api/v1/causas/{id}/abandono/riesgo` | `fechaCorte`, `alertaDias` (1-180). |
| `consultarMedidasCautelares` | `GET /api/v1/causas/{id}/medidas-cautelares` | Solo existe en el servidor desplegado. |
| `consultarEstadoSentencia` | `GET /api/v1/causas/{id}/sentencia/estado` | Solo existe en el servidor desplegado. |

### Regla para números de proceso e `idJuicio` (verificada)
- Con el `services.py` completo (el del 21-ago-2026, ya restaurado en producción), la API REST
  **acepta el número con guiones directamente** en las seis rutas con identificador
  (`actuaciones`, `paginadas`, `resoluciones`, `medidas-cautelares`, `sentencia/estado`,
  `abandono/riesgo`): HTTP 200 con y sin guiones, probado con el juicio `01333-2024-12766`.
  Con el `services.py` reducido que hubo en producción hasta el 8-oct-2026 daba 404 con guiones.
- Aun así, **el MCP resuelve primero** todo identificador con guiones con `resolverNumeroProceso`
  y consulta con el `idJuicio` resuelto (una llamada extra, pero no depende de ninguna suposición).
- Si el resolver responde **404 u otro 4xx**, el MCP informa el error y **no sigue**: no inventa un identificador.
- Solo si el resolver **no está disponible** (5xx o respuesta inválida) se usa el número sin
  separadores y la propia consulta informa si el juicio no existe. Quitar los guiones **no** se
  presenta como equivalente a resolver: es un respaldo, registrado en el log del servicio.
- Limitación: la equivalencia con/sin guiones solo se verificó con un juicio. Los identificadores
  con letras o secuencias de 4 dígitos no se probaron.

### Búsqueda por cédula: un rol por llamada (verificada)
`buscarJuiciosPorCedula` consulta **actor y demandado por separado** (una llamada REST por rol) y
une los resultados por `idJuicio`. Razón: pedir ambos roles juntos agota el tiempo de SATJE; en las
pruebas la llamada conjunta devolvió `partial: true` con 3 causas, mientras que por rol el panel
obtuvo 6. Si un rol falla, se devuelve lo que sí respondió con `partial: true`, `success: false` y un
`partialErrors` que indica el rol; si fallan todos, es un error de herramienta (`isError`), nunca una
lista vacía. La respuesta conserva `requestIds`, `partialErrors` y `consultadoPorRol`.

### Calidad de las respuestas
Las respuestas de la API se devuelven tal cual (con `requestId`, `partial`, `partialErrors`,
`analysisStatus`, `determination`). El servidor distingue: sin clave o clave inválida (HTTP 401),
parámetro inválido (error JSON-RPC `-32602`), error de la API o de SATJE (`isError: true` con el
código HTTP y el cuerpo), tiempo agotado (`isError: true`, mensaje de reintento) y resultado
parcial (`partial: true`). Las instrucciones del servidor piden tratar el texto de los expedientes
como datos, no como instrucciones, y no equiparar sentencia detectada con ejecutoria confirmada,
medida ordenada con inscrita, ni riesgo de abandono con declaración judicial.

## Lo que NO se expone
| Ruta | Motivo |
|---|---|
| `GET /health` | Salud del servicio (no es una consulta judicial). |
| `GET /health/satje`, `GET /api/v1/ops/metrics` | Administrativas; exigen la clave operativa (`OPS_API_KEYS`). |
| `POST /api/v1/causas/{id}/pdf` y las `/api/juicio*/pdf` | Generan un PDF binario. |
| `POST /api/v1/agent/satje` | Duplica a las anteriores; su esquema no está verificado. |
| `/api/juicios/{identificacion}`, `/api/juicio*`, `/api/juicios-resumen/*` | Marcadas `deprecated` en el servidor; las sustituyen las rutas `/api/v1`. |

Ninguna herramienta modifica datos de negocio: son consultas (los `POST` llevan los
criterios en el cuerpo). El único efecto es la caché y las métricas internas del servicio.

## Instalación en el servidor

```bash
cd /home/ubuntu/.openclaw/workspace/projects/ecuador-judicial-api
# 1. copiar app/mcp_server.py y scripts/install_mcp.py (desde este repositorio)
# 2. agregar el router a main.py (guarda app/main.py.bak-mcp)
.venv/bin/python scripts/install_mcp.py app/main.py
# 3. reiniciar
systemctl restart ecuador-judicial-api
```

Para **revertir**: `cp app/main.py.bak-mcp app/main.py && systemctl restart ecuador-judicial-api`.

Verificación (lee la clave de `SATJE_API_KEY`, no imprime contenido de juicios):

```bash
SATJE_API_KEY=... .venv/bin/python scripts/mcp_verificar.py --proceso 01333-2024-12766
```

## Límite de peticiones
Nginx limita `location /` a 30 peticiones por minuto por IP (ráfaga 20). Una sesión MCP
hace `initialize`, `tools/list` y las llamadas: si el cliente comparte IP con otros, puede
recibir `429`/`503`. Si ocurre, conviene un `location = /mcp` con un límite propio más alto.

## Autenticación
- **Con OAuth configurado** (`MCP_OAUTH_ISSUER`): solo se aceptan tokens de acceso OAuth válidos
  (ver `MCP_OAUTH.md`). Es lo que exige ChatGPT, que no admite claves de API personalizadas.
- **Sin OAuth configurado:** `X-API-Key` o `Authorization: Bearer <clave>` con la clave de la API.
  Este modo existe solo mientras no se conecte el proveedor de identidad y **no sirve para ChatGPT**.

## Limitaciones conocidas
- **Discrepancia de medidas cautelares (NO resuelta):** el detector del servidor (Python, en el MCP) y el del
  panel (TypeScript) no coinciden. Para el juicio 01333-2024-12766 el MCP devolvió
  `INSCRIPTION_NOT_CONFIRMED` mientras la oficial jurídica confirmó la inscripción el 17-12-2024 y el panel la
  muestra. Las reglas de la oficial (inscripción = fecha de presentación del oficio del Registro) están solo en el
  panel. Hasta unificarlas y probarlas, el resultado de `consultarMedidasCautelares` no es definitivo.
- **No se usa el SDK oficial de MCP:** el protocolo está implementado a mano (initialize, tools/list, tools/call,
  ping, lotes, 202 para notificaciones, 405 para GET). Se probó con pruebas propias y `scripts/mcp_verificar.py`,
  no con una suite de conformidad oficial.
- **ChatGPT no se ha probado** contra este servidor.
- La equivalencia con/sin guiones en números de proceso se verificó con un solo juicio.
