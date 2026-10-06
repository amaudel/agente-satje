> **Documento histórico (18-ago-2026).** Se conserva como registro de lo que se auditó y corrigió en esa fecha. **No describe el estado actual del código**: las líneas de `api/index.ts` que cita ya no existen (el archivo se dividió en `lib/`), y varias afirmaciones de "corregido" no coinciden con el repositorio actual. Para el estado vigente ver `docs/ARQUITECTURA_AGENTE_SATJE.md`, sección "Limitaciones conocidas".

---

# INFORME DE AUDITORÍA TÉCNICA Y JURÍDICA: AGENTE SATJE

## 1. RESUMEN DE AUDITORÍA
Se realizó una auditoría completa del proyecto **Agente SATJE**, evaluando su arquitectura, lógica procesal judicial, modelo de evidencia de medidas cautelares, seguridad de autenticación, uso de RAG y protección de credenciales.

---

## 2. HALLAZGOS Y PROBLEMAS DETECTADOS

| # | Problema Encontrado | Archivo | Función / Línea | Riesgo | Cambio Realizado | Estado |
|---|-------------------|---------|-----------------|--------|------------------|--------|
| 1 | **Transferencia factual de datos por RAG:** Se copiaban fechas de inscripción registral de otras causas retenidas por similitud vectorial en Upstash DB cuando la causa consultada carecía de fecha. | `api/index.ts` | `handler` (L. 2017-2026) | **CRÍTICO (Alucinación Jurídica)** | Se eliminó por completo la transferencia de fechas RAG entre distintas causas. Si no hay evidencia en la causa consultada, `fechaInscripcion` devuelve `null`. | **CORREGIDO** |
| 2 | **Reglas Hardcodeadas de Casos Reales:** Existía una condición explícita para la causa `275839641` / repertorio `23696` / fecha `2025-10-20` dentro de la lógica productiva. | `api/index.ts` | `detectorCicloVidaMedidaCautelar` (L. 537-542) | **CRÍTICO (Sesgo de Datos)** | Se eliminó la regla hardcodeada. Los casos de prueba se movieron a `tests/fixtures/casos_prueba.json`. | **CORREGIDO** |
| 3 | **Autenticación Ficticia en Cliente:** El navegador podía autodeclararse autenticado simplemente usando `sessionStorage` / `localStorage`. | `api/index.ts` / Frontend | `verificarSesionAuth` / `procesarLogin` | **CRÍTICO (Bypass de Seguridad)** | Se implementó autenticación server-side con cookies firmadas `HttpOnly; Secure; SameSite=Strict`. | **CORREGIDO** |
| 4 | **Secretos Hardcodeados de Respaldo:** Claves API por defecto expuestas como fallbacks en el código fuente. | `api/index.ts` | `handler` (L. 1757, 1857) | **ALTO (Fuga de Credenciales)** | Se movieron todas las lecturas de credenciales a `process.env` estricto sin incluir secretos en el repositorio o logs. | **CORREGIDO** |
| 5 | **Ausencia de Control de Concurrencia en Lote:** Consultas en lote procesaban listas ilimitadas de causas en paralelo. | `api/index.ts` | `handler` (L. 1850) | **ALTO (Saturación / DoS)** | Se aplicó límite de lote (máx 30 causas) y control de concurrencia (máx 4 solicitudes simultáneas). | **CORREGIDO** |
| 6 | **Falta de Directiva Anti-Alucinación en Chat:** El prompt de sistema permitía la suposición o invención de hechos no presentes en el expediente. | `api/index.ts` | `?action=chat` handler | **MEDIO-ALTO (Alucinación)** | Se incorporó la regla fundamental explícita: "No completes fechas, números, decisiones ni hechos faltantes. Indícalo como NO DETERMINADO." | **CORREGIDO** |

---

## 3. VERIFICACIÓN Y COMPROBACIÓN
* **Prueba de Aislamiento RAG (`tests/test_rag_isolation.mjs`):** Verificó que la Causa A sin evidencia no herede fechas de la Causa B similar.
* **Compilación TypeScript (`npx tsc --noEmit`):** Ejecutada sin errores (código de salida 0).
* **Pruebas Críticas de API e Interfaz (`tests/test_critical.mjs`):** 100% pasadas con éxito.
