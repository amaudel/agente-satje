export interface InventarioAdjuntos {
 estado: "COMPLETO"|"PARCIAL"|"SIN_ACTUACIONES";
 actuacionesConDocumento: number; actuacionesRevisadas: number; actuacionesPendientes: number;
 documentosEncontrados: number; documentosLeidos: number; errores: number;
 referencias: {codigo:string;cantidad:number;error?:string}[];
}
/** Inventario acotado: no afirma exhaustividad cuando resta una sola actuación sin revisar. */
export async function inventariarAdjuntos(args: {
 causa:string;baseUrl:string;headers:Record<string,string>;actuaciones:any[];
 limite?:number;concurrencia?:number;timeoutMs?:number;offset?:number;
}):Promise<InventarioAdjuntos>{
 const candidatos=args.actuaciones.filter(a=>a?.tieneDocumento===true && (a?.codigoActuacion||a?.codigo));
 const limite=Math.max(0,Math.min(args.limite??8,20));
 const offset=Math.max(0,Math.min(Math.floor(args.offset??0),candidatos.length));
 const seleccion=candidatos.slice(offset,offset+limite);
 const referencias:InventarioAdjuntos["referencias"]=[];
 let cursor=0,errores=0,documentosEncontrados=0;
 const worker=async()=>{
  while(cursor<seleccion.length){
   const a=seleccion[cursor++];
   const codigo=String(a.codigoActuacion||a.codigo);
   try{
    const res=await fetch(`${args.baseUrl}/api/v1/causas/${encodeURIComponent(args.causa)}/actuaciones/${encodeURIComponent(codigo)}/documentos`,{headers:args.headers,signal:AbortSignal.timeout(args.timeoutMs??3000)});
    if(!res.ok)throw new Error("HTTP "+res.status);
    const data:any=await res.json();
    if(data?.partialErrors?.length || data?.success===false)throw new Error("respuesta parcial");
    const docs=Array.isArray(data?.data)?data.data:[];
    documentosEncontrados+=docs.length;
    referencias.push({codigo,cantidad:docs.length});
   }catch(e:any){errores++;referencias.push({codigo,cantidad:0,error:String(e?.message||e).slice(0,90)});}
  }
 };
 await Promise.all(Array.from({length:Math.min(Math.max(1,args.concurrencia??3),seleccion.length)},worker));
 const pendientes=candidatos.length-offset-seleccion.length;
 return {estado:candidatos.length===0?"SIN_ACTUACIONES":errores===0&&pendientes===0&&offset===0?"COMPLETO":"PARCIAL",
  actuacionesConDocumento:candidatos.length,actuacionesRevisadas:seleccion.length,actuacionesPendientes:pendientes,
  documentosEncontrados,documentosLeidos:0,errores,referencias};
}
