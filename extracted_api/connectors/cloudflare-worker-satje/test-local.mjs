import worker from './src/index.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('/getIncidenteJudicatura/01371201700497')) {
    throw new Error(`Unexpected SATJE URL: ${url}`);
  }
  if (init?.method !== 'GET') {
    throw new Error(`Unexpected method: ${init?.method}`);
  }
  return new Response(
    JSON.stringify([
      {
        idJudicatura: '01371',
        nombreJudicatura: 'UNIDAD JUDICIAL DE TRABAJO CUENCA',
        lstIncidenteJudicatura: [
          {
            idIncidenteJudicatura: 20181767,
            idMovimientoJuicioIncidente: 19384296,
            idJudicaturaDestino: '01371',
            incidente: 1,
          },
        ],
      },
    ]),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const env = {
  CONNECTOR_TOKEN: 'local-connector-token',
  WORKER_API_TOKEN: 'local-worker-token',
};

const request = new Request('https://satje-worker.local/', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.WORKER_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    operation: 'getIncidenteJudicatura',
    idJuicio: '01371201700497',
    timeoutMs: 15000,
    connectorToken: env.CONNECTOR_TOKEN,
  }),
});

const response = await worker.fetch(request, env);
const body = await response.json();

if (body.success !== true) {
  throw new Error(`Worker local smoke fallo: ${JSON.stringify(body)}`);
}

const data = body.data;
const count = Array.isArray(data) ? data.length : 'n/a';
console.log(`Worker local smoke OK: operation=${body.operation} items=${count}`);

// documentosAnexos: SATJE separa el documento principal de una actuacion de
// sus anexos (ej. un OFICIO con un certificado adjunto) en este endpoint
// distinto. Verifica que la operacion se reenvie con el payload correcto.
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/datos/anexos')) {
    throw new Error(`Unexpected SATJE URL: ${url}`);
  }
  if (init?.method !== 'POST') {
    throw new Error(`Unexpected method: ${init?.method}`);
  }
  const forwarded = JSON.parse(init.body);
  if (forwarded.TablaReferencia !== 'EscritosPrimera' || forwarded.IdTablaReferencia !== 68880635) {
    throw new Error(`Unexpected payload forwarded: ${init.body}`);
  }
  return new Response(
    JSON.stringify([
      { UUID: '20250916-173527716361-593792259-1617253577', nombreArchivo: 'OFICIO', descripcion: 'OFICIO', paginas: 6 },
    ]),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const anexosRequest = new Request('https://satje-worker.local/', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.WORKER_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    operation: 'documentosAnexos',
    payload: {
      TablaReferencia: 'EscritosPrimera',
      IdTablaReferencia: 68880635,
      IdIndiceElectronico: 0,
      idmovimientojuicioincidente: 27491614,
      tipoActuacion: 'OFICIO',
    },
    timeoutMs: 15000,
    connectorToken: env.CONNECTOR_TOKEN,
  }),
});

const anexosResponse = await worker.fetch(anexosRequest, env);
const anexosBody = await anexosResponse.json();
if (anexosBody.success !== true) {
  throw new Error(`documentosAnexos fallo: ${JSON.stringify(anexosBody)}`);
}
if (!Array.isArray(anexosBody.data) || anexosBody.data[0]?.UUID !== '20250916-173527716361-593792259-1617253577') {
  throw new Error(`documentosAnexos devolvio forma inesperada: ${JSON.stringify(anexosBody)}`);
}
console.log(`Worker local smoke OK: operation=documentosAnexos items=${anexosBody.data.length}`);

globalThis.fetch = originalFetch;
