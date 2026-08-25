# Limites y costos

## Limites operativos iniciales

- Rate limit: 30 solicitudes/minuto por origen en el gateway. Si se agrega gateway comercial, usar tambien 30 solicitudes/minuto por API key para el plan base.
- PDF maximo para extraccion HBA: 25 MB (`PDF_TEXT_MAX_BYTES=26214400`).
- OCR maximo: 30 paginas (`PDF_TEXT_OCR_MAX_PAGES=30`).
- Timeout de extraccion documental: 120 segundos por solicitud.
- Paginacion SATJE: `SATJE_PAGE_SIZE=10`, `SATJE_MAX_PAGES=10`.
- Cache de busquedas, actuaciones y documentos: 5 minutos (`CACHE_TTL_SECONDS=300`).
- Actuaciones paginadas: `pageSize` predeterminado 20 y maximo 50.
- Resoluciones candidatas: `limit` predeterminado 20 y maximo 50.
- Alerta de abandono: `alertaDias=30` por defecto; `critico` cuando faltan 15 dias o menos; `vencido` cuando la fecha referencial ya paso.

Estos valores pueden cambiar por configuracion, pero son el contrato operativo inicial para la app.

Los endpoints paginados reutilizan la consulta/cache de actuaciones del
backend mientras el TTL este vigente. No deben disparar una consulta nueva a
SATJE por cada pagina si ya existe una respuesta cacheada valida.

## Creditos comerciales

No mezclar API keys con creditos:

- API key: autentica a la aplicacion cliente.
- Creditos: controlan consumo, plan, saldo y facturacion.

La app comercial debe manejar:

- usuarios
- organizaciones/clientes
- planes
- saldo
- transacciones
- costo por operacion
- historial de consumo

Ejemplo de ledger:

```json
{
  "usuarioId": "usr_123",
  "clienteId": "cli_456",
  "operacion": "ANALISIS_DOCUMENTAL_HBA",
  "requestId": "req_xxx",
  "creditosConsumidos": 3,
  "saldoAnterior": 50,
  "saldoRestante": 47,
  "estado": "confirmado",
  "createdAt": "2026-07-14T15:30:00Z"
}
```

Operaciones comerciales sugeridas:

- `BUSQUEDA_CAUSAS`
- `CONSULTA_ACTUACIONES`
- `PDF_CONSOLIDADO`
- `EXTRACCION_TEXTO_HBA`
- `ANALISIS_DOCUMENTAL_HBA`
- `RIESGO_ABANDONO`
