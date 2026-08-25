# Ecuador Judicial API

API FastAPI para integrar consultas puntuales con SATJE/Funcion Judicial de Ecuador y entregar respuestas limpias a una aplicacion futura.

Estado actual: produccion publica en `https://api.asitentekairon.cloud` esta operativa en `SATJE_MODE=live` mediante conector SATJE privado en Apify/AWS. El VPS principal sigue sin poder conectar directamente a `api.funcionjudicial.gob.ec` porque TCP/TLS/HTTP hacen timeout; por eso el backend live activo es `apify_actor`, no `direct`.

Staging esta montado como servicio separado en `127.0.0.1:8011` con
`SATJE_MODE=fixture`, API key propia, ops key propia, metricas separadas en
`satje_ops_staging.sqlite3` y Nginx preparado para
`staging-api.asitentekairon.cloud`. Validacion del 2026-07-20: servicio,
proxy local, proxy publico por IP+Host, `/health/satje`, actuaciones paginadas
y resoluciones responden `200`. Para activar HTTPS publico falta que el DNS del
subdominio apunte a `187.77.41.236`; despues de eso se puede emitir el
certificado con Certbot.

## Arquitectura

- `app/main.py`: endpoints HTTP, autenticacion por `X-API-Key`, salud y endpoints v1.
- `app/source.py`: adaptador legacy, normalizadores y compatibilidad con endpoints existentes.
- `app/satje_client.py`: interfaz `SatjeClient`, `SatjeLiveClient`, `SatjeApifyConnectorClient`, `SatjeFixtureClient`, payloads SATJE e incidentes.
- `app/services.py`: flujo de alto nivel cedula -> causas -> incidentes -> actuaciones -> PDF.
- `app/errors.py`: contrato uniforme de errores.
- `app/observability.py`: `requestId`, logs estructurados y mascara de cedulas.
- `app/metrics.py`: metricas operativas en SQLite por etapa, requestId, latencia, errores y conteos.
- `app/pdf_report.py`: generador PDF propio con ReportLab.
- `examples/`: fixtures reales capturados.
- `diagnostics/apify-satje-live-check/`: actor Apify usado como diagnostico externo y conector SATJE privado.
- `scripts/diagnose_satje_connection.py`: diagnostico seguro DNS/TCP/TLS/HTTP.
- `scripts/measure_production_flow.py`: medicion controlada de flujo live completo.
- `scripts/satje_stability_probe.py`: prueba continua controlada, una muestra por ejecucion.
- `scripts/satje_alert_check.py`: alertas locales/webhook para salud, SATJE, Apify, certificado y systemd.
- `scripts/satje_ops_report.py`: resumen de la prueba continua.
- `tests/`: pruebas de contratos legacy y v1.

## Endpoints

Todos los endpoints `/api/*` requieren:

```http
X-API-Key: demo-key-change-me
```

Legacy, preservados:

- `GET /health`
- `GET /health/satje`
- `GET /api/juicios/{identificacion}`
- `GET /api/juicio/{id_juicio}`
- `POST /api/juicio`
- `POST /api/juicio/actuaciones`
- `GET /api/juicio/{id_juicio}/pdf`
- `POST /api/juicio/pdf`
- `GET /api/juicios-resumen/{identificacion}`
- `GET /api/juicios-resumen/{identificacion}/pdf`

Nuevos v1:

- `POST /api/v1/agent/satje`
- `POST /api/v1/causas/buscar`
- `GET /api/v1/causas/{idJuicio}/actuaciones`
- `GET /api/v1/causas/{idJuicio}/actuaciones/paginadas`
- `GET /api/v1/causas/{idJuicio}/resoluciones`
- `GET /api/v1/causas/{idJuicio}/actuaciones/{codigoActuacion}/documentos`
- `POST /api/v1/causas/{idJuicio}/pdf`
- `POST /api/v1/documentos/hba/extract-text`
- `GET /api/v1/ops/metrics`

No hay un endpoint publico separado `GET /api/v1/causas/{idJuicio}` todavia.
Cuando la app ya conoce el numero de proceso, puede llamar directamente
`GET /api/v1/causas/{idJuicio}/actuaciones` o
`POST /api/v1/causas/{idJuicio}/pdf` sin ejecutar antes `/buscar`.

## Variables de entorno

```env
API_KEYS=demo-key-change-me
OPS_API_KEYS=ops-demo-key-change-me
SATJE_MODE=fixture
SATJE_LIVE_BACKEND=direct
SATJE_CONNECTOR_ACTOR_ID=
SATJE_CONNECTOR_API_TOKEN=
SATJE_CONNECTOR_INTERNAL_TOKEN=
SATJE_LAMBDA_FUNCTION_URL=
SATJE_LAMBDA_API_TOKEN=
SATJE_CLOUDFLARE_WORKER_URL=
SATJE_CLOUDFLARE_API_TOKEN=
SATJE_CONNECTOR_TIMEOUT_SECONDS=120
SATJE_CONNECTOR_MAX_CONCURRENCY=2
SATJE_CONNECTOR_RETRY_ATTEMPTS=2
SATJE_CONNECTOR_BACKOFF_SECONDS=1
SATJE_CIRCUIT_FAILURE_THRESHOLD=5
SATJE_CIRCUIT_RESET_SECONDS=300
SOURCE_BASE_URL=https://api.funcionjudicial.gob.ec
SOURCE_DETAIL_PAYLOAD_JSON=
CORS_ALLOWED_ORIGINS=https://asitentekairon.cloud
DOCS_ENABLED=true
SATJE_PAGE_SIZE=10
SATJE_MAX_PAGES=10
CACHE_TTL_SECONDS=300
REQUEST_TIMEOUT_SECONDS=20
METRICS_DB_PATH=satje_ops.sqlite3
PDF_TEXT_MAX_BYTES=26214400
PDF_TEXT_OCR_ENABLED=true
PDF_TEXT_OCR_MAX_PAGES=30
PDF_TEXT_OCR_DPI=200
PDF_TEXT_OCR_LANG=spa+eng
PDF_TEXT_EXTRACTION_TIMEOUT_SECONDS=120
```

