# Versionado y compatibilidad

El contrato usa versionado semántico para la documentación entregada a integradores.

- **PATCH:** correcciones de texto, ejemplos o descripciones que no cambian solicitudes ni respuestas.
- **MINOR:** nuevos campos opcionales, nuevos endpoints o mejoras compatibles.
- **MAJOR:** eliminación o cambio de campos, rutas, autenticación o comportamiento que pueda romper una integración.

## Reglas para mantener compatibilidad

1. No eliminar ni renombrar campos existentes dentro de una versión mayor.
2. Los campos nuevos deben ser opcionales salvo que se publique una versión mayor.
3. No cambiar el significado de códigos HTTP o códigos funcionales existentes.
4. No cambiar la respuesta completa de actuaciones a paginada por defecto dentro de la versión actual.
5. Las mejoras de paginación o búsqueda especializada deben agregarse como parámetros opcionales compatibles o como endpoints nuevos.
6. Publicar un changelog y una fecha de retiro antes de descontinuar una operación.

El número `info.version` del OpenAPI identifica la versión documental del contrato. La ruta `/api/v1` identifica la versión mayor de la API.
