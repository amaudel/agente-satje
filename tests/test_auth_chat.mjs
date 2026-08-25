import assert from "assert";

console.log("🧪 INICIANDO TEST DE AUTENTICACIÓN Y CHAT DE IA...");

const baseUrl = "https://agente-satje.vercel.app";

// 1. Probar Endpoint de Chat IA
try {
  const res = await fetch(`${baseUrl}/?action=chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "chat",
      prompt: "Explícame en un párrafo qué es el abandono procesal del Art. 245 del COGEP y cuál es el plazo.",
      causaContext: { causa: "01333-2023-10725", etapa: "10. EJECUCION" }
    })
  });

  const data = await res.json();
  console.log("Respuesta Chat API OK:", data.ok);
  assert.strictEqual(data.ok, true, "El chat de IA debe retornar ok: true");
  assert.ok(data.respuesta.length > 30, "La respuesta del chat debe contener texto del modelo");
  console.log("  ✅ Respuesta de Chat IA generada correctamente:", data.respuesta.slice(0, 150) + "...");

} catch (err) {
  console.error("❌ Error en test de chat:", err);
  process.exit(1);
}

console.log("🎉 PRUEBA DE CHAT DE IA PASADA EXITOSAMENTE!");
