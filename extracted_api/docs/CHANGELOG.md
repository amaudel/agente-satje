# Historial del contrato de integración

## 1.1.0 - 2026-07-19

- Se implementaron `GET /api/v1/causas/{idJuicio}/actuaciones/paginadas` y
  `GET /api/v1/causas/{idJuicio}/resoluciones`.
- Se reforzo el orden deterministico de actuaciones paginadas usando fecha/hora
  y `codigoActuacion`.
- Se preserva `requestId` en errores funcionales y errores HTTP.
- Se reforzo sanitizacion de logs para enmascarar cedulas/RUC y omitir
  actuaciones completas o textos HBA completos.
- Se agregaron pruebas de regresion del endpoint historico, permisos
  comerciales, limites, filtros, paginas vacias y errores upstream.
- Se añadió `servers` con la URL de producción.
- Se tiparon las respuestas de búsqueda, actuaciones, actuaciones paginadas,
  resoluciones, documentos HBA, riesgo de abandono y extracción de texto.
- Se preservaron los endpoints, métodos, parámetros y esquemas de autenticación existentes.
- Se añadió documentación de compatibilidad, credenciales y validación.
- No se modificó el comportamiento de los endpoints existentes.

## 1.0.0

- Contrato inicial exportado desde FastAPI.
