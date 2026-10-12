// Tipos estructurales del contrato HTTP de Vercel; solo importaciones de tipo.
// Evita instalar @vercel/node en el bundle cuando únicamente se usan tipos.
import type { IncomingMessage, ServerResponse } from "node:http";

export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
  body: any;
}

export interface VercelResponse extends ServerResponse {
  status(code: number): this;
  json(value: unknown): this;
  send(value: unknown): this;
}