`SATJE_MODE` es la unica fuente oficial para controlar fixture/live. `SATJE_MODE=fixture` usa JSON real capturado desde navegador. `SATJE_MODE=live` usa datos actuales de SATJE y nunca cae silenciosamente a fixture.

Con `SATJE_MODE=live`, `SATJE_LIVE_BACKEND` define la ruta tecnica:

- `direct`: el VPS llama directamente a `api.funcionjudicial.gob.ec`.
- `aws_lambda`: la API principal llama una AWS Lambda Function URL, y Lambda llama SATJE.
- `cloudflare_worker`: la API principal llama un Cloudflare Worker, y el Worker llama SATJE.
- `apify_actor`: la API principal llama un conector privado en Apify/AWS, y ese conector llama SATJE.

Produccion actual usa:

```env
SATJE_MODE=live
SATJE_LIVE_BACKEND=apify_actor
SATJE_CONNECTOR_ACTOR_ID=R6sw5hrDS5YiM0dUZ
SATJE_CONNECTOR_API_TOKEN=...
SATJE_CONNECTOR_INTERNAL_TOKEN=...
```

`SATJE_CONNECTOR_API_TOKEN` y `SATJE_CONNECTOR_INTERNAL_TOKEN` son secretos internos y no son la API key publica del producto.

Ruta recomendada para independizarse de Apify:

```env
SATJE_MODE=live
SATJE_LIVE_BACKEND=aws_lambda
SATJE_LAMBDA_FUNCTION_URL=https://xxxx.lambda-url.us-east-1.on.aws/
SATJE_LAMBDA_API_TOKEN=secreto-url-lambda
SATJE_CONNECTOR_INTERNAL_TOKEN=secreto-interno-conector
SATJE_CONNECTOR_TIMEOUT_SECONDS=30
SATJE_CONNECTOR_MAX_CONCURRENCY=2
SATJE_CONNECTOR_RETRY_ATTEMPTS=2
SATJE_CONNECTOR_BACKOFF_SECONDS=1
```

Ruta alternativa si AWS es muy manual:

```env
SATJE_MODE=live
SATJE_LIVE_BACKEND=cloudflare_worker
SATJE_CLOUDFLARE_WORKER_URL=https://satje-cloudflare-worker-connector.<tu-subdominio>.workers.dev/
SATJE_CLOUDFLARE_API_TOKEN=secreto-worker
SATJE_CONNECTOR_INTERNAL_TOKEN=secreto-interno-conector
SATJE_CONNECTOR_TIMEOUT_SECONDS=30
SATJE_CONNECTOR_MAX_CONCURRENCY=2
SATJE_CONNECTOR_RETRY_ATTEMPTS=2
SATJE_CONNECTOR_BACKOFF_SECONDS=1
```

El codigo del conector Cloudflare esta en `connectors/cloudflare-worker-satje/`. Puede desplegarse con Wrangler o pegando `src/index.mjs` en un Worker desde la consola web. Para validar si Cloudflare llega a SATJE, primero desplegar el Worker y despues ejecutar:

```bash
./connectors/cloudflare-worker-satje/smoke-test.sh
```

El codigo del conector Lambda esta en `connectors/aws-lambda-satje/`. Para desplegarlo con AWS CLI:

```bash
AWS_REGION=us-east-1 ./connectors/aws-lambda-satje/deploy.sh
```

El script crea o actualiza la funcion, crea la Function URL, genera secretos locales, prueba Lambda contra SATJE y deja las variables listas en `.satje-lambda-output.env`. Despues de desplegar, copiar esas variables al `.env` de la API principal y reiniciar el servicio.

Para validar solo la Function URL:

```bash
./connectors/aws-lambda-satje/smoke-test.sh
```

En Lambda se configuran los mismos secretos como variables de entorno:

```env
CONNECTOR_TOKEN=secreto-interno-conector
LAMBDA_API_TOKEN=secreto-url-lambda
```

Usar Function URL con `Auth type: NONE` y protegerla con `LAMBDA_API_TOKEN` + `CONNECTOR_TOKEN`. Para el primer despliegue conviene crearla en `us-east-1`, porque Apify habia respondido bien desde AWS Virginia/Ashburn.

Staging actual usa:

```env
SATJE_MODE=fixture
SATJE_LIVE_BACKEND=direct
SATJE_PAGE_SIZE=10
SATJE_MAX_PAGES=10
CACHE_TTL_SECONDS=300
PDF_TEXT_MAX_BYTES=26214400
PDF_TEXT_OCR_MAX_PAGES=30
PDF_TEXT_EXTRACTION_TIMEOUT_SECONDS=120
METRICS_DB_PATH=satje_ops_staging.sqlite3
```

Las claves reales de staging estan solo en `.env.staging`, que no se versiona.

`OPS_API_KEYS` es una credencial separada para endpoints administrativos como
`/api/v1/ops/metrics`. No debe entregarse a apps comerciales ni reutilizarse
como API key de cliente.

## Agente Consultor SATJE

El agente expone una interfaz unica para apps y chatbots sobre los endpoints v1:

```http
POST /api/v1/agent/satje
X-API-Key: <api-key-del-producto>
Content-Type: application/json
```

