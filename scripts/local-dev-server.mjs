// Servidor local minimo para probar api/index.ts (Vercel function) sin `vercel dev`.
// Uso: tsx scripts/local-dev-server.mjs
import http from "node:http";
import { URL } from "node:url";
import handlerModule from "../api/index.ts";

const handler = handlerModule.default || handlerModule;
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams.entries());

  let bodyChunks = [];
  for await (const chunk of req) bodyChunks.push(chunk);
  const rawBody = Buffer.concat(bodyChunks).toString("utf-8");
  let parsedBody = undefined;
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  const vercelReq = Object.assign(req, {
    query,
    body: parsedBody,
    cookies: Object.fromEntries(
      (req.headers.cookie || "")
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const idx = p.indexOf("=");
          return [p.slice(0, idx), decodeURIComponent(p.slice(idx + 1))];
        })
    ),
  });

  let statusCode = 200;
  const vercelRes = {
    setHeader: (k, v) => {
      res.setHeader(k, v);
      return vercelRes;
    },
    status: (code) => {
      statusCode = code;
      return vercelRes;
    },
    json: (payload) => {
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
    },
    send: (payload) => {
      res.statusCode = statusCode;
      res.end(payload);
    },
    end: () => {
      res.statusCode = statusCode;
      res.end();
    },
  };

  try {
    await handler(vercelReq, vercelRes);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Local dev server for api/index.ts listening on http://127.0.0.1:${PORT}`);
});
