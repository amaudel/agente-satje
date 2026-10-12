# Auditoría de cobertura documental y jurídica SATJE — 12/10/2026

**Alcance:** código en main (solo lectura) y consultas reales de causas 01333-2023-10725 y 01333-2024-12766. Auditoría preliminar basada en módulos y endpoints observables, NO dictamen jurídico ni examen manual exhaustivo de todos los PDF. Producción no modificada.

## Matriz
| Área | Estado | Evidencia / brecha | Prioridad |
|---|---|---|---|
| Consulta de actuaciones | Funcional | 93 y 70 actuaciones por API paginada, sin partialErrors en las páginas iniciales; procesar-causa.ts contempla faltantes y fallback | P1 |
| Identificación de partes/cuantía | Parcial | Chat lee CARATULA DE JUICIO bajo demanda (lib/chat-tools.ts); api/index.ts no presenta cuantía consolidada | P1 |
| Etapa procesal | Parcial | clasificarEtapaProcesal() local, sin reconciliación obligatoria con documento relevante | P1 |
| Citación y deprecatorios | Parcial | Se analiza el último documento deprecado para el reloj; no todas las boletas, constancias y devoluciones | P0 |
| Medidas cautelares | Parcial | detectorCicloVidaMedidaCautelar() local + agrupador no exhaustivo; API especializada /medidas/cautelares disponible | P0 |
| Abandono | Funcional preventivo | /abandono/riesgo integra relojes; efecto de cada actuación requiere valoración jurídica | P0 |
| Sentencia, recursos y ejecutoria | Parcial | detectorSentenciaLegal() local, no integrado /sentencia/estado pese a servicio especializado completo | P0 |
| Extracción documental | Parcial | chat-tools.ts lee adjuntos por demanda; deprecatorios-documentos.ts consulta máximo 2 en una actuación; no inventario total | P0 |
| Resumen IA | Parcial | api/index.ts solo pasa 25 primeras actuaciones y resúmenes locales; requiere selección jurídica y trazabilidad por afirmación | P0 |

## Contraste de API al 12/10/2026
- 01333-2023-10725: 93 actuaciones; abandono COMPLETE/alerta vencida -863 días, proceso principal determinante; medidas COMPLETE/1 medida, ninguna inscripción confirmada; sentencia COMPLETE/NO_SENTENCE_FOUND; resoluciones candidatas: 7 (candidata NO significa sentencia). Hay discrepancia de actor en deprecatorio que exige evaluación documental; una discrepancia no implica nulidad.
- 01333-2024-12766: 70 actuaciones en 7 páginas; actuaciones de Sala Civil y Mercantil de Azuay del 07/10/2026; abandono COMPLETE/vigilancia +158 días; cautelares COMPLETE/1 medida sin inscripción confirmada; sentencia COMPLETE/NO_SENTENCE_FOUND, 1 recurso; resoluciones candidatas 4.
- COMPLETE corresponde al análisis del endpoint, no equivale a revisión exhaustiva de todos los PDF.

## Riesgos y criterios de aceptación
1. **Inventario y cobertura**: reportar total actuaciones/incidentales/documentos, leídos/exitosos/fallidos/no disponibles y fecha de corte. Nunca afirmar «expediente completo» con extracciones parciales.
2. **Fuente autoritativa**: integrar /medidas/cautelares y /sentencia/estado como fuentes estructuradas; conservar detectores locales como contraste/fallback claramente etiquetado.
3. **Citación**: mapear demandado, boleta, lugar, fecha, resultado, razón negativa, reintento y devolución por judicatura; no equiparar deprecatorio devuelto con citación realizada.
4. **Resoluciones**: distinguir auto/providencia, sentencia, notificación, recursos y ejecutoria mediante PDF y fuente.
5. **Abandono**: nunca inferir suspensión/interrupción por simple existencia de oficio. Mostrar inicio, fecha referencial, ámbito, actuación y evaluación jurídica pendiente.
6. **Resumen IA**: cada afirmación esencial debe citar actuación/documento; mostrar evidencia faltante, estados CONFIRMADO / NO CONFIRMADO / NO DETERMINABLE; evitar limitar contexto sin criterio jurídico.
7. **Seguridad**: proteger datos personales, restringir acceso a documentos y no registrar secretos ni datos sensibles en logs.

## Plan de corrección
- Fase A (P0): inventario de evidencia por causa, conciliación de endpoints especializados para sentencia/medidas y estado parcial explícito; pruebas de regresión de los dos procesos.
- Fase B (P0): matriz de citaciones/deprecatorios por demandado e incidente y validación documental con referencias; detección de contradicciones entre fuentes.
- Fase C (P1): identificación de partes, cuantía, tipo de procedimiento y abogados desde carátula (solo si documento disponible), trazabilidad de fuente y fecha.
- Fase D (P1): resumen jurídico estructurado y verificable, con cobertura documental y referencias, sin alucinación por datos ausentes.
- Fase E: pruebas de rendimiento y degradación controlada (timeouts 504), revisiones jurídicas de muestra y validación Preview antes de aprobar producción.

## Evidencia de código
- lib/procesar-causa.ts: detectorSentenciaLegal, detectorCicloVidaMedidaCautelar y riesgoEspecializadoPromise.
- lib/legal-analysis.ts: clasificación, sentencia local, medidas y cálculo preventivo.
- lib/deprecatorios-documentos.ts: consulta de hasta dos adjuntos y verificación de texto.
- lib/chat-tools.ts: lectura de carátula y adjuntos bajo demanda.
- api/index.ts: resumen IA con slice(0, 25) y conteo de grupos de medidas no exhaustivo.

**Control:** esta rama contiene documentación de auditoría, no correcciones; no fusionar ni desplegar a producción como parte de esta auditoría.
