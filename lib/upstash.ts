// MOTOR DE INTEGRACIÓN CON UPSTASH VECTOR DB (SERVERLESS RAG & CACHÉ SEMÁNTICO)

export interface UpstashVectorRecord {
  id?: string;
  data?: string;
  vector?: number[];
  metadata?: Record<string, any>;
}

export async function upsertUpstashVector(url: string, token: string, record: UpstashVectorRecord): Promise<boolean> {
  if (!url || !token) return false;
  try {
    const cleanUrl = url.replace(/\/$/, "");
    const res = await fetch(`${cleanUrl}/upsert`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: record.id,
        ...(record.vector ? { vector: record.vector } : {}),
        ...(record.data ? { data: record.data } : {}),
        metadata: record.metadata || {},
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function queryUpstashVector(url: string, token: string, record: UpstashVectorRecord, topK: number = 3): Promise<any[]> {
  if (!url || !token) return [];
  try {
    const cleanUrl = url.replace(/\/$/, "");
    const payload: any = { topK, includeMetadata: true };
    if (record.vector) payload.vector = record.vector;
    else if (record.data) payload.data = record.data;
    else return [];

    const res = await fetch(`${cleanUrl}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data: any = await res.json();
      return data.result || [];
    }
  } catch (e) {}
  return [];
}
