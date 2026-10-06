# Arquitectura del Agente SATJE

Documento verificado contra el código del repositorio en el commit `4f9530b` (rama `main`, octubre 2026). Si el código cambia, este documento puede quedar desactualizado: ante una duda, manda el código.

## 1. Vista general

```text
Usuario (navegador)
   │
   ▼
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│ Vercel — api/index.ts        │        │ Cloudflare Worker — src/index.ts │
│ Dashboard + chat IA + lotes  │        │ API JSON ligera (sin dashboard)  │
└──────────────┬───────────────┘        └───────────────┬─────────────────┘
               │  ambos comparten lib/legal-analysis.ts y lib/auth.ts
               ▼
┌──────────────────────────────────────────────┐
│ Backend Python (FastAPI) — extracted_api/    │  VPS propio, api.asitentekairon.cloud
│ Única fuente de datos de SATJE para las apps │
└──────────────┬───────────────────────────────┘
               │ conector (el VPS no llega directo a SATJE)
               ▼
   Cloudflare Worker / AWS Lambda  ──►  SATJE (api.funcionjudicial.gob.ec)
```

Las dos apps (Vercel y Worker) **no hablan con SATJE directamente**: consultan al backend Python con una API key (`X-API-Key`). El backend, a su vez, llega a SATJE a través de un conector remoto porque el VPS no tiene salida directa a ese dominio.

## 2. Componentes

### 2.1 App Vercel — `api/index.ts` + `lib/`

Una sola función serverless (`maxDuration: 60` s, ver `vercel.json`) con un enrutador por parámetro `action`:

| Acción | Qué hace |
|---|---|
| `login` | Valida la contraseña y emite la cookie de sesión. |
| `chat` | Chat legal con OpenAI (`gpt-4o-mini`) y *function calling* (ver 2.3). |
| `buscar-reinicio` | Para una causa abandonada, busca por cédula posibles procesos de reinicio (mismo asunto, ingreso posterior al abandono). |
| `lote-supervisor` | Lote por cédula: determina el último juicio vigente por persona. |
| `buscar-cedula` | Lista los procesos de una cédula. |
| `resumen-ia` | Resumen ejecutivo con IA, pedido aparte para no bloquear el dibujado. |
| (sin `action`) | Consulta individual (`?causa=`) o lote por números de causa (`?causas=`), renderiza el dashboard HTML. |

Todo lo anterior, excepto `login`, exige sesión válida (puerta de autenticación en el servidor).

Módulos en `lib/`:

| Módulo | Responsabilidad |
|---|---|
| `legal-analysis.ts` | Lógica jurídica pura: etapa procesal, detección de sentencia, ciclo de vida de medida cautelar, alerta de abandono (COGEP 245–247), extracción de asunto, candidatos de reinicio, selección del juicio vigente. Es el único módulo con reglas legales. |
| `procesar-causa.ts` | Orquesta la consulta de una causa al backend y aplica `legal-analysis`. |
| `chat-tools.ts` | Herramientas del chat: `obtener_resoluciones`, `leer_documento_actuacion`, `buscar_otra_causa`. |
| `dashboard-html.ts` | Genera el HTML del dashboard (3 pestañas: individual, lote, lote supervisor). |
| `auth.ts` | Sesión por cookie firmada (HMAC-SHA256) y comparación en tiempo constante. |
| `rate-limit.ts` | Límite de intentos fallidos de login, en memoria. |
| `concurrencia.ts` | `mapConcurrente`: ejecuta tareas con tope de paralelismo. |
| `upstash.ts` | Cliente de Upstash Vector (RAG de precedentes). |

### 2.2 Worker de Cloudflare — `src/index.ts`

Versión ligera que expone **solo API JSON** (no sirve el dashboard): login, consulta de causa, resoluciones, documentos y un resumen con OpenAI. Reutiliza `lib/legal-analysis.ts`, `lib/auth.ts` y `lib/rate-limit.ts`, por lo que el análisis jurídico es el mismo que en Vercel. **No** incluye lote supervisor, búsqueda por cédula, reinicio tras abandono ni Upstash. Se publica en `workers.dev`; el custom domain está comentado en `wrangler.jsonc` porque el DNS del dominio no está en esa cuenta de Cloudflare.

### 2.3 Chat legal

El contexto del expediente se vuelve a consultar en cada mensaje (hasta las 30 actuaciones más recientes). El modelo puede llamar a tres herramientas en hasta 4 turnos:

- `obtener_resoluciones` — resoluciones y sentencias de la causa.
- `leer_documento_actuacion` — lee **todos** los documentos de una actuación (no solo el primero) y extrae su texto, hasta 4000 caracteres por documento.
- `buscar_otra_causa` — consulta otro expediente durante la conversación.

### 2.4 Backend Python — `extracted_api/`

FastAPI. Endpoints principales (ver `app/main.py`):

