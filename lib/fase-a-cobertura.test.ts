import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarCausaIndividual } from "./procesar-causa.js";

test("fase A: consume rutas especializadas y distingue cobertura documental desconocida", async () => {
 const anterior=globalThis.fetch;
 const urls:string[]=[];
 globalThis.fetch=(async (url:any)=>{
  const u=String(url); urls.push(u);
  let payload:any={success:true,incidentes:[{nombreJudicatura:"CUENCA",actuaciones:[{tipo:"AUTO",fecha:"2023-11-06",actividad:"Calificación de solicitud"}]}],partialErrors:[]};
  if(u.endsWith("/sentencia/estado")) payload={success:true,analysisStatus:"COMPLETE",partial:false,determination:"NO_SENTENCE_FOUND",summary:{sentenciasDetectadas:0}};
  if(u.endsWith("/medidas-cautelares")) payload={success:true,analysisStatus:"COMPLETE",partial:false,determination:"INSCRIPTION_NOT_CONFIRMED",summary:{medidasDetectadas:1}};
  if(u.endsWith("/abandono/riesgo")) payload={success:false};
  return new Response(JSON.stringify(payload),{status:200});
 }) as typeof fetch;
 try{
  const r=await procesarCausaIndividual("01333-2023-10725","https://satje.test","k");
  assert.ok(urls.some(u=>u.endsWith("/medidas-cautelares")));
  assert.ok(urls.some(u=>u.endsWith("/sentencia/estado")));
  assert.equal(r.evidenciaEspecializada.sentencia.determinacion,"NO_SENTENCE_FOUND");
  assert.equal(r.evidenciaEspecializada.cautelares.resumen.medidasDetectadas,1);
  assert.equal(r.cobertura.documentosInventariados,false);
  assert.equal(r.cobertura.documentosTotales,null);
 } finally {globalThis.fetch=anterior;}
});

test("fase A: fallas en endpoint especializado no equivalen a ausencia de medidas o sentencia", async()=>{
 const anterior=globalThis.fetch;
 globalThis.fetch=(async (url:any)=>{
  if(String(url).endsWith("/sentencia/estado")||String(url).endsWith("/medidas-cautelares")) return new Response("timeout",{status:504});
  return new Response(JSON.stringify({success:true,incidentes:[],partialErrors:[]}),{status:200});
 }) as typeof fetch;
 try{
  const r=await procesarCausaIndividual("01333-2024-12766","https://satje.test","k");
  assert.equal(r.evidenciaEspecializada.sentencia.estado,"NO_DETERMINABLE");
  assert.equal(r.evidenciaEspecializada.cautelares.estado,"NO_DETERMINABLE");
  assert.equal(r.cobertura.documentosInventariados,false);
 }finally{globalThis.fetch=anterior;}
});
