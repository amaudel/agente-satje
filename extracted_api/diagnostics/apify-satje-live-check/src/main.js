import { Actor } from 'apify';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const HOST = 'api.funcionjudicial.gob.ec';
const BASE_URL = `https://${HOST}`;
const INCIDENT_PATH = '/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion/getIncidenteJudicatura/01371201700497';
const BUSCAR_PATH = '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas?page=1&size=10';
const ACTUACIONES_PATH = '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales';
const DOCUMENT_HBA_PATH = '/CJ-DOCUMENTO-SERVICE/api/document/query/hba';

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  Origin: 'https://procesosjudiciales.funcionjudicial.gob.ec',
  Referer: 'https://procesosjudiciales.funcionjudicial.gob.ec/',
  'User-Agent': 'Mozilla/5.0 satje-live-diagnostic/0.1',
};

const buscarPayload = {
  numeroCausa: '',
  actor: { cedulaActor: '0104270855', nombreActor: '' },
  demandado: { cedulaDemandado: '', nombreDemandado: '' },
  provincia: '',
  numeroFiscalia: '',
  recaptcha: 'verdad',
  first: 1,
  pageSize: 10,
};

const actuacionesPayload = {
  idMovimientoJuicioIncidente: 19384296,
  idJuicio: '01371201700497',
  idJudicatura: '01371',
  idIncidenteJudicatura: 20181767,
  aplicativo: 'web',
  nombreJudicatura: 'UNIDAD JUDICIAL DE TRABAJO CUENCA',
  incidente: 1,
};

function validateConnectorToken(input) {
  const expected = process.env.CONNECTOR_TOKEN;
  if (expected && input?.connectorToken !== expected) {
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
  return 'UNKNOWN';
}

async function timed(stage, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    return { stage, ok: true, durationMs: Math.round((performance.now() - start) * 100) / 100, result };
  } catch (error) {
    return {
      stage,
      ok: false,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      errorType: error?.constructor?.name || 'Error',
      errorCode: error?.code,
      error: String(error?.message || error),
      classification: classifyError(error),
    };
  }
}

function connectTcp(address, family, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port: 443, family });
    const timeout = setTimeout(() => {
      socket.destroy(Object.assign(new Error(`TCP timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve({ address, family, port: 443 });
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function connectTls(address, family, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: address,
      port: 443,
      family,
      servername: HOST,
      rejectUnauthorized: true,
    });
    const timeout = setTimeout(() => {
      socket.destroy(Object.assign(new Error(`TLS timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      clearTimeout(timeout);
      socket.end();
      resolve({
        address,
        family,
        authorized: socket.authorized,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name,
        subject: cert?.subject,
        issuer: cert?.issuer,
      });
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers['content-type'],
            contentLength: buffer.length,
            headers: {
              server: res.headers.server,
              date: res.headers.date,
              'content-length': res.headers['content-length'],
            },
            bodyStart: text.slice(0, 240),
            jsonKind: text.trim().startsWith('[') ? 'array' : text.trim().startsWith('{') ? 'object' : 'other',
            json: JSON.parse(text),
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
          const textStart = buffer.toString('utf8', 0, Math.min(buffer.length, 500));
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers['content-type'],
            contentLength: buffer.length,
            headers: {
              server: res.headers.server,
              date: res.headers.date,
              'content-length': res.headers['content-length'],
              'content-disposition': res.headers['content-disposition'],
            },
            bodyStart: textStart,
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

async function runConnectorOperation(input, timeoutMs) {
  validateConnectorToken(input);
  if (input.operation === 'buscarCausas') {
    const page = Number(input.page || 1);
    const size = Number(input.size || 10);
    const path = `/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas?page=${page}&size=${size}`;
    const response = await requestJson('POST', path, input.payload, timeoutMs);
    return response.json;
  }
  if (input.operation === 'getIncidenteJudicatura') {
    const idJuicio = String(input.idJuicio || '').trim();
    if (!idJuicio) throw new Error('idJuicio is required');
    const response = await requestJson(
      'GET',
      `/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion/getIncidenteJudicatura/${encodeURIComponent(idJuicio)}`,
      null,
      timeoutMs,
    );
    return response.json;
  }
  if (input.operation === 'actuacionesJudiciales') {
    const response = await requestJson('POST', ACTUACIONES_PATH, input.payload, timeoutMs);
    return response.json;
  }
  if (input.operation === 'documentHba') {
    const code = String(input.code || '').trim();
    if (!code) throw new Error('code is required');
    const response = await requestBuffer(
      'GET',
      `${DOCUMENT_HBA_PATH}?code=${encodeURIComponent(code)}`,
      null,
      timeoutMs,
    );
    return response;
  }
  throw new Error(`Unsupported operation: ${input.operation}`);
}

async function publicIp() {
  const response = await fetch('https://ipapi.co/json/');
  if (!response.ok) throw new Error(`ipapi status ${response.status}`);
  const data = await response.json();
  return {
    ip: data.ip,
    provider: data.org || data.asn,
    country: data.country_name,
    region: data.region,
    city: data.city,
  };
}

await Actor.init();

const input = await Actor.getInput();
const timeoutMs = Number(input?.timeoutMs || 15000);

if (input?.operation) {
  try {
    const data = await runConnectorOperation(input, timeoutMs);
    await Actor.pushData({ success: true, operation: input.operation, data });
  } catch (error) {
    await Actor.pushData({
      success: false,
      operation: input.operation,
      error: {
        code: classifyError(error),
        message: String(error?.message || error),
        type: error?.constructor?.name || 'Error',
        rawCode: error?.code,
      },
    });
  }
  await Actor.exit();
}

const report = {
  ranAt: new Date().toISOString(),
  infrastructure: await timed('public_ip', publicIp),
  host: HOST,
  checks: [],
};

const dns4 = await timed('dns_ipv4', () => dns.resolve4(HOST));
const dns6 = await timed('dns_ipv6', () => dns.resolve6(HOST));
report.checks.push(dns4, dns6);

const addresses = [
  ...(dns4.ok ? dns4.result.map((address) => ({ address, family: 4 })) : []),
  ...(dns6.ok ? dns6.result.map((address) => ({ address, family: 6 })) : []),
];

for (const { address, family } of addresses) {
  report.checks.push(await timed(`tcp_${family}_${address}`, () => connectTcp(address, family, timeoutMs)));
  report.checks.push(await timed(`tls_${family}_${address}`, () => connectTls(address, family, timeoutMs)));
}

report.checks.push(await timed('http_get_incidentes', () => requestJson('GET', INCIDENT_PATH, null, timeoutMs)));
report.checks.push(await timed('http_post_buscar_causas', () => requestJson('POST', BUSCAR_PATH, buscarPayload, timeoutMs)));
report.checks.push(await timed('http_post_actuaciones', () => requestJson('POST', ACTUACIONES_PATH, actuacionesPayload, timeoutMs)));

await Actor.pushData(report);
console.log(JSON.stringify(report, null, 2));

await Actor.exit();
