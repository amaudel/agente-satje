export type EstadoEvidencia = "COINCIDENCIA_DOCUMENTAL" | "DISCREPANCIA_DOCUMENTAL" | "DOCUMENTO_INACCESIBLE" | "EVIDENCIA_INSUFICIENTE";
export interface EvidenciaDeprecatorio { estado: EstadoEvidencia; causaEnDocumento: boolean; partesDiscordantes: boolean; documentosConsultados: number; documentosFallidos: number; referencia: string; }
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const actor = (v: string) => norm(v).match(/COOPERATIVA DE AHORRO Y CREDITO\s+([A-Z0-9 ]{2,50}?)\s+LTDA\b/)?.[1]?.trim() || null;
async function jsonLimitado(url:string, options:RequestInit, ms:number):Promise<any> {
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(ms)});
  if(!res.ok) throw new Error("HTTP "+res.status);
  return res.json();
}
/** Verifica el documento original; nunca declara validez o nulidad procesal. */
export async function verificarDocumentosDeprecatorio(args:{
  baseUrl:string; causa:string; codigo:string; cabeceras:Record<string,string>; actorOrigen:string; textoActuacion:string;
  maxMs?:number;
}):Promise<EvidenciaDeprecatorio> {
  const {baseUrl,causa,codigo,cabeceras,textoActuacion}=args;
  const referencia=`SATJE actuación ${codigo}`;
  let documentosConsultados=0, documentosFallidos=0, causaEnDocumento=false, partesDiscordantes=false, actorCoincidente=false;
  let documentos:any[]=[];
  try {
    const r=await jsonLimitado(`${baseUrl}/api/v1/causas/${encodeURIComponent(causa)}/actuaciones/${encodeURIComponent(codigo)}/documentos`,{headers:cabeceras},Math.min(args.maxMs||5000,5000));
    documentos=Array.isArray(r?.data)?r.data.slice(0,2):[];
  }catch{
    return {estado:"DOCUMENTO_INACCESIBLE",causaEnDocumento,partesDiscordantes,documentosConsultados,documentosFallidos:1,referencia};
  }
  if(!documentos.length) return {estado:"EVIDENCIA_INSUFICIENTE",causaEnDocumento,partesDiscordantes,documentosConsultados,documentosFallidos,referencia};
  const textoOriginal=norm(args.actorOrigen);
  const esperado=actor(textoOriginal);
  for(const doc of documentos) {
    if(!doc?.documentoId){documentosFallidos++;continue;}
    try {
      const d=await jsonLimitado(`${baseUrl}/api/v1/documentos/hba/extract-text`,{
        method:"POST",headers:cabeceras,body:JSON.stringify({documentoId:doc.documentoId})
      },Math.min(args.maxMs||5000,5000));
      const contenido=norm(String(d?.text||""));
      if(!contenido.trim()){documentosFallidos++;continue;}
      documentosConsultados++;
      const numero=causa.replace(/[^0-9A-Z]/gi,"");
      causaEnDocumento ||= contenido.replace(/[^0-9A-Z]/g,"").includes(numero);
      const encontrado=actor(contenido);
      if(esperado && encontrado && esperado!==encontrado) partesDiscordantes=true;
      if(esperado && encontrado && esperado===encontrado) actorCoincidente=true;
    }catch {documentosFallidos++;}
  }
  const estado:EstadoEvidencia=partesDiscordantes && causaEnDocumento
    ? "DISCREPANCIA_DOCUMENTAL"
    : documentosFallidos ? "DOCUMENTO_INACCESIBLE"
    : causaEnDocumento && actorCoincidente && !partesDiscordantes ? "COINCIDENCIA_DOCUMENTAL"
    : "EVIDENCIA_INSUFICIENTE";
  return {estado,causaEnDocumento,partesDiscordantes,documentosConsultados,documentosFallidos,referencia};
}
