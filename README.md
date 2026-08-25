# Agente SATJE

Agente de IA para consultar y analizar procesos judiciales del SATJE (Sistema Automático de Trámite Judicial de Ecuador). Incluye un dashboard con chat legal con IA, alertas de abandono procesal, seguimiento de medidas cautelares y extracción de documentos adjuntos (incluyendo anexos y OCR).

## Arquitectura

El proyecto está compuesto por varias piezas independientes que se despliegan por separado:

| Componente | Descripción | Despliegue |
|---|---|---|
| `api/` + `lib/` | Dashboard + chat legal con IA (Node/TypeScript, funciones serverless de Vercel) | Vercel — `agente-satje.vercel.app` |
| `src/` | Espejo del agente como Cloudflare Worker | Cloudflare Workers — `agente-satje.andresdelgado1984.workers.dev` |
| `extracted_api/` | Backend Python (FastAPI) que consulta SATJE directamente y expone una API propia | VPS propio — `api.asitentekairon.cloud` |
| `extracted_api/connectors/` | Conectores (AWS Lambda / Cloudflare Worker) que le permiten al backend del VPS llegar a SATJE cuando no hay conexión directa | AWS Lambda / Cloudflare Workers |

`lib/legal-analysis.ts` contiene toda la lógica jurídica pura (clasificación de etapa procesal, ciclo de vida de medidas cautelares, alerta de abandono procesal COGEP Art. 245-247) y es compartida entre el handler de Vercel (`api/index.ts`) y el Worker de Cloudflare (`src/index.ts`) para mantener el mismo comportamiento en ambos.

## Funcionalidades principales

- **Búsqueda de causas** por cédula (individual y en lote) y consulta directa por número de proceso.
- **Chat legal con IA** (OpenAI, con function calling) que responde sobre la causa en pantalla, lee resoluciones, extrae texto de documentos adjuntos (incluyendo anexos reales de una actuación) y puede consultar otra causa distinta durante la conversación.
- **Clasificación de etapa procesal** y **detección de sentencia**.
- **Ciclo de vida de medidas cautelares** (ordenada → oficiada → inscrita → levantada) con las 4 fechas procesales relevantes.
- **Alerta preventiva de abandono procesal** (COGEP Art. 245-247), incluyendo detección de abandono ya declarado por el juez y búsqueda de un posible proceso de reinicio tras abandono (por cédula + comparación de asunto).
- **Extracción de texto de documentos** (PDF, con OCR como respaldo) para citar el contenido real de oficios, providencias y anexos.

## Estructura del repositorio

```
api/                  Handler serverless de Vercel (dashboard + chat)
lib/                  Lógica compartida (análisis legal, chat tools, auth, dashboard HTML, Upstash)
src/                  Cloudflare Worker (espejo del agente)
scripts/              Servidor de desarrollo local y mock de SATJE para pruebas
tests/                Scripts de prueba puntuales (auth, chat, dashboard en lote)
extracted_api/        Backend Python (FastAPI) + conectores + tests + docs de la API
graphify-out/         Grafo de conocimiento del proyecto (generado, no versionado)
```

## Desarrollo local

```bash
npm install
npm test              # tests de lib/ (Node test runner vía tsx)
node scripts/local-dev-server.mjs   # servidor local que envuelve el handler de Vercel
```

Para el backend Python, ver [`extracted_api/README.md`](extracted_api/README.md).

## Variables de entorno

Configurar en `.env.local` (Vercel) / `.dev.vars` (Cloudflare Worker) — nunca commitear:

- `OPENAI_API_KEY` — clave de OpenAI para el chat legal con IA.
- `SATJE_API_BASE_URL`, `SATJE_API_KEY` — backend SATJE (`extracted_api`).
- `SATJE_AUTH_PASSWORD` — contraseña de acceso al dashboard.
- `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN` — motor RAG de precedentes (opcional).

Ver `extracted_api/.env.example` para las variables del backend Python.
