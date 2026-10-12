import {test} from "node:test";
import assert from "node:assert/strict";
import {inventariarAdjuntos} from "./inventario-adjuntos.js";
test("inventario limitado indica cuántos adjuntos quedan sin revisar",async()=>{
 const prev=globalThis.fetch;
 globalThis.fetch=(async()=>new Response(JSON.stringify({success:true,data:[{documentoId:"pdf1"},{documentoId:"pdf2"}]}))) as typeof fetch;
 try {
 const r=await inventariarAdjuntos({causa:"01333202310725",baseUrl:"https://satje.test",headers:{},actuaciones:Array.from({length:12},(_,i)=>({codigoActuacion:i+1,tieneDocumento:true})),limite:8});
 assert.equal(r.estado,"PARCIAL");assert.equal(r.actuacionesPendientes,4);assert.equal(r.documentosEncontrados,16);assert.equal(r.documentosLeidos,0);
 }finally{globalThis.fetch=prev;}
});
test("inventario no inventa PDF cuando SATJE falla",async()=>{
 const prev=globalThis.fetch;
 globalThis.fetch=(async()=>new Response("timeout",{status:504})) as typeof fetch;
 try {
 const r=await inventariarAdjuntos({causa:"01333202412766",baseUrl:"https://satje.test",headers:{},actuaciones:[{codigoActuacion:1,tieneDocumento:true}]});
 assert.equal(r.estado,"PARCIAL");assert.equal(r.errores,1);assert.equal(r.documentosEncontrados,0);
 }finally{globalThis.fetch=prev;}
});

test("paginación incremental no repite los adjuntos revisados",async()=>{
 const previous=globalThis.fetch;const requested:string[]=[];
 globalThis.fetch=(async (url:any)=>{requested.push(String(url));return new Response(JSON.stringify({success:true,data:[{id:"doc"}]}),{status:200});}) as typeof fetch;
 try {
 const acts=Array.from({length:10},(_,i)=>({codigoActuacion:i+1,tieneDocumento:true}));
 const first=await inventariarAdjuntos({causa:"01333202310725",baseUrl:"https://satje.test",headers:{},actuaciones:acts,offset:0,limite:8});
 const second=await inventariarAdjuntos({causa:"01333202310725",baseUrl:"https://satje.test",headers:{},actuaciones:acts,offset:8,limite:8});
 assert.equal(first.actuacionesRevisadas,8);assert.equal(first.actuacionesPendientes,2);
 assert.equal(second.actuacionesRevisadas,2);assert.equal(second.actuacionesPendientes,0);
 assert.equal(requested.length,10);assert.equal(new Set(requested).size,10);
 } finally {globalThis.fetch=previous;}
});