```json
{
  "query": "consulta la cedula 0104270855",
  "tipoBusqueda": "auto",
  "incluirActuaciones": true,
  "maxActuaciones": 5
}
```

Respuesta por identificacion:

```json
{
  "success": true,
  "agent": "satje_consultor",
  "intent": "buscar_causas",
  "answer": "Encontre 3 procesos SATJE para 0104270855...",
  "cases": [],
  "nextActions": []
}
```

Respuesta por numero de proceso:

```json
{
  "success": true,
  "agent": "satje_consultor",
  "intent": "consultar_causa",
  "answer": "La causa 01371201700497 tiene 159 actuaciones...",
  "case": {
    "idJuicio": "01371201700497",
    "totalIncidentes": 1,
    "totalActuaciones": 159,
    "ultimasActuaciones": []
  },
  "nextActions": []
}
```

`tipoBusqueda=auto` detecta cedula/RUC o numero de proceso. Para produccion con
Cloudflare, el agente no requiere otra configuracion: usa `SatjeService`, y ese
servicio selecciona Cloudflare cuando el entorno tiene:

```env
SATJE_MODE=live
SATJE_LIVE_BACKEND=cloudflare_worker
SATJE_CLOUDFLARE_WORKER_URL=https://satje-cloudflare-worker-connector.<tu-subdominio>.workers.dev/
SATJE_CLOUDFLARE_API_TOKEN=...
SATJE_CONNECTOR_INTERNAL_TOKEN=...
```

La app cliente solo envia `X-API-Key` a esta API. Los secretos del Worker y del
conector quedan exclusivamente en backend/Cloudflare.

El backend `apify_actor` usa `run-sync-get-dataset-items`: cada operacion SATJE (`buscarCausas`, `getIncidenteJudicatura`, `actuacionesJudiciales`) crea un run nuevo del Actor. La API limita concurrencia con `SATJE_CONNECTOR_MAX_CONCURRENCY`, reintenta solo errores retryable con `SATJE_CONNECTOR_RETRY_ATTEMPTS` y abre circuit breaker despues de `SATJE_CIRCUIT_FAILURE_THRESHOLD` fallos consecutivos.

`CORS_ALLOWED_ORIGINS` debe ser una lista explicita separada por comas. `DOCS_ENABLED=false` deshabilita `/docs`, `/redoc` y `/openapi.json` desde FastAPI; en produccion el reverse proxy tambien bloquea esas rutas externamente.

## Contratos SATJE validados

Busqueda de causas:

```text
POST /EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas?page=1&size=10
```

Payload actor:

```json
{
  "numeroCausa": "",
  "actor": {"cedulaActor": "0104270855", "nombreActor": ""},
  "demandado": {"cedulaDemandado": "", "nombreDemandado": ""},
  "provincia": "",
  "numeroFiscalia": "",
  "recaptcha": "verdad",
  "first": 1,
  "pageSize": 10
}
```

Para demandado, se envia la cedula en `demandado.cedulaDemandado`. La respuesta real validada es un arreglo JSON directo con causas. Para `0104270855`, el fixture real contiene:

- `01204202002243`
- `01371201700497`
- `01371201700494`

Incidentes:

```text
GET /EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion/getIncidenteJudicatura/{idJuicio}
```

La respuesta real validada puede ser un arreglo de judicaturas con `lstIncidenteJudicatura`. El normalizador recorre todos los incidentes anidados; no asume `1 proceso = 1 incidente`.

Actuaciones:

```text
POST /EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales
```

Payload validado:

```json
{
  "idMovimientoJuicioIncidente": 19384296,
  "idJuicio": "01371201700497",
  "idJudicatura": "01371",
  "idIncidenteJudicatura": 20181767,
  "aplicativo": "web",
  "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
  "incidente": 1
}
```

SATJE devuelve JSON de actuaciones, no un PDF consolidado. Por eso la API genera su propio PDF con ReportLab.

Documentos adjuntos HBA:

```text
GET /CJ-DOCUMENTO-SERVICE/api/document/query/hba?code={uuid}
```

El conector live soporta la operacion `documentHba`. La API descarga el PDF devuelto por SATJE, valida que sea PDF y extrae texto con `pypdf`. Si el PDF es escaneado y no tiene capa de texto, usa OCR local con `pdftoppm` + `tesseract` cuando `PDF_TEXT_OCR_ENABLED=true`; no inventa contenido si tampoco se puede leer por OCR.

Contrato publico para documentos HBA:

1. La app consulta actuaciones por proceso.
2. La app toma el `codigo` de la actuacion candidata.
3. La app lista documentos de esa actuacion:

```http
GET /api/v1/causas/{idJuicio}/actuaciones/{codigoActuacion}/documentos
```

Respuesta ejemplo:

```json
{
  "success": true,
  "source": "SATJE",
  "mode": "live",
  "retrievedAt": "2026-07-14T15:30:00+00:00",
  "idJuicio": "01333202401279",
  "codigoActuacion": "123456789",
  "total": 1,
  "data": [
    {
      "documentoId": "doc_aGJhLWNvZGUtMQ",
      "nombre": "HBA01",
      "nombreArchivo": "ESCRITO.pdf",
      "tipo": "application/pdf",
      "disponible": true,
      "codigoActuacion": 123456789,
      "fechaActuacion": "2025-10-29T10:28:48.000+00:00"
    }
  ],
  "requestId": "req_xxx",
  "cache": {"hit": false, "ttlSeconds": 300}
}
```

`documentoId` es el identificador publico que debe guardar la app. La app no
debe depender del `uuid`/`code` interno de SATJE ni asumir que su formato sera
estable. El campo `code` sigue aceptado en `extract-text` solo por compatibilidad
operativa interna.

