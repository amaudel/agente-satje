# Checklist para iniciar el desarrollo de la app

## Entrega del proveedor de la API

- [ ] URL de producción confirmada.
- [ ] URL de staging publicada y verificada por HTTPS desde internet.
- [x] Servicio y proxy de staging verificados internamente.
- [ ] API key exclusiva de staging entregada por un canal seguro.
- [ ] API key de producción entregada únicamente al responsable autorizado.
- [ ] Plan, límites, costos y permisos asociados a cada clave documentados.
- [ ] Contacto y procedimiento de soporte definidos.

## Configuración de la app

- [ ] La API key se guarda solo en variables del servidor.
- [ ] El navegador nunca llama directamente a Ecuador Judicial API.
- [ ] Cédulas y RUC se enmascaran en logs y telemetría.
- [ ] Se preservan `source`, `mode`, `retrievedAt` y `requestId`.
- [ ] Se aplican timeouts y reintentos limitados.
- [ ] Se respetan respuestas `429` y encabezados de espera cuando existan.
- [ ] No existe fallback silencioso de `live` a `fixture`.

## Pruebas mínimas

- [ ] El OpenAPI se valida correctamente.
- [ ] Los ejemplos JSON coinciden con los esquemas documentados.
- [ ] La colección Postman funciona en staging.
- [ ] Se prueban respuestas 200, 401, 403, 404, 422, 429, 502 y 504.
- [ ] Las pruebas automatizadas usan fixture o staging, no producción repetitiva.
- [ ] Se prueba un proceso con muchas actuaciones para controlar tamaño y memoria.

## Producto y seguridad

- [ ] Autenticación de usuarios y sesiones seguras.
- [ ] Separación por organizaciones y roles.
- [ ] Registro de auditoría de consultas sensibles.
- [ ] Política de conservación de datos implementada.
- [ ] Créditos y facturación separados de la API key.
- [ ] Alertas de abandono presentadas únicamente como preventivas.
