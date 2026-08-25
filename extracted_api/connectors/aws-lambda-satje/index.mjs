import https from 'node:https';

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
  'User-Agent': 'Mozilla/5.0 satje-aws-lambda-connector/0.1',
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event?.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(text);
}

function validateTokens(event, input) {
  const expectedBearer = process.env.LAMBDA_API_TOKEN;
  if (expectedBearer) {
    const actual = event?.headers?.authorization || event?.headers?.Authorization || '';
    if (actual !== `Bearer ${expectedBearer}`) {
      const error = new Error('Invalid Lambda bearer token');
      error.code = 'CONNECTOR_UNAUTHORIZED';
      throw error;
    }
  }

  const expectedConnector = process.env.CONNECTOR_TOKEN;
  if (expectedConnector && input?.connectorToken !== expectedConnector) {
    const error = new Error('Invalid connector token');
    error.code = 'CONNECTOR_UNAUTHORIZED';
    throw error;
  }
}

function classifyError(error) {
  const code = error?.code || '';
  const message = String(error?.message || '');
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'SATJE_DNS_ERROR';
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code) || /timeout/i.test(message)) return 'SATJE_TIMEOUT';
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'SATJE_CONNECTION_ERROR';
  if (/tls|ssl|certificate/i.test(message)) return 'SATJE_TLS_ERROR';
  if (code === 'CONNECTOR_UNAUTHORIZED') return 'SATJE_BLOCKED';
  return 'SATJE_INVALID_RESPONSE';
}

function requestJson(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bodyText = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      `${BASE_URL}${path}`,
      {
        method,
        headers: {
          ...HEADERS,
          ...(bodyText ? { 'Content-Length': Buffer.byteLength(bodyText) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(`SATJE HTTP ${res.statusCode}: ${text.slice(0, 240)}`);
            error.code = res.statusCode === 429 || res.statusCode === 403 ? 'SATJE_BLOCKED' : 'SATJE_HTTP_ERROR';
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error(`HTTP timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

function requestBuffer(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bodyText = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      `${BASE_URL}${path}`,
      {
        method,
        headers: {
          ...HEADERS,
          Accept: '*/*',
          ...(bodyText ? { 'Content-Length': Buffer.byteLength(bodyText) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(`SATJE HTTP ${res.statusCode}: ${buffer.toString('utf8', 0, 240)}`);
            error.code = res.statusCode === 429 || res.statusCode === 403 ? 'SATJE_BLOCKED' : 'SATJE_HTTP_ERROR';
            reject(error);
            return;
          }
          resolve({
            contentType: res.headers['content-type'],
            contentLength: buffer.length,
            headers: {
              date: res.headers.date,
              'content-length': res.headers['content-length'],
              'content-disposition': res.headers['content-disposition'],
            },
            base64: buffer.toString('base64'),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error(`HTTP timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (bodyText) req.write(bodyText);
    req.end();
  });
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
    return await requestBuffer('GET', `${DOCUMENT_HBA_PATH}?code=${encodeURIComponent(code)}`, null, timeoutMs);
  }
  if (input.operation === 'documentosAnexos') {
    return await requestJson('POST', ANEXOS_PATH, input.payload, timeoutMs);
  }
  throw new Error(`Unsupported operation: ${input.operation}`);
}

export async function handler(event) {
  let input;
  try {
    input = parseBody(event);
    validateTokens(event, input);
    const timeoutMs = Number(input?.timeoutMs || 15000);
    const data = await runOperation(input, timeoutMs);
    return response(200, { success: true, operation: input.operation, data });
  } catch (error) {
    return response(200, {
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
}