Duracion de `documentoId`: el identificador es reconstruible a partir de la
ultima consulta de actuaciones porque encapsula la referencia HBA que SATJE
entrega para esa actuacion. La app puede guardarlo como referencia auditiva de
una consulta, pero no debe tratarlo como permanente ni intentar usarlo meses
despues sin refrescar primero actuaciones/documentos. Contrato operativo
recomendado: reutilizarlo dentro de la vigencia de cache de documentos
(`CACHE_TTL_SECONDS=300`) y, para consultas posteriores, reconstruir el flujo:
actuaciones -> documentos -> extract-text.

### Busqueda documental de inscripcion de medidas cautelares

Cuando un usuario pida la fecha de inscripcion en el Registro de la Propiedad de
una medida cautelar, embargo, prohibicion de enajenar u otro gravamen, la API
debe tratarlo como una busqueda documental sobre actuaciones y adjuntos HBA. No
debe responder con la fecha de la providencia ni con la fecha del oficio si no
existe constancia de inscripcion.

Flujo esperado:

1. Buscar la causa por cedula/RUC o numero de proceso.
2. Obtener incidentes y actuaciones del proceso.
3. Filtrar actuaciones con adjunto (`ieDocumentoAdjunto = "S"`) y senales como
   `HBA`, `Registro de la Propiedad`, `Razon de Inscripcion`, `embargo`,
   `medida cautelar`, `prohibicion de enajenar`, `oficio` o `certificado`.
4. Listar documentos HBA de cada actuacion candidata con
   `GET /api/v1/causas/{idJuicio}/actuaciones/{codigoActuacion}/documentos`.
5. Descargar/leer los PDFs candidatos con
   `POST /api/v1/documentos/hba/extract-text` usando `documentoId`.
6. Extraer texto del PDF con `pypdf` y, si hace falta, OCR.
7. Rankear cada PDF por contenido. Senales fuertes:
   - `Registro de la Propiedad`
   - `Razon de Inscripcion`
   - `Numero de Repertorio`
   - `Registro de Embargos`
   - acto inscrito como `EMBARGO` o `PROHIBICION DE ENAJENAR`
   - fecha explicita de inscripcion
8. Elegir el PDF con mayor puntaje solo si el contenido confirma la inscripcion.

Niveles de respuesta:

- `confirmado`: el PDF/actuacion contiene la razon de inscripcion y la fecha
  efectiva de inscripcion.
- `parcial`: solo aparece la providencia judicial o el oficio al Registro, pero
  no consta la inscripcion efectiva.
- `no_encontrado`: no aparece constancia de inscripcion en las actuaciones o
  adjuntos HBA revisados.

Formato de respuesta recomendado:

```json
{
  "estado": "confirmado",
  "resultado": {
    "acto": "EMBARGO",
    "fechaInscripcion": "2026-01-15",
    "razonInscripcion": "900001",
    "numeroRepertorio": "20001",
    "fechaRepertorio": "2026-01-12"
  },
  "evidencia": {
    "documentoId": "doc_aGJhLWNvZGUtMQ",
    "nombreArchivo": "Registro_Propiedad.pdf",
    "pagina": 2,
    "textoSoporte": "El acto de EMBARGO queda inscrito el 15 de enero de 2026.",
    "metodoExtraccion": "ocr",
    "calidadExtraccion": "alta"
  },
  "source": "SATJE",
  "mode": "live",
  "retrievedAt": "2026-07-14T15:30:00+00:00",
  "requestId": "req_xxx"
}
```

La conclusion siempre debe ir acompanada de evidencia verificable. Si el parser
infiere una fecha pero no puede citar documento, pagina y texto soporte, la app
debe responder `parcial` o `no_encontrado`, no `confirmado`.

Formato de respuesta en lenguaje natural:

```text
Segun el documento {documento} adjunto al proceso {idJuicio}, {acto} consta
inscrito con fecha {fechaInscripcion}. Razon de inscripcion: {razon}.
Numero de repertorio: {repertorio}, con fecha de repertorio {fechaRepertorio}.
Fuente: actuacion {fechaActuacion}, archivo {nombreArchivo}.
```

Ejemplo anonimizado para integracion:

```text
Proceso: 00000-0000-00000
Documento: Registro de la Propiedad del Canton Cuenca
Razon de Inscripcion: 900001
Numero de Repertorio: 20001
Fecha de Repertorio: 12 de enero de 2026
Acto inscrito: EMBARGO
No. Registro de Embargos: 101
Fecha efectiva de inscripcion: 15 de enero de 2026
```

Todos los valores son ficticios y sirven exclusivamente para pruebas.

Para este tipo de consulta, la fecha comercialmente importante es la fecha
efectiva de inscripcion, no la fecha de la providencia ni la fecha de
repertorio.

## Ejemplos

Buscar causas por cedula:

```bash
curl -X POST http://127.0.0.1:8010/api/v1/causas/buscar \
  -H 'X-API-Key: demo-key-change-me' \
  -H 'Content-Type: application/json' \
  --data '{"cedula":"0104270855","roles":["actor","demandado"],"incluirTodasLasPaginas":true}'
```

Consultar actuaciones por proceso:

```bash
curl http://127.0.0.1:8010/api/v1/causas/01371201700497/actuaciones \
  -H 'X-API-Key: demo-key-change-me'
```

Este endpoint puede llamarse directamente si el usuario ingresa un numero de
proceso. No requiere una busqueda previa por cedula/RUC.

Respuesta ejemplo resumida:

```json
{
  "success": true,
  "source": "SATJE",
  "mode": "live",
  "retrievedAt": "2026-07-14T15:30:00+00:00",
  "idJuicio": "01371201700497",
  "totalIncidentes": 1,
  "totalActuaciones": 159,
  "incidentes": [
    {
      "idIncidenteJudicatura": 20181767,
      "idMovimientoJuicioIncidente": 19384296,
      "incidente": 1,
      "idJudicatura": "01371",
      "nombreJudicatura": "UNIDAD JUDICIAL DE TRABAJO CUENCA",
      "totalActuaciones": 159,
      "actuaciones": [
        {
          "codigo": 159075756,
          "fecha": "2020-06-11T21:16:10.000+00:00",
          "tipo": "ENVIO DEL PROCESO AL ARCHIVO GENERAL (RAZON)",
          "actividad": "RAZON: SE ENVIA EL PROCESO AL ARCHIVO.-CERTIFICO.-CUENCA, 11 DE JUNIO DEL 2020.",
          "ieDocumentoAdjunto": "S",
          "nombreArchivo": "01371201700497_125504102_16_16_14_P20.pdf"
        }
      ]
    }
  ],
  "partialErrors": [],
  "requestId": "req_xxx",
  "cache": {"hit": false, "ttlSeconds": 300}
}
```

Listar documentos de una actuacion:

```bash
curl http://127.0.0.1:8010/api/v1/causas/01371201700497/actuaciones/159075756/documentos \
  -H 'X-API-Key: demo-key-change-me'
```

Generar PDF por proceso:

```bash
curl -X POST http://127.0.0.1:8010/api/v1/causas/01371201700497/pdf \
  -H 'X-API-Key: demo-key-change-me' \
  -o expel_01371201700497.pdf
```

Extraer texto de un PDF HBA:

```bash
curl -X POST http://127.0.0.1:8010/api/v1/documentos/hba/extract-text \
  -H 'X-API-Key: demo-key-change-me' \
  -H 'Content-Type: application/json' \
  --data '{"documentoId":"doc_aGJhLWNvZGUtMQ"}'
```

Respuesta ejemplo resumida:

```json
{
  "success": true,
  "source": "SATJE",
  "mode": "live",
  "retrievedAt": "2026-07-14T15:30:00+00:00",
  "documentoId": "doc_aGJhLWNvZGUtMQ",
  "contentType": "application/pdf",
  "contentLength": 937533,
  "pages": 4,
  "extractionMethod": "ocr",
  "text": "REGISTRO DE LA PROPIEDAD DEL CANTON CUENCA...",
  "pageTexts": [
    {"page": 1, "text": "REGISTRO DE LA PROPIEDAD..."}
  ],
  "requestId": "req_xxx",
  "cache": {"hit": false, "ttlSeconds": 300}
}
```

Endpoint tecnico existente con payload SATJE:

```bash
curl -X POST http://127.0.0.1:8010/api/juicio/actuaciones \
  -H 'X-API-Key: demo-key-change-me' \
  -H 'Content-Type: application/json' \
  --data @examples/actuaciones-request.payload.json
```

## Error uniforme

Los endpoints v1 devuelven errores con este formato:

```json
{
  "success": false,
  "error": {
    "code": "SATJE_TIMEOUT",
    "message": "SATJE no respondio dentro del tiempo permitido.",
    "stage": "actuacionesJudiciales",
    "retryable": true
  },
  "requestId": "req_xxx"
}
```

Codigos soportados:

- `VALIDATION_ERROR`
- `SATJE_TIMEOUT`
- `SATJE_DNS_ERROR`
- `SATJE_CONNECTION_ERROR`
- `SATJE_TLS_ERROR`
- `SATJE_BLOCKED`
- `SATJE_CAPTCHA_REQUIRED`
- `SATJE_INVALID_RESPONSE`
- `CAUSE_NOT_FOUND`
- `INCIDENT_NOT_FOUND`
- `ACTUATIONS_NOT_FOUND`
- `DOCUMENT_NOT_FOUND`
- `PDF_GENERATION_ERROR`
- `PDF_TEXT_EXTRACTION_ERROR`
- `INTERNAL_ERROR`

Codigos HTTP esperados:

- `200`: consulta exitosa, aunque `total=0` en listados.
- `400`: solicitud mal formada antes de validacion de esquema.
- `401`: API key ausente o invalida.
- `404`: causa, incidente, actuacion o documento no encontrado.
- `422`: payload valido como JSON pero incompatible con el contrato, PDF ilegible
  o PDF protegido/no procesable.
- `429`: limite de solicitudes excedido por IP, API key o reverse proxy.
- `502`: SATJE/Apify respondio con estructura, tipo de contenido o PDF invalido.
- `504`: timeout de SATJE, Apify o etapa live.

Todas las respuestas JSON v1 deben incluir `retrievedAt`, `source`, `mode`,
`requestId` y, cuando aplique, `cache`. En respuestas binarias como PDF, esos
datos se exponen al menos como headers (`X-Request-Id`) y/o quedan en metricas.

## Reglas operativas para apps cliente

Paginacion:

- Busqueda de causas usa `SATJE_PAGE_SIZE` y `SATJE_MAX_PAGES`.
- `incluirTodasLasPaginas=true` recorre paginas hasta que SATJE devuelva menos
  de `SATJE_PAGE_SIZE` o se alcance `SATJE_MAX_PAGES`.
- Actuaciones se devuelven agrupadas por incidente; si se requiere paginacion de
  UI, la app debe paginar localmente sobre `incidentes[].actuaciones`.

Cache y antiguedad:

- `CACHE_TTL_SECONDS=300`: vigencia operativa inicial de cache de actuaciones,
  busquedas y documentos HBA, equivalente a 5 minutos.
