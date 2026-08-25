# Mejoras de backend incorporadas en 1.1.0

Estas operaciones ya forman parte del contrato ejecutable `1.1.0`. Se
mantiene este documento como nota de diseño para explicar el motivo y las
precauciones de producto.

## 1. Actuaciones paginadas

Problema observado: algunos procesos producen una respuesta demasiado grande para clientes como GPT Actions y pueden afectar tiempo, memoria y experiencia de usuario.

Opción compatible recomendada:

```http
GET /api/v1/causas/{id_juicio}/actuaciones/paginadas?page=1&pageSize=20&orden=desc
```

Respuesta sugerida:

```json
{
  "success": true,
  "idJuicio": "01204201703564",
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 150,
    "totalPages": 8,
    "hasMore": true
  },
  "data": [],
  "requestId": "req_xxx"
}
```

El endpoint actual debe conservar su comportamiento para no romper aplicaciones existentes.

## 2. Resoluciones y sentencias relevantes

```http
GET /api/v1/causas/{id_juicio}/resoluciones?limit=20
```

Debe devolver actuaciones candidatas con fecha, tipo, resumen, código de actuación y existencia de documentos. La clasificación debe ser trazable y no afirmar el contenido de una sentencia sin evidencia documental.

## 3. Seguridad y costos

- Aplicar los mismos permisos y rate limits comerciales.
- Registrar `requestId`, duración, caché y consumo.
- Evitar duplicar consultas completas a SATJE cuando exista caché válida.
- Probar compatibilidad antes de publicar las rutas en el OpenAPI.
