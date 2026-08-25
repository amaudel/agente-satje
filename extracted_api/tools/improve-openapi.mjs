import { readFileSync, writeFileSync } from "node:fs";

const input = new URL("../docs/openapi.json", import.meta.url);
const spec = JSON.parse(readFileSync(input, "utf8"));

spec.info.version = "1.1.0";
spec.info.description =
  "API comercial para consultas puntuales de procesos judiciales de Ecuador. Contrato de integración tipado para aplicaciones cliente.";
spec.servers = [
  {
    url: "https://api.asitentekairon.cloud",
    description: "Producción",
  },
];
spec["x-contract-notes"] = {
  compatibility:
    "Esta revisión añade endpoints compatibles de paginacion de actuaciones y candidatas a resolucion sin cambiar el comportamiento de endpoints existentes.",
  staging: "Staging publico disponible en https://staging-api.asitentekairon.cloud.",
};

const publicPaths = [
  "/health",
  "/health/satje",
  "/api/v1/causas/buscar",
  "/api/v1/causas/{id_juicio}/actuaciones",
  "/api/v1/causas/{id_juicio}/actuaciones/paginadas",
  "/api/v1/causas/{id_juicio}/resoluciones",
  "/api/v1/causas/{id_juicio}/actuaciones/{codigo_actuacion}/documentos",
  "/api/v1/causas/{id_juicio}/abandono/riesgo",
  "/api/v1/causas/{id_juicio}/pdf",
  "/api/v1/documentos/hba/extract-text",
  "/api/v1/ops/metrics",
];

spec.paths = Object.fromEntries(publicPaths.map((path) => [path, spec.paths[path]]).filter(([, value]) => value));

const schemas = spec.components.schemas;

schemas.CacheInfo = {
  type: "object",
  additionalProperties: true,
  properties: {
    hit: { type: "boolean" },
    ttlSeconds: { type: "integer", minimum: 0 },
  },
};

schemas.ErrorResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "error", "requestId"],
  properties: {
    success: { type: "boolean", const: false },
    error: {
      type: "object",
      additionalProperties: true,
      required: ["code", "message", "stage", "retryable"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        stage: { type: "string" },
        retryable: { type: "boolean" },
      },
    },
    requestId: { type: "string" },
  },
};

schemas.CausaResumen = {
  type: "object",
  additionalProperties: true,
  required: ["idJuicio"],
  properties: {
    idJuicio: { type: "string" },
    numeroProceso: { type: ["string", "null"] },
    estadoActual: { type: ["string", "null"] },
    materia: { type: ["string", "null"] },
    accion: { type: ["string", "null"] },
    judicatura: { type: ["string", "null"] },
    fechaIngreso: { type: ["string", "null"], format: "date-time" },
    rolesEncontrados: {
      type: "array",
      items: { type: "string", enum: ["actor", "demandado"] },
    },
    raw: { type: ["object", "null"], additionalProperties: true },
  },
};