- La app debe mostrar o guardar `retrievedAt` para saber cuando se obtuvo el
  dato.
- Para decisiones sensibles, ofrecer accion de refrescar consulta en lugar de
  reutilizar una respuesta antigua.

Limites:

- La API no esta disenada para consultas masivas.
- Rate limit inicial: 30 solicitudes/minuto por IP en Nginx. Si se agrega
  gateway comercial, debe mantenerse como minimo 30 solicitudes/minuto por API
  key para el plan base.
- PDF maximo para extraccion HBA: `PDF_TEXT_MAX_BYTES=26214400` (25 MB).
- OCR maximo: `PDF_TEXT_OCR_MAX_PAGES=30`, `PDF_TEXT_OCR_DPI=200`.
- Timeout operativo de extraccion documental: 120 segundos por solicitud.
- Paginacion SATJE: `SATJE_PAGE_SIZE=10` y `SATJE_MAX_PAGES=10`.
- Si un PDF es muy grande, ilegible, protegido o no es `application/pdf`, la API
  debe responder `PDF_TEXT_EXTRACTION_ERROR` o `SATJE_INVALID_RESPONSE`; nunca
  debe inventar texto.

SATJE y Apify:

- Si Apify esta disponible pero SATJE no responde, el error debe propagarse como
  `SATJE_TIMEOUT`, `SATJE_BLOCKED`, `SATJE_CAPTCHA_REQUIRED` o
  `SATJE_INVALID_RESPONSE`, segun corresponda.
- No hay fallback silencioso a fixture en produccion.
- `mode=live` significa dato consultado contra SATJE mediante el backend activo;
  `mode=fixture` significa dato de prueba local.

Extraccion PDF:

- `extractionMethod=embedded_text` indica texto nativo del PDF con `pypdf`.
- `extractionMethod=ocr` indica OCR local con `pdftoppm` + `tesseract`.
- Si ambos fallan, la respuesta debe ser error o texto vacio con estado
  funcional `parcial/no_encontrado`, segun el flujo que lo consuma.

Privacidad y conservacion:

- No exponer API keys en frontend web o app movil. La app cliente debe usar su
  propio backend.
- No guardar cedulas/RUC, actuaciones completas ni PDFs HBA mas tiempo del
  necesario para soporte, auditoria o producto.
- Si se guardan consultas, cifrar secretos, restringir acceso interno y conservar
  `requestId`, `retrievedAt`, `source`, `mode` y hash/referencia del documento
  en lugar de duplicar contenido sensible cuando sea posible.

Entornos:

- Produccion publica: `https://api.asitentekairon.cloud`.
- Staging privado propuesto: `https://staging-api.asitentekairon.cloud`.
- Staging debe usar API keys distintas, `OPS_API_KEYS` distintas, limites
  propios y normalmente `SATJE_MODE=fixture` para pruebas repetibles. Si se
  activa `SATJE_MODE=live` en staging, la respuesta debe indicar `mode=live` y
  no puede mezclarse con fixtures silenciosamente.

Creditos comerciales:

- No mezclar creditos comerciales con `API_KEYS`.
- `API_KEYS` autentica a la aplicacion cliente.
- Creditos, planes, saldos y facturacion deben vivir en el backend comercial o
  modulo de billing, asociados a una cuenta/cliente y auditados por consulta.
- La app comercial debe modelar, como minimo: usuarios, organizaciones/clientes,
  planes, saldo, transacciones, costo por operacion e historial de consumo.
- El consumo debe registrarse como ledger auditable. No basta con restar un
  numero del saldo; cada operacion debe conservar fecha, usuario, operacion,
  `requestId`, costo, saldo anterior, saldo restante y estado.
- Los creditos deben cobrarse por operacion de producto, no por endpoint tecnico.
  Ejemplo: `BUSQUEDA_CAUSAS`, `CONSULTA_ACTUACIONES`, `PDF_CONSOLIDADO`,
  `EXTRACCION_TEXTO_HBA`, `ANALISIS_DOCUMENTAL_HBA`.
- Si una operacion falla por error retryable de SATJE/Apify antes de producir
  resultado util, el backend comercial debe definir si revierte el consumo o lo
  marca como no facturable. Esa regla pertenece al modulo comercial, no a la API
  tecnica SATJE.

Ejemplo de registro de consumo:

```json
{
  "usuarioId": "usr_123",
  "clienteId": "cli_456",
  "operacion": "ANALISIS_DOCUMENTAL_HBA",
  "requestId": "req_xxx",
  "creditosConsumidos": 3,
  "saldoAnterior": 50,
  "saldoRestante": 47,
  "estado": "completado",
  "createdAt": "2026-07-14T15:30:00+00:00"
}
```

## Estado del contrato para desarrolladores

La guia queda apta como contrato funcional de integracion cuando incluya, como
minimo:

- Endpoint para listar documentos HBA y obtener `documentoId` sin exponer el
  `code` interno de SATJE.
- Consulta directa por numero de proceso mediante
  `GET /api/v1/causas/{idJuicio}/actuaciones` y
  `POST /api/v1/causas/{idJuicio}/pdf`.
- Evidencia documental verificable para resultados `confirmado`, incluyendo
  `documentoId`, pagina, texto soporte, metodo y calidad de extraccion.
- Ejemplos completos de request/response de los endpoints principales.
- Codigos HTTP, limites, paginacion, latencia, cache, `retrievedAt`, `source`,
  `mode` y `requestId`.
- Separacion clara entre autenticacion tecnica (`API_KEYS`) y creditos
  comerciales.

Sin el endpoint de documentos HBA, el desarrollador sabria extraer texto solo
cuando ya tiene un codigo, pero no tendria documentado como localizar ese
documento dentro del flujo normal de la app.

