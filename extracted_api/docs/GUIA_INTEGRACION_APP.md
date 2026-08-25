# Guia de integracion para app comercial

## Entrega privada

El desarrollador no debe implementar la app basandose solo en el README o en una conversacion. Esta carpeta es el paquete minimo de contrato:

- `openapi.json`: contrato OpenAPI exportado desde FastAPI.
- `Ecuador_Judicial_API.postman_collection.json`: coleccion Postman lista para importar.
- `entorno-staging.template.postman_environment.json`: plantilla de entorno Postman de staging.
- `ejemplos-respuestas/`: respuestas completas o representativas por endpoint.
- `../examples/`: ejemplos contractuales con nombres simples para la app.
- `errores.md`: codigos HTTP y codigos funcionales.
- `limites-y-costos.md`: limites tecnicos y separacion de creditos comerciales.
- `privacidad.md`: reglas de conservacion de datos sensibles.
- `CHANGELOG.md`: cambios del contrato de integracion.
- `VERSIONADO_Y_COMPATIBILIDAD.md`: reglas para evolucionar la API sin romper clientes.
- `CHECKLIST_INICIO_DESARROLLO.md`: controles previos al inicio del proyecto.
- `MEJORAS_BACKEND_PROPUESTAS.md`: nota de diseño de mejoras incorporadas en `1.1.0`.

`openapi.json` es el contrato recomendado para generar tipos o clientes. La
exportacion `openapi-original-fastapi.json` se conserva solo como referencia de
la entrega anterior.

## URLs

Produccion:

```text
https://api.asitentekairon.cloud
```

Staging:

```text
https://staging-api.asitentekairon.cloud
```

Estado actual: staging publico esta operativo por HTTPS en
`https://staging-api.asitentekairon.cloud`. Usar staging para validar cambios
antes de pedir aprobacion de despliegue a produccion.

Staging debe usar otra API key. Para pruebas repetibles debe operar normalmente
con `SATJE_MODE=fixture`; si se activa modo live, cada respuesta debe indicar
`mode=live`.

No ejecutar pruebas automatizadas repetitivas contra produccion. Coordinar una
clave y ventana de prueba antes de ejecutar pruebas de integracion en vivo.

## Autenticacion

Todos los endpoints de consumo usan:

```http
X-API-Key: <API_KEY_COMERCIAL>
```

La app web o movil no debe guardar esta clave. El flujo correcto es:

```text
frontend/app movil -> backend comercial propio -> Ecuador Judicial API
```

Variables recomendadas en el backend comercial:

```env
ECUADOR_JUDICIAL_API_URL=https://api.asitentekairon.cloud
ECUADOR_JUDICIAL_API_KEY=REEMPLAZAR_API_KEY_PRIVADA
```

Para staging, usar otros valores:

```env
ECUADOR_JUDICIAL_API_URL=REEMPLAZAR_URL_STAGING_VERIFICADA
ECUADOR_JUDICIAL_API_KEY=REEMPLAZAR_STAGING_API_KEY
```

Las metricas operativas usan otra credencial:

```http
X-API-Key: <OPS_API_KEY>
```

`OPS_API_KEY` no se entrega a clientes comerciales.
Si el backend comercial necesita monitoreo interno, usar una variable separada
como `ECUADOR_JUDICIAL_OPS_API_KEY`, solo para personal `ops_admin`.

Los endpoints comerciales, incluyendo actuaciones paginadas y resoluciones,
requieren la misma `API_KEY_COMERCIAL` que
`GET /api/v1/causas/{idJuicio}/actuaciones`. Una `OPS_API_KEY` no habilita
consumo comercial salvo que tambien haya sido autorizada explicitamente dentro
de `API_KEYS`, lo cual no es la configuracion recomendada.

## Health checks

```http
GET /health
```

Publico, sin API key. Devuelve solo informacion minima de disponibilidad.

```http
GET /health/satje
```

Protegido con `ECUADOR_JUDICIAL_OPS_API_KEY`. Puede revelar estado operativo,
modo de consulta o degradacion de infraestructura, por lo que no forma parte del
consumo normal de la app comercial.

## Ejemplos contractuales

La carpeta `examples/` contiene ejemplos simples para implementacion de UI,
backend comercial y pruebas automatizadas:

- `buscar-causas.json`
- `actuaciones.json`
- `documentos-hba.json`
- `extract-text.json`
- `detector-confirmado.json`
- `detector-parcial.json`
- `abandono-riesgo.json`

