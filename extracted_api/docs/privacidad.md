# Privacidad y conservacion

La API trabaja con cedulas/RUC, procesos judiciales, actuaciones y documentos HBA. La app comercial debe tratar esos datos como sensibles.

## Reglas minimas

- No exponer API keys en frontend web ni app movil.
- No guardar cedulas/RUC, actuaciones completas ni PDFs HBA mas tiempo del necesario.
- En logs, enmascarar cedulas y RUC. Nunca registrar `X-API-Key`,
  `OPS_API_KEY`, actuaciones completas, PDFs ni textos HBA completos.
- No duplicar PDFs sensibles si basta conservar hash, referencia, `requestId` y resultado resumido.
- Cifrar secretos y restringir acceso interno a historiales de consulta.
- Mostrar o guardar siempre `retrievedAt`, `source`, `mode` y `requestId`.
- Para soporte, preferir conservar evidencia resumida: proceso, documento, pagina, texto soporte breve y hash/referencia.

Los endpoints de resoluciones candidatas deben devolver solo metadatos y
resumen breve. Para revisar contenido documental, usar el flujo
`actuaciones/resoluciones -> documentos -> extract-text` y aplicar las mismas
reglas de minimizacion al resultado extraido.

## documentoId

`documentoId` es una referencia publica de integracion, no una promesa de permanencia indefinida. La app puede usarlo dentro de la vigencia de cache operativa, pero para consultas futuras debe reconstruir el flujo:

```text
actuaciones -> documentos -> extract-text
```

No guardar `documentoId` como unico enlace historico permanente. Guardar tambien `idJuicio`, `codigoActuacion`, `nombreArchivo`, `retrievedAt` y `requestId`.