## Ejecucion local

```bash
cd projects/ecuador-judicial-api
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

Pruebas:

```bash
cd projects/ecuador-judicial-api
. .venv/bin/activate
SATJE_MODE=fixture pytest -q
```

## Despliegue VPS

```bash
cd /ruta/ecuador-judicial-api
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Editar `.env`:

```env
API_KEYS=clave-produccion-1,clave-produccion-2
SATJE_MODE=live
SATJE_LIVE_BACKEND=cloudflare_worker
SATJE_CLOUDFLARE_WORKER_URL=https://satje-cloudflare-worker-connector.<tu-subdominio>.workers.dev/
SATJE_CLOUDFLARE_API_TOKEN=secreto-worker
SATJE_CONNECTOR_INTERNAL_TOKEN=secreto-interno-conector
SOURCE_BASE_URL=https://api.funcionjudicial.gob.ec
CORS_ALLOWED_ORIGINS=https://asitentekairon.cloud
DOCS_ENABLED=true
REQUEST_TIMEOUT_SECONDS=20
SATJE_CONNECTOR_MAX_CONCURRENCY=2
SATJE_CONNECTOR_RETRY_ATTEMPTS=2
SATJE_CONNECTOR_BACKOFF_SECONDS=1
SATJE_CIRCUIT_FAILURE_THRESHOLD=5
SATJE_CIRCUIT_RESET_SECONDS=300
```

Arranque directo:

```bash
. .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

Arranque permanente con systemd:

```bash
sudo install -m 0644 deploy/ecuador-judicial-api.service /etc/systemd/system/ecuador-judicial-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now ecuador-judicial-api.service
systemctl status ecuador-judicial-api.service
```

El unit incluido en `deploy/ecuador-judicial-api.service` arranca Uvicorn en `127.0.0.1:8010` y lee las variables desde `.env`.

Swagger/OpenAPI:

```text
http://127.0.0.1:8010/docs
http://127.0.0.1:8010/openapi.json
```

Paquete privado de integracion para desarrolladores:

```text
docs/GUIA_INTEGRACION_APP.md
docs/openapi.json
docs/Ecuador_Judicial_API.postman_collection.json
docs/entorno-staging.template.postman_environment.json
docs/ejemplos-respuestas/
examples/buscar-causas.json
examples/actuaciones.json
examples/documentos-hba.json
examples/extract-text.json
examples/detector-confirmado.json
examples/detector-parcial.json
docs/errores.md
docs/limites-y-costos.md
docs/privacidad.md
```

En produccion publica `/docs`, `/redoc` y `/openapi.json` estan bloqueados por
Nginx. El contrato OpenAPI debe entregarse de forma privada desde `docs/`.

Variables que debe usar el backend comercial, nunca el frontend publico:

```env
ECUADOR_JUDICIAL_API_URL=https://api.asitentekairon.cloud
ECUADOR_JUDICIAL_API_KEY=clave-comercial-privada
```

Staging debe usar valores separados:

```env
ECUADOR_JUDICIAL_API_URL=https://staging-api.asitentekairon.cloud
ECUADOR_JUDICIAL_API_KEY=clave-staging-privada
```

Modo fixture para desarrollo/pruebas:

```env
SATJE_MODE=fixture
```

No usar fallback silencioso de live a fixture. Si SATJE o el conector fallan, la API debe responder un error explicito.

### Exposicion publica segura con Nginx

Dominio preparado:

```text
api.asitentekairon.cloud
```

DNS requerido:

```text
Tipo A     Host api     Valor 187.77.41.236
Tipo AAAA  Host api     Valor 2a02:4780:6e:ddb2::1  # opcional, solo si IPv6 esta operativo
```

Instalar el reverse proxy incluido:

```bash
sudo install -m 0644 deploy/nginx-ecuador-judicial-api.conf /etc/nginx/sites-available/ecuador-judicial-api
sudo ln -sfn /etc/nginx/sites-available/ecuador-judicial-api /etc/nginx/sites-enabled/ecuador-judicial-api
sudo nginx -t
sudo systemctl reload nginx
```

El proxy:

- escucha en 80/443 cuando Certbot agregue TLS;
- reenvia solo a `127.0.0.1:8010`;
- no requiere abrir el puerto `8010`;
- aplica rate limit basico por IP;
- bloquea `/docs`, `/redoc` y `/openapi.json` desde internet;
- mantiene `/health` publico y minimo.

Cuando el DNS ya resuelva hacia el VPS, emitir HTTPS automatico:

```bash
sudo certbot --nginx -d api.asitentekairon.cloud
```

Verificacion publica esperada:

```bash
curl -i https://api.asitentekairon.cloud/health
curl -i https://api.asitentekairon.cloud/api/v1/causas/01371201700497/actuaciones
curl -i https://api.asitentekairon.cloud/api/v1/causas/01371201700497/actuaciones -H 'X-API-Key: <API_KEY>'
```

La API key de produccion debe vivir solo en `.env`; no se documenta ni se expone en comandos compartidos.

### Staging operativo

Staging usa el mismo codigo, pero servicio, puerto, claves y metricas separadas:

```text
Servicio: ecuador-judicial-api-staging.service
Puerto interno: 127.0.0.1:8011
Env file: .env.staging
Dominio: staging-api.asitentekairon.cloud
Modo: SATJE_MODE=fixture
```

Estado validado el 2026-07-20:

```text
Servicio directo 127.0.0.1:8011: OK
Nginx local con Host staging-api.asitentekairon.cloud: OK
HTTP publico por IP con Host staging-api.asitentekairon.cloud: OK
/health/satje con OPS_API_KEY de staging: OK
Actuaciones paginadas y resoluciones con API_KEY de staging: OK
DNS publico staging-api.asitentekairon.cloud: pendiente
HTTPS publico staging-api.asitentekairon.cloud: pendiente
```

DNS requerido antes de emitir TLS:

```text
Tipo A     Host staging-api     Valor 187.77.41.236
```

Instalacion local:

```bash
sudo install -m 0644 deploy/ecuador-judicial-api-staging.service /etc/systemd/system/ecuador-judicial-api-staging.service
sudo systemctl daemon-reload
sudo systemctl enable --now ecuador-judicial-api-staging.service
sudo install -m 0644 deploy/nginx-ecuador-judicial-api-staging.conf /etc/nginx/sites-available/ecuador-judicial-api-staging
sudo ln -sfn /etc/nginx/sites-available/ecuador-judicial-api-staging /etc/nginx/sites-enabled/ecuador-judicial-api-staging
sudo nginx -t
sudo systemctl reload nginx
```

Cuando el DNS ya resuelva hacia el VPS:

```bash
sudo certbot --nginx -d staging-api.asitentekairon.cloud
```

Verificacion local mientras DNS/TLS no existan:

```bash
curl -H 'Host: staging-api.asitentekairon.cloud' http://127.0.0.1/health
curl -H 'Host: staging-api.asitentekairon.cloud' http://127.0.0.1/docs
```

Validacion operativa completa sin exponer claves:

```bash
cd projects/ecuador-judicial-api
.venv/bin/python scripts/validate_staging.py
```

## Operacion de produccion

Medicion puntual:

```bash
cd projects/ecuador-judicial-api
. .venv/bin/activate
python scripts/measure_production_flow.py
```

Resumen de metricas internas:

```bash
curl -H 'X-API-Key: <OPS_API_KEY>' \
  'https://api.asitentekairon.cloud/api/v1/ops/metrics?since_seconds=86400'
