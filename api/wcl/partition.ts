// ============================================
// /api/wcl/partition — encounter의 default partition 공유 캐시
// ============================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { cacheGet, cacheSet, TTL } from "../_lib/cache";
import { wclQuery, WclError } from "../_lib/wclToken";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const encounterId = Number(req.query.encounterId);
  if (!Number.isFinite(encounterId) || encounterId <= 0) {
    res.status(400).json({ error: "encounterId 필수" });
    return;
  }

  const cacheKey = `partition:${encounterId}`;

  try {
    const cached = await cacheGet<{ partition: number }>(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json(cached);
      return;
    }

    const data = await wclQuery<{ worldData?: { encounter?: { zone?: { partitions?: Array<{ id: number; default: boolean; name: string }> } } } }>(`
      query ($id: Int!) {
        worldData {
          encounter(id: $id) {
            zone {
              id
              partitions { id default name }
            }
          }
        }
      }
    `, { id: encounterId });

    const partitions = data.worldData?.encounter?.zone?.partitions ?? [];
    const partition = partitions.find(p => p.default)?.id
      ?? (partitions.length > 0 ? Math.max(...partitions.map(p => p.id)) : 1);

    const response = { partition };
    // partition fallback(1)은 저장 안 함 — 다음 세션에서 재시도
    if (partition !== 1 || partitions.length > 0) {
      await cacheSet(cacheKey, response, TTL.partition);
    }
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(response);
  } catch (e) {
    if (e instanceof WclError && e.status === 429) {
      res.status(429).json({ error: "rate_limit" });
      return;
    }
    console.error("[api/partition]", e);
    res.status(500).json({ error: (e as Error).message || "server error" });
  }
}