schemas.BuscarCausasResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "source", "mode", "retrievedAt", "cedula", "total", "data", "requestId"],
  properties: {
    success: { type: "boolean", const: true },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    cedula: { type: "string" },
    total: { type: "integer", minimum: 0 },
    data: { type: "array", items: { $ref: "#/components/schemas/CausaResumen" } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

schemas.DocumentoReferencia = {
  type: "object",
  additionalProperties: true,
  properties: {
    documentoId: { type: "string" },
    nombre: { type: ["string", "null"] },
    nombreArchivo: { type: ["string", "null"] },
    tipo: { type: ["string", "null"] },
    disponible: { type: "boolean" },
    codigoActuacion: { type: ["string", "integer", "null"] },
    fechaActuacion: { type: ["string", "null"], format: "date-time" },
  },
};

schemas.Actuacion = {
  type: "object",
  additionalProperties: true,
  properties: {
    codigoActuacion: { type: ["string", "integer", "null"] },
    codigo: { type: ["string", "integer", "null"] },
    idJuicio: { type: ["string", "null"] },
    fecha: { type: ["string", "null"], format: "date-time" },
    tipo: { type: ["string", "null"] },
    actividad: { type: ["string", "null"] },
    ieDocumentoAdjunto: { type: ["string", "null"] },
    nombreArchivo: { type: ["string", "null"] },
    alias: { type: ["string", "null"] },
    documentos: {
      type: "array",
      items: { $ref: "#/components/schemas/DocumentoReferencia" },
    },
  },
};

schemas.IncidenteActuaciones = {
  type: "object",
  additionalProperties: true,
  properties: {
    idIncidenteJudicatura: { type: ["string", "integer", "null"] },
    idMovimientoJuicioIncidente: { type: ["string", "integer", "null"] },
    incidente: { type: ["string", "integer", "null"] },
    idJudicatura: { type: ["string", "integer", "null"] },
    nombreJudicatura: { type: ["string", "null"] },
    totalActuaciones: { type: "integer", minimum: 0 },
    actuaciones: {
      type: "array",
      items: { $ref: "#/components/schemas/Actuacion" },
    },
  },
};

schemas.ActuacionesResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "idJuicio", "incidentes", "requestId"],
  properties: {
    success: { type: "boolean", const: true },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    idJuicio: { type: "string" },
    total: { type: "integer", minimum: 0 },
    totalIncidentes: { type: "integer", minimum: 0 },
    totalActuaciones: { type: "integer", minimum: 0 },
    incidentes: {
      type: "array",
      items: { $ref: "#/components/schemas/IncidenteActuaciones" },
    },
    partialErrors: { type: "array", items: { type: "object", additionalProperties: true } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

schemas.PaginationInfo = {
  type: "object",
  required: ["page", "pageSize", "totalItems", "totalPages", "hasNext", "hasPrevious"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
    hasNext: { type: "boolean" },
    hasPrevious: { type: "boolean" },
  },
};

schemas.ActuacionPaginada = {
  type: "object",
  additionalProperties: false,
  required: [
    "idIncidenteJudicatura",
    "incidente",
    "idJudicatura",
    "nombreJudicatura",
    "codigoActuacion",
    "fecha",
    "tipo",
    "actividad",
    "tieneDocumento",
  ],
  properties: {
    idIncidenteJudicatura: { type: ["string", "integer", "null"] },
    incidente: { type: ["string", "integer", "null"] },
    idJudicatura: { type: ["string", "integer", "null"] },
    nombreJudicatura: { type: ["string", "null"] },
    codigoActuacion: { type: ["string", "integer", "null"] },
    fecha: { type: ["string", "null"], format: "date-time" },
    tipo: { type: ["string", "null"] },
    actividad: { type: ["string", "null"] },
    tieneDocumento: { type: "boolean" },
  },
};

schemas.ActuacionesPaginadasResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "idJuicio", "pagination", "data", "requestId"],
  properties: {
    success: { type: "boolean" },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    idJuicio: { type: "string" },
    pagination: { $ref: "#/components/schemas/PaginationInfo" },
    data: { type: "array", items: { $ref: "#/components/schemas/ActuacionPaginada" } },
    partialErrors: { type: "array", items: { type: "object", additionalProperties: true } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

schemas.ResolucionCandidata = {
  type: "object",
  additionalProperties: true,
  properties: {
    codigoActuacion: { type: ["string", "integer", "null"] },
    fecha: { type: ["string", "null"], format: "date-time" },
    tipo: { type: ["string", "null"] },
    actividad: { type: ["string", "null"] },
    nombreJudicatura: { type: ["string", "null"] },
    tieneDocumento: { type: "boolean" },
    cantidadDocumentos: { type: "integer", minimum: 0 },
    documentoId: { type: ["string", "null"] },
    criterioCoincidencia: { type: "array", items: { type: "string" } },
    nivelConfianza: { type: "string", enum: ["alto", "medio", "bajo"] },
    advertencia: { type: "string" },
  },
};

schemas.ResolucionesResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "idJuicio", "total", "data", "requestId"],
  properties: {
    success: { type: "boolean" },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    idJuicio: { type: "string" },
    total: { type: "integer", minimum: 0 },
    data: { type: "array", items: { $ref: "#/components/schemas/ResolucionCandidata" } },
    partialErrors: { type: "array", items: { type: "object", additionalProperties: true } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

schemas.DocumentosResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "idJuicio", "codigoActuacion", "total", "data", "requestId"],
  properties: {
    success: { type: "boolean", const: true },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    idJuicio: { type: "string" },
    codigoActuacion: { type: ["string", "integer"] },
    total: { type: "integer", minimum: 0 },
    data: { type: "array", items: { $ref: "#/components/schemas/DocumentoReferencia" } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

schemas.RelojAbandono = {
  type: ["object", "null"],
  additionalProperties: true,
  properties: {
    ambito: { type: "string" },
    ultimaActuacion: { type: ["object", "null"], additionalProperties: true },
    inicioComputo: { type: ["string", "null"], format: "date" },
    plazoLegalMeses: { type: "integer", minimum: 0 },
    fechaReferencialAbandono: { type: ["string", "null"], format: "date" },
    diasRestantes: { type: ["integer", "null"] },
    estadoAlerta: { type: ["string", "null"] },
  },
};

schemas.AbandonoRiesgoResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "idJuicio", "fechaCorte", "requestId"],
  properties: {
    success: { type: "boolean", const: true },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    idJuicio: { type: "string" },
    fechaCorte: { type: "string", format: "date" },
    baseLegalReferencial: { type: "string" },
    reglaApp: { type: "string" },
    relojProcesoPrincipal: { $ref: "#/components/schemas/RelojAbandono" },
    relojUnidadDeprecada: { $ref: "#/components/schemas/RelojAbandono" },
    alertaGeneral: { type: ["object", "null"], additionalProperties: true },
    advertencias: { type: "array", items: { type: "string" } },
    partialErrors: { type: "array", items: { type: "object", additionalProperties: true } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

schemas.PageText = {
  type: "object",
  required: ["page", "text"],
  properties: {
    page: { type: "integer", minimum: 1 },
    text: { type: "string" },
  },
};

schemas.DocumentHbaTextResponse = {
  type: "object",
  additionalProperties: true,
  required: ["success", "documentoId", "pages", "extractionMethod", "text", "requestId"],
  properties: {
    success: { type: "boolean", const: true },
    source: { type: "string" },
    mode: { type: "string", enum: ["live", "fixture"] },
    retrievedAt: { type: "string", format: "date-time" },
    documentoId: { type: "string" },
    contentType: { type: "string" },
    contentLength: { type: "integer", minimum: 0 },
    pages: { type: "integer", minimum: 0 },
    extractionMethod: { type: "string" },
    text: { type: "string" },
    pageTexts: { type: "array", items: { $ref: "#/components/schemas/PageText" } },
    requestId: { type: "string" },
    cache: { $ref: "#/components/schemas/CacheInfo" },
  },
};

const jsonResponse = (schemaName) => ({
  description: "Successful Response",
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaName}` },
    },
  },
});

const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
});

const commercialErrors = {
  401: errorResponse("API key comercial faltante o invalida."),
  403: errorResponse("Permisos comerciales insuficientes."),
  404: errorResponse("Recurso no encontrado."),
  422: errorResponse("Parametros invalidos."),
  429: errorResponse("Rate limit aplicado por gateway."),
  502: errorResponse("SATJE o conector devolvio una respuesta no compatible."),
  504: errorResponse("Timeout consultando SATJE o conector."),
};

spec.paths["/api/v1/causas/buscar"].post.responses["200"] = jsonResponse("BuscarCausasResponse");
spec.paths["/api/v1/causas/{id_juicio}/actuaciones"].get.responses["200"] = jsonResponse("ActuacionesResponse");
spec.paths["/api/v1/causas/{id_juicio}/actuaciones/paginadas"].get.responses["200"] = jsonResponse("ActuacionesPaginadasResponse");
spec.paths["/api/v1/causas/{id_juicio}/resoluciones"].get.responses["200"] = jsonResponse("ResolucionesResponse");
spec.paths["/api/v1/causas/{id_juicio}/actuaciones/{codigo_actuacion}/documentos"].get.responses["200"] = jsonResponse("DocumentosResponse");
spec.paths["/api/v1/causas/{id_juicio}/abandono/riesgo"].get.responses["200"] = jsonResponse("AbandonoRiesgoResponse");
spec.paths["/api/v1/documentos/hba/extract-text"].post.responses["200"] = jsonResponse("DocumentHbaTextResponse");

for (const [path, pathItem] of Object.entries(spec.paths)) {
  if (!path.startsWith("/api/v1/causas") && !path.startsWith("/api/v1/documentos")) {
    continue;
  }
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) {
      continue;
    }
    operation.responses = {
      ...operation.responses,
      ...commercialErrors,
    };
  }
}

writeFileSync(input, `${JSON.stringify(spec, null, 2)}\n`);
