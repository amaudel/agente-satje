/** Bandera preventiva: nunca declara inválido un deprecatorio automáticamente. */
export function verificarIdentidadDeprecatorio(actuaciones: any[], textoDeprecado: string): {estado:"COINCIDE"|"DISCREPANCIA"|"INDETERMINADO"; evidencia:string} {
  const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  const dep=norm(textoDeprecado || "");
  if(!dep) return {estado:"INDETERMINADO",evidencia:"Sin texto del deprecatorio para comparar"};
  const extraer=(v:string)=>v.match(/COOPERATIVA DE AHORRO Y CREDITO\s+([A-Z0-9 ]{2,50}?)\s+LTDA\b/)?.[1]?.trim() || null;
  const principal=actuaciones.filter(a=>/CUENCA/.test(norm(String(a.nombreJudicatura||"")))).map(a=>norm(String(a.actividad||""))).join(" ");
  const identPrincipal=extraer(principal);
  const identDep=extraer(dep);
  if(!identPrincipal || !identDep) return {estado:"INDETERMINADO",evidencia:"No consta identificación suficiente de ambas partes actoras"};
  if(identPrincipal!==identDep) return {estado:"DISCREPANCIA",evidencia:"El oficio deprecado identifica una parte actora diferente de la causa principal; verificar documento y asociación en SATJE"};
  return {estado:"COINCIDE",evidencia:"Coincide la identificación de la parte actora; no acredita por sí solo identidad procesal completa"};
}
