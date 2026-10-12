import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarDocumentosDeprecatorio } from "./deprecatorios-documentos.js";
const base={baseUrl:"https://satje.test",causa:"01333202310725",codigo:"231976491",cabeceras:{"X-API-Key":"demo"},actorOrigen:"COOPERATIVA DE AHORRO Y CREDITO ERCO LTDA",textoActuacion:"oficio"};
async function mock(fn:(url:string)=>Response) {
 const prev=globalThis.fetch;
 globalThis.fetch=(async (url:any)=>fn(String(url))) as typeof fetch;
 try{return await verificarDocumentosDeprecatorio(base);}
 finally{globalThis.fetch=prev;}
}
test("el PDF prueba discrepancia con identificador de causa",async()=>{
 const x=await mock(url=>url.endsWith("/documentos")
 ? new Response(JSON.stringify({data:[{documentoId:"doc1"}]}))
 : new Response(JSON.stringify({text:"Juicio No. 01333-2023-10725 COOPERATIVA DE AHORRO Y CREDITO ONCE DE JUNIO LTDA"})));
 assert.equal(x.estado,"DISCREPANCIA_DOCUMENTAL");
 assert.equal(x.documentosConsultados,1);
});
test("error upstream no se transforma en coincidencia",async()=>{
 const x=await mock(url=>url.endsWith("/documentos")
 ? new Response(JSON.stringify({data:[{documentoId:"doc1"}]}))
 : new Response("timeout",{status:504}));
 assert.equal(x.estado,"DOCUMENTO_INACCESIBLE");
 assert.equal(x.documentosFallidos,1);
});
test("sin PDF no se emite conclusión jurídica",async()=>{
 const x=await mock(()=>new Response(JSON.stringify({data:[]})));
 assert.equal(x.estado,"EVIDENCIA_INSUFICIENTE");
});