```

`GET /api/v1/ops/metrics` requiere una clave incluida en `OPS_API_KEYS`.
No acepta API keys comerciales normales porque expone latencias, conteos,
errores operativos y senales internas de capacidad/costo.

Prueba continua controlada:

```bash
sudo install -m 0644 deploy/satje-stability-probe.service /etc/systemd/system/satje-stability-probe.service
sudo install -m 0644 deploy/satje-stability-probe.timer /etc/systemd/system/satje-stability-probe.timer
sudo systemctl daemon-reload
sudo systemctl enable --now satje-stability-probe.timer
python scripts/satje_ops_report.py
```

El timer corre una muestra por hora. Cada muestra valida `/health`, `/health/satje`, busqueda por cedula, actuaciones y PDF; escribe JSONL en `artifacts/satje-stability.jsonl`.

Alertas:

```bash
sudo install -m 0644 deploy/satje-alert-check.service /etc/systemd/system/satje-alert-check.service
sudo install -m 0644 deploy/satje-alert-check.timer /etc/systemd/system/satje-alert-check.timer
sudo systemctl daemon-reload
sudo systemctl enable --now satje-alert-check.timer
```

El alert check cubre:

- conector SATJE/Apify degradado;
- timeouts o errores SATJE expuestos por `/health/satje`;
- incremento de fallos por etapa en metricas;
- consumo Apify de la ultima hora (`ALERT_APIFY_HOURLY_USD`, default `1`);
- certificado cerca de vencer;
- servicio `ecuador-judicial-api` detenido.

Si se define `ALERT_WEBHOOK_URL`, las alertas se envian por POST JSON. Sin webhook, quedan en `journalctl`.

Rollback operativo:

```bash
sudo systemctl stop satje-stability-probe.timer satje-alert-check.timer
sudo systemctl restart ecuador-judicial-api
```

No usar rollback a fixture en produccion salvo decision explicita. Si live falla, debe devolver error explicito, no datos fixture.

## Diagnostico de conectividad

```bash
cd projects/ecuador-judicial-api
. .venv/bin/activate
python scripts/diagnose_satje_connection.py --timeout 10
```

Resultado observado desde este VPS el 2026-07-13:

- DNS: resuelve `api.funcionjudicial.gob.ec` a `186.46.113.131`.
- TCP 443: timeout.
- TLS: timeout.
- POST controlado a `buscarCausas`: `ConnectTimeout`.

Clasificacion: `SATJE_TIMEOUT`. Esto sugiere timeout antes de completar conexion desde el VPS. No se usan proxies ni mecanismos de evasion.

## Flujo completo probado en fixture

1. Cedula: `0104270855`.
2. `POST /api/v1/causas/buscar`.
3. Causas devueltas: `01204202002243`, `01371201700497`, `01371201700494`.
4. Proceso seleccionado: `01371201700497`.
5. `GET /api/v1/causas/01371201700497/actuaciones`.
6. Incidente: `idIncidenteJudicatura=20181767`, `idMovimientoJuicioIncidente=19384296`.
7. Actuaciones: 159, normalizadas sin HTML crudo.
8. `POST /api/v1/causas/01371201700497/pdf`.
9. PDF generado por la API: `expel_01371201700497_{fecha}.pdf`.

## Limitaciones

- `recaptcha: "verdad"` esta documentado como parte del contrato capturado, no como garantia permanente.
- Si SATJE cambia estructura, la API debe clasificarlo como `SATJE_INVALID_RESPONSE` o fallar con tests.
- No se hacen consultas masivas.
- Los fixtures reales no deben eliminarse ni reemplazarse por datos inventados.
- El contrato live de incidentes fue validado contra `getIncidenteJudicatura`; mantener fixtures reales actualizados si SATJE cambia la estructura.
