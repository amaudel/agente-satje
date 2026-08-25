# Paquete mejorado para desarrollador de app

Version del contrato: `1.1.0`.

Este paquete es solo para integrar una app comercial con Ecuador Judicial API.
No contiene configuracion interna de infraestructura, despliegue ni secretos
reales.

Contenido:

- `GUIA_INTEGRACION_APP.md`
- `openapi.json`
- `Ecuador_Judicial_API.postman_collection.json`
- `entorno-staging.template.postman_environment.json`
- `ejemplos-respuestas/`
- `errores.md`
- `limites-y-costos.md`
- `privacidad.md`
- `CHANGELOG.md`
- `VERSIONADO_Y_COMPATIBILIDAD.md`
- `CHECKLIST_INICIO_DESARROLLO.md`
- `MEJORAS_BACKEND_PROPUESTAS.md`
- `entorno-produccion.template.postman_environment.json`
- `examples/`

El OpenAPI mejorado declara el servidor de produccion y tipa las respuestas
principales sin cambiar rutas, autenticacion ni comportamiento del backend.
La exportacion original de FastAPI se conserva para comparacion.

Endpoint nuevo incluido:

- `GET /api/v1/causas/{idJuicio}/abandono/riesgo`: calcula alertas preventivas de abandono con reloj separado para proceso principal y unidad deprecada.

Contrato de salud:

- `GET /health`: publico, informacion minima.
- `GET /health/satje`: protegido con clave operativa.

Estado de staging:

- Servicio y nginx ya responden correctamente en staging interno.
- Pendiente DNS publico y certificado HTTPS para
  `staging-api.asitentekairon.cloud`.
- No usar la URL publica de staging hasta verificar que responda por HTTPS
  desde internet.

Las rutas de paginacion y resoluciones ya forman parte del contrato ejecutable
desde `1.1.0`:

- `GET /api/v1/causas/{idJuicio}/actuaciones/paginadas`
- `GET /api/v1/causas/{idJuicio}/resoluciones`

Los datos de ejemplo incluidos aqui estan anonimizados y sirven para pruebas de
integracion. No son evidencia juridica real.