Los ejemplos de `docs/ejemplos-respuestas/` pueden ser mas extensos o generados
desde la API. Los de `examples/` son el formato minimo estable que debe entender
la app. Los ejemplos incluidos en el paquete externo deben tratarse como
anonimizados; no son prueba juridica ni autorizan afirmar un resultado real.

## Endpoints que consume la app

Los endpoints listados en esta seccion son los que la app debe tratar como
disponibles en el contrato `1.1.0`.

Buscar causas por cedula/RUC:

```http
POST /api/v1/causas/buscar
```

Consultar actuaciones por numero de proceso:

```http
GET /api/v1/causas/{idJuicio}/actuaciones
```

Este endpoint puede llamarse directamente si el usuario ya tiene el numero de proceso.

Consultar actuaciones paginadas:

```http
GET /api/v1/causas/{idJuicio}/actuaciones/paginadas?page=1&pageSize=20&orden=desc
```

Usar este endpoint cuando el expediente tenga muchas actuaciones o el cliente
necesite cargar la informacion por partes. El endpoint completo se conserva por
compatibilidad.

La paginacion es deterministica: ordena por fecha/hora de actuacion y, cuando
hay empate, por `codigoActuacion`. `pageSize` tiene maximo 50.

Consultar resoluciones candidatas:

```http
GET /api/v1/causas/{idJuicio}/resoluciones?limit=20
```

La respuesta clasifica candidatas por metadatos trazables (`tipo`, `actividad`
y documentos adjuntos). La app no debe afirmar el contenido de una sentencia
sin revisar el documento correspondiente.

La respuesta no incluye PDF, texto completo del HBA, `raw` ni actuaciones
completas. Si una candidata tiene documento, continuar el flujo:

```text
resoluciones -> documentos -> extract-text
```

Listar documentos HBA de una actuacion:

```http
GET /api/v1/causas/{idJuicio}/actuaciones/{codigoActuacion}/documentos
```

Calcular riesgo de abandono:

```http
GET /api/v1/causas/{idJuicio}/abandono/riesgo?fechaCorte=2026-07-14
```

La app debe usar este endpoint para generar alertas preventivas. La respuesta
separa:

- `relojProcesoPrincipal`: ultima actuacion del expediente principal.
- `relojUnidadDeprecada`: ultima actuacion de la unidad deprecada, cuando exista.
- `alertaGeneral`: reloj mas cercano a la fecha referencial de abandono.

Regla de producto recomendada:

- Mostrar alerta si cualquiera de los dos relojes esta en `alerta`, `critico` o `vencido`.
- Mostrar ambos relojes cuando exista unidad deprecada, aunque uno tenga mas dias restantes.
- No ocultar el reloj del proceso principal por una actuacion anterior de la deprecada, ni ocultar la deprecada por una actuacion posterior del principal.
- Tratar el resultado como riesgo operativo, no como declaratoria juridica automatica.

Parametros:

- `fechaCorte`: fecha ISO opcional para calcular dias restantes. Si no se envia, la API usa la fecha actual.
- `alertaDias`: por defecto `30`. Define desde cuantos dias antes la app marca `estadoAlerta=alerta`.

Plazo legal:

- El plazo legal de abandono no es configurable por el usuario final.
- La API usa internamente `plazoLegalMeses=6`, versionado por contrato.
- Referencia: COGEP arts. 245 y 246. El art. 245 establece el plazo legal aplicable para el abandono y el art. 246 regula el computo desde el dia siguiente de la ultima notificacion o actuacion procesal. Esta referencia se usa como alerta preventiva conforme a criterios publicados por la Funcion Judicial.
- Es una alerta preventiva y no una declaratoria juridica de abandono.

Extraer texto de documento HBA:

```http
POST /api/v1/documentos/hba/extract-text
```

Generar PDF consolidado:

```http
POST /api/v1/causas/{idJuicio}/pdf
```

## Regla documental clave

La app no debe declarar una inscripcion como `confirmado` si no tiene:

- `documentoId`
- `nombreArchivo`
- `pagina`
- `textoSoporte`
- `metodoExtraccion`
- `retrievedAt`

Si solo encuentra providencia, oficio o solicitud al Registro de la Propiedad, el estado correcto es `parcial`, no `confirmado`.

## Infraestructura interna

Los conectores y servicios internos de Ecuador Judicial API no forman parte del
contrato de integracion. La app comercial solo debe consumir
`https://api.asitentekairon.cloud` o la URL de staging privada cuando sea
entregada y verificada.
