# Errores

## Codigos HTTP

- `200`: operacion completada.
- `400`: solicitud mal formada.
- `401`: API key ausente o invalida.
- `403`: credencial valida pero sin permiso para el recurso, por ejemplo metricas operativas sin `OPS_API_KEY`.
- `404`: proceso, actuacion o documento no encontrado.
- `422`: JSON valido pero incompatible con el contrato, PDF ilegible/protegido o `documentoId` invalido.
- `429`: limite de solicitudes excedido.
- `502`: SATJE o el proveedor judicial interno respondio con estructura, contenido o PDF invalido.
- `504`: timeout consultando SATJE o el proveedor judicial interno.

## Contrato de error

```json
{
  "success": false,
  "error": {
    "code": "SATJE_TIMEOUT",
    "message": "SATJE no respondio a tiempo.",
    "source": "SATJE",
    "retryable": true,
    "stage": "actuacionesJudiciales"
  },
  "requestId": "req_xxx"
}
```

## Codigos funcionales

- `VALIDATION_ERROR`
- `SATJE_TIMEOUT`
- `SATJE_BLOCKED`
- `SATJE_CAPTCHA_REQUIRED`
- `SATJE_INVALID_RESPONSE`
- `SATJE_CONNECTION_ERROR`
- `SATJE_DNS_ERROR`
- `SATJE_TLS_ERROR`
- `INCIDENT_NOT_FOUND`
- `DOCUMENT_NOT_FOUND`
- `PDF_GENERATION_ERROR`
- `PDF_TEXT_EXTRACTION_ERROR`

No existe fallback silencioso a fixture en produccion. Si `mode=live` falla, la app debe recibir error explicito.
