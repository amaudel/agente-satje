const res = await fetch("https://agente-satje.vercel.app/?causas=01333-2025-08870,01333-2023-10725");
const html = await res.text();

console.log("HTML Length:", html.length);
console.log("Contains batchTable:", html.includes("batchTable"));
console.log("tab-lote active display:", html.includes('id="tab-lote" class="tab-content" style="display: block;"'));
console.log("tabBtnLote active:", html.includes('id="tabBtnLote" class="tab-btn active"'));
