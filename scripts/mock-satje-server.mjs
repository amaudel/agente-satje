// Servidor mock minimo que sirve el fixture real de actuaciones para probar
// el Worker de Cloudflare localmente sin depender de la red hacia SATJE real.
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "../extracted_api/examples/actuaciones-response.example.json"), "utf-8")
);

const PORT = process.env.MOCK_PORT || 9099;

const server = http.createServer((req, res) => {
  if (req.url.includes("/actuaciones")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(fixture));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Mock SATJE server listening on http://127.0.0.1:${PORT}`);
});
