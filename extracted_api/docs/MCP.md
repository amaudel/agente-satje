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

### Números con guiones
Si `idJuicio` contiene guiones (ej. `01333-2024-12766`), el MCP lo convierte antes con
`resolverNumeroProceso` y consulta con el identificador resuelto. Un identificador sin guiones
no hace esa llamada extra. Los identificadores se validan (`[A-Za-z0-9._-]`, máximo 64, sin `..`)
para que no puedan alterar la ruta consultada.

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

## Conectar un cliente
- URL: `https://api.asitentekairon.cloud/mcp`
- Autenticación: cabecera `X-API-Key` (o Bearer) con la clave del servidor.
- No se ha verificado qué métodos de autenticación acepta cada cliente (p. ej. ChatGPT);
  si un cliente solo admite OAuth o ninguna autenticación, esta capa necesitaría ajustes.
