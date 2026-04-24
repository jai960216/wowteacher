// ============================================
// /api/wcl/rankings — characterRankings 공유 캐시
// ============================================
// Query params: encounterId, className, specName, difficulty, page, bracket, partition, metric

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { cacheGet, cacheSet, TTL } from "../_lib/cache";
import { wclQuery, WclError } from "../_lib/wclToken";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const q = req.query;
  const encounterId = Number(q.encounterId);
  const className = String(q.className || "");
  const specName = String(q.specName || "");
  const difficulty = Number(q.difficulty || 0);
  const page = Number(q.page || 1);
  const bracket = Number(q.bracket || 0);
  const partition = Number(q.partition || 0);
  const metric = String(q.metric || "dps");

  if (!Number.isFinite(encounterId) || encounterId <= 0) {
    res.status(400).json({ error: "encounterId 필수" });
    return;
  }

  const cacheKey = `rankings:${encounterId}:${className}:${specName}:${difficulty}:${page}:${bracket}:${partition}:${metric}`;

  try {
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json(cached);
      return;
    }

    const vars: Record<string, unknown> = { id: encounterId, page, partition, metric };
    if (className) vars.class = className;
    if (specName) vars.spec = specName;
    if (difficulty > 0) vars.difficulty = difficulty;
    if (bracket > 0) vars.bracket = bracket;

    const data = await wclQuery<{ worldData?: { encounter?: { characterRankings?: unknown } } }>(`
      query ($id: Int!, $class: String, $spec: String, $difficulty: Int, $page: Int, $bracket: Int, $partition: Int, $metric: CharacterRankingMetricType) {
        worldData {
          encounter(id: $id) {
            name
            characterRankings(
              className: $class
              specName: $spec
              difficulty: $difficulty
              bracket: $bracket
              page: $page
              partition: $partition
              metric: $metric
            )
          }
        }
      }
    `, vars);

    await cacheSet(cacheKey, data, TTL.rankings);
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(data);
  } catch (e) {
    if (e instanceof WclError && e.status === 429) {
      res.status(429).json({ error: "rate_limit" });
      return;
    }
    console.error("[api/rankings]", e);
    res.status(500).json({ error: (e as Error).message || "server error" });
  }
}
