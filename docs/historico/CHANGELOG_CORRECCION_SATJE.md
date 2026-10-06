> **Documento histórico (18-ago-2026).** Se conserva como registro de lo que se auditó y corrigió en esa fecha. **No describe el estado actual del código**: las líneas de `api/index.ts` que cita ya no existen (el archivo se dividió en `lib/`), y varias afirmaciones de "corregido" no coinciden con el repositorio actual. Para el estado vigente ver `docs/ARQUITECTURA_AGENTE_SATJE.md`, sección "Limitaciones conocidas".

---

# CHANGELOG: CORRECCIÓN Y ENDURECIMIENTO DEL AGENTE SATJE

## [8.0.0] - 2026-08-18

### 🚨 Eliminado (Lógica Prohibida & Alucinaciones)
* **Eliminado RAG Cross-Case Factual Date Inheritance:** Se removió la lógica que rellenaba `fechaInscripcionMedida` mediante `queryUpstashVector` en causas ajenas cuando la causa actual no tenía fecha de inscripción confirmada.
* **Eliminados Casos Hardcodeados Reales:** Se removió la regla estricta que forzaba la fecha `2025-10-20` y repertorio `23696` para la causa `275839641`. Los casos de prueba se movieron a `tests/fixtures/casos_prueba.json`.
* **Eliminada Autenticación Ficticia en Cliente:** Se eliminó la validación por `sessionStorage`/`localStorage` que permitía al navegador autodeclararse autenticado.

### 🛡️ Seguridad & Autenticación Server-Side
* **Autenticación Server-Side:** Implementación de cookies firmadas `satje_session` (`HttpOnly; Secure; SameSite=Strict`) para la validación server-side de sesiones.
* **Protección de Endpoints Sensibles:** Verificación de autorización en el servidor para `?action=chat`, consultas individuales y consultas en lote.
* **Protección de Secretos:** Eliminación de fallbacks hardcodeados en código fuente para `OPENAI_API_KEY`, `SATJE_API_KEY` y `UPSTASH_VECTOR_REST_TOKEN`.
* **Rate Limiting:** Control de tasa de solicitudes por IP para evitar abusos automatizados en el endpoint de Chat IA.
* **Límite de Concurrencia en Lote:** Control de tamaño de lote (máx 30 causas) y procesamiento por fragmentos con concurrencia máxima de 4 solicitudes en paralelo.

### ⚖️ Modelo Estricto de Evidencia Jurídica
* **Medidas Cautelares:** Separación estricta de las 5 fechas procesales (`fechaOrdenJudicial`, `fechaOficio`, `fechaInscripcion`, `fechaActuacionSatje`, `fechaLevantamiento`) y estados explícitos (`NO_DETECTADA`, `ORDENADA`, `OFICIADA`, `INSCRIPCION_POSIBLE`, `INSCRIPCION_CONFIRMADA`, `LEVANTAMIENTO_ORDENADO`, `LEVANTADA`, `NO_DETERMINADO`).
* **Sentencias:** Incorporación de estados explícitos de sentencia (`SENTENCIA_NO_DETECTADA`, `SENTENCIA_CANDIDATA`, `SENTENCIA_DOCUMENTO_LOCALIZADO`, `SENTENCIA_VERIFICADA`).
* **Abandono Procesal (Art. 247 COGEP):** Cumplimiento estricto de la improcedencia del abandono procesal en fase de EJECUCIÓN (Etapa 10) o cuando existe sentencia emitida.
* **Directiva Anti-Alucinación en Chat IA:** Incorporación de reglas explícitas en el prompt de sistema de OpenAI para impedir la invención de hechos, números o fechas no presentes en la evidencia.

### 🧪 Pruebas & Documentación
* **Prueba Obligatoria de Aislamiento RAG:** Creado `tests/test_rag_isolation.mjs` para garantizar que la Causa A sin fecha nunca reciba la fecha de la Causa B.
* **Documentos Generados:** `AUDITORIA_AGENTE_SATJE.md`, `ARQUITECTURA_AGENTE_SATJE.md`, `CHANGELOG_CORRECCION_SATJE.md`, `.env.example`.