- `POST /api/v1/causas/buscar` — causas por cédula (roles actor/demandado).
- `GET /api/v1/causas/{id}/actuaciones` y `/actuaciones/paginadas`.
- `GET /api/v1/causas/{id}/resoluciones`.
- `GET /api/v1/causas/{id}/actuaciones/{codigo}/documentos` — documentos de una actuación, **incluyendo anexos** (endpoint real de SATJE `.../datos/anexos`).
- `POST /api/v1/documentos/hba/extract-text` — texto de un PDF (texto embebido; OCR como respaldo).
- `GET /api/v1/causas/{id}/abandono/riesgo`, `POST /api/v1/causas/{id}/pdf`, `GET /health`, `GET /api/v1/ops/metrics`.

Componentes: `satje_client.py` (clientes SATJE directo / conectores con reintentos y *circuit breaker*), `services.py` (lógica de negocio), `source.py` (normalización), `cache.py`, `pdf_text.py`, `observability.py`. Se despliega como servicio `systemd` con `nginx` (ver `extracted_api/deploy/`). En producción usa el conector de Cloudflare Worker (`SATJE_LIVE_BACKEND=cloudflare_worker`).

### 2.5 Conectores — `extracted_api/connectors/`

`cloudflare-worker-satje` (el activo) y `aws-lambda-satje` (alternativo). Aceptan operaciones (`buscarCausas`, `getIncidenteJudicatura`, `actuacionesJudiciales`, `documentHba`, `documentosAnexos`) y las reenvían a SATJE.

## 3. Seguridad

- **Sesión:** cookie `satje_session` con formato `<expiración>.<hmac>`, `HttpOnly; Secure; SameSite=Lax`, vigencia de 7 días. La clave HMAC es `SATJE_SESSION_SECRET` si existe; si no, la propia contraseña (cambiarla invalida las sesiones).
- **Límite de login:** 10 fallos por IP y 150 globales en ventana de 5 minutos. Es en memoria (*best-effort*): en Vercel cada instancia tiene su propia memoria, así que no es una garantía dura (explicado en `lib/rate-limit.ts`).
- **Cabeceras** (`vercel.json`): `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restrictiva y una `Content-Security-Policy`.
- **Secretos** solo por variables de entorno (`OPENAI_API_KEY`, `SATJE_API_KEY`, `SATJE_AUTH_PASSWORD`, `SATJE_SESSION_SECRET`, `UPSTASH_VECTOR_REST_URL/TOKEN`, `SATJE_API_BASE_URL`). `.env*`, `.dev.vars` y `.cloudflare_token` están en `.gitignore`.

## 4. Topes operativos (constantes en `api/index.ts`)

| Tope | Valor |
|---|---|
| Causas por lote | 25 |
| Personas por lote supervisor | 30 |
| Concurrencia: causas / personas / detalle por persona | 4 / 4 / 3 |
| Presupuesto total de un lote | 50 s |
| Timeouts hacia el backend: búsqueda / documentos / extracción de texto | 30 s / 20 s / 45 s |

Al agotarse el presupuesto del lote se dejan de lanzar llamadas y las filas pendientes se devuelven marcadas, en lugar de perder todo el trabajo.

## 5. Pruebas

`npm test` ejecuta 81 pruebas de `lib/` con el *test runner* nativo de Node: `legal-analysis` (50), `auth` (14), `dashboard-html` (6), `rate-limit` (6) y `concurrencia` (5). `npm run typecheck` verifica TypeScript. El backend Python tiene su propia suite en `extracted_api/tests/` (`pytest`). No hay pruebas automáticas de `api/index.ts`, `chat-tools.ts` ni del Worker.

## 6. Limitaciones conocidas

Anotadas aquí porque afectan la confianza en los resultados:

1. **El RAG puede heredar la fecha de inscripción de otra causa.** En `api/index.ts` (bloque "RAG especializado de medidas cautelares"), si la causa consultada no tiene fecha de inscripción confirmada, se copia la de una causa "similar" de Upstash (similitud ≥ 0,78) y se marca la confianza como `ALTA`. Una fecha registral ajena presentada con confianza alta es un riesgo jurídico. El informe de auditoría histórico del 18-ago-2026 la daba por eliminada; en el código actual sigue presente.
2. **El prompt del chat no tiene una directiva explícita anti-alucinación** del tipo "no completes fechas ni hechos faltantes" (solo indica reportar los campos `error`).
3. **Datos de cartera (deudor/garante) no calculados:** la unidad judicial deprecada y la fecha de calificación del deprecatorio por rol deudor/garante, y la "Fecha de Etapa", aparecen como "No disponible" en el lote supervisor.
4. **Sin roles:** existe una sola contraseña compartida; no hay rol "supervisor".
5. **El Worker no está al día con Vercel:** no tiene lote, cédula ni reinicio.
6. **Cédula del demandado:** SATJE normalmente no la expone; solo a veces aparece como "casillero electrónico" en notificaciones.

## 7. Documentos históricos

`docs/historico/` conserva la auditoría y el changelog del 18-ago-2026 como registro de lo que se hizo entonces. No describen el estado actual.
