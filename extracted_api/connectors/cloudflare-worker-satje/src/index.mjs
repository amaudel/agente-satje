const HOST = 'api.funcionjudicial.gob.ec';
const BASE_URL = `https://${HOST}`;
const ACTUACIONES_PATH = '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales';
const DOCUMENT_HBA_PATH = '/CJ-DOCUMENTO-SERVICE/api/document/query/hba';
const ANEXOS_PATH = '/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/datos/anexos';

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  Origin: 'https://procesosjudiciales.funcionjudicial.gob.ec',
  Referer: 'https://procesosjudiciales.funcionjudicial.gob.ec/',
  'User-Agent': 'Mozilla/5.0 satje-cloudflare-worker-connector/0.1',
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validateTokens(request, env, input) {
  if (env.WORKER_API_TOKEN) {
    const actual = request.headers.get('Authorization') || '';
    if (actual !== `Bearer ${env.WORKER_API_TOKEN}`) {
      const error = new Error('Invalid Worker bearer token');
      error.code = 'CONNECTOR_UNAUTHORIZED';
      throw error;
    }
  }

  if (env.CONNECTOR_TOKEN && input?.connectorToken !== env.CONNECTOR_TOKEN) {
    const error = new Error('Invalid connector token');
    error.code = 'CONNECTOR_UNAUTHORIZED';
    throw error;
  }
}

function classifyError(error) {
  const code = error?.code || error?.cause?.code || '';
  const message = String(error?.message || error?.cause?.message || '');
  const name = String(error?.name || error?.cause?.name || '');
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'SATJE_DNS_ERROR';
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code) || /timeout|timed out/i.test(message)) return 'SATJE_TIMEOUT';
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'SATJE_CONNECTION_ERROR';
  if (/tls|ssl|certificate/i.test(`${name} ${message}`)) return 'SATJE_TLS_ERROR';
  if (code === 'CONNECTOR_UNAUTHORIZED') return 'SATJE_BLOCKED';
  if (/captcha/i.test(message)) return 'SATJE_CAPTCHA_REQUIRED';
  return 'SATJE_INVALID_RESPONSE';
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  return { controller, done: () => clearTimeout(timer) };
}

async function requestJson(method, path, body, timeoutMs) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: HEADERS,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeout.controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`SATJE HTTP ${response.status}: ${text.slice(0, 240)}`);
      error.code = response.status === 429 || response.status === 403 ? 'SATJE_BLOCKED' : 'SATJE_HTTP_ERROR';
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      if (/captcha|html/i.test(text)) {
        error.code = 'SATJE_CAPTCHA_REQUIRED';
      }
      throw error;
    }
  } finally {
    timeout.done();
  }
}

async function requestBuffer(method, path, timeoutMs) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...HEADERS, Accept: '*/*' },
      signal: timeout.controller.signal,
    });
    const buffer = await response.arrayBuffer();
    if (!response.ok) {
      const text = new TextDecoder().decode(buffer.slice(0, 240));
      const error = new Error(`SATJE HTTP ${response.status}: ${text}`);
      error.code = response.status === 429 || response.status === 403 ? 'SATJE_BLOCKED' : 'SATJE_HTTP_ERROR';
      throw error;
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return {
      contentType: response.headers.get('content-type'),
      contentLength: buffer.byteLength,
      headers: {
        date: response.headers.get('date'),
        'content-length': response.headers.get('content-length'),
        'content-disposition': response.headers.get('content-disposition'),
      },
      base64: btoa(binary),
    };
  } finally {
    timeout.done();
  }
}

async function runOperation(input, timeoutMs) {
  if (input.operation === 'buscarCausas') {
    const page = Number(input.page || 1);
    const size = Number(input.size || 10);
    const path = `/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas?page=${page}&size=${size}`;
    return await requestJson('POST', path, input.payload, timeoutMs);
  }
  if (input.operation === 'getIncidenteJudicatura') {
    const idJuicio = String(input.idJuicio || '').trim();
    if (!idJuicio) throw new Error('idJuicio is required');
    return await requestJson(
      'GET',
      `/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion/getIncidenteJudicatura/${encodeURIComponent(idJuicio)}`,
      null,
      timeoutMs,
    );
  }
  if (input.operation === 'actuacionesJudiciales') {
    return await requestJson('POST', ACTUACIONES_PATH, input.payload, timeoutMs);
  }
  if (input.operation === 'documentHba') {
    const code = String(input.code || '').trim();
    if (!code) throw new Error('code is required');
    return await requestBuffer('GET', `${DOCUMENT_HBA_PATH}?code=${encodeURIComponent(code)}`, timeoutMs);
  }
  if (input.operation === 'documentosAnexos') {
    return await requestJson('POST', ANEXOS_PATH, input.payload, timeoutMs);
  }
  throw new Error(`Unsupported operation: ${input.operation}`);
}

export default {
  async fetch(request, env) {
    let input;
    try {
      if (request.method !== 'POST') {
        return jsonResponse(405, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Use POST' } });
      }
      input = await request.json();
      validateTokens(request, env, input);
      const timeoutMs = Number(input?.timeoutMs || 15000);
      const data = await runOperation(input, timeoutMs);
      return jsonResponse(200, { success: true, operation: input.operation, data });
    } catch (error) {
      return jsonResponse(200, {
        success: false,
        operation: input?.operation,
        error: {
          code: classifyError(error),
          message: String(error?.message || error),
          type: error?.constructor?.name || 'Error',
          rawCode: error?.code,
        },
      });
    }
  },
};

export { runOperation };
