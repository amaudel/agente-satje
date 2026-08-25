# SATJE Cloudflare Worker Connector

Conector ligero para llamar a `api.funcionjudicial.gob.ec` desde Cloudflare Workers y usarlo como alternativa a Apify/Lambda.

## Prueba local

```bash
cd /home/ubuntu/.openclaw/workspace/projects/ecuador-judicial-api/connectors/cloudflare-worker-satje
npm test
```

La prueba local importa el Worker en Node y ejecuta `getIncidenteJudicatura` contra SATJE.

## Despliegue con Wrangler

```bash
cd /home/ubuntu/.openclaw/workspace/projects/ecuador-judicial-api/connectors/cloudflare-worker-satje
npm install
npx wrangler login
npx wrangler secret put CONNECTOR_TOKEN
npx wrangler secret put WORKER_API_TOKEN
npx wrangler deploy
```

`CONNECTOR_TOKEN` y `WORKER_API_TOKEN` deben ser secretos largos. No los pegues en chats.

Variables para la API principal:

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

Para validar un Worker ya desplegado:

```bash
./connectors/cloudflare-worker-satje/smoke-test.sh
```

## Despliegue manual por consola web

1. Crear un Worker nuevo en Cloudflare.
2. Copiar el contenido de `src/index.mjs` en el editor.
3. Agregar variables secretas `CONNECTOR_TOKEN` y `WORKER_API_TOKEN`.
4. Deploy.
5. Copiar la URL publica del Worker a `SATJE_CLOUDFLARE_WORKER_URL`.
