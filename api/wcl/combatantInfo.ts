// ============================================
// /api/wcl/combatantInfo — 참여자 장비/특성/스탯 공유 캐시
// ============================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { cacheGet, cacheSet, TTL } from "../_lib/cache.js";
import { wclQuery, WclError, extractUserToken } from "../_lib/wclToken.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const code = String(req.query.code || "");
  const startTime = Number(req.query.startTime);
  const endTime = Number(req.query.endTime);

  if (!code || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    res.status(400).json({ error: "code, startTime, endTime 필수" });
    return;
  }

  const cacheKey = `combatantInfo:${code}:${startTime}:${endTime}`;

  try {
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json(cached);
      return;
    }

    const userToken = extractUserToken(req.headers.authorization);
    if (!userToken) {
      res.status(401).json({ error: "missing user token" });
      return;
    }

    // 클라이언트 fetchCombatantInfo와 동일한 events 쿼리 — 캐시 HIT 시 동일 transformer 재사용
    const data = await wclQuery(`
      query ($code: String!, $startTime: Float!, $endTime: Float!) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              dataType: CombatantInfo
              limit: 50
            ) {
              data
            }
          }
        }
      }
    `, { code, startTime, endTime }, userToken);

    await cacheSet(cacheKey, data, TTL.combatantInfo);
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(data);
  } catch (e) {
    if (e instanceof WclError && (e.status === 403 || e.status === 404)) {
      res.status(e.status).json({ error: "report_unavailable" });
      return;
    }
    if (e instanceof WclError && e.status === 429) {
      res.status(429).json({ error: "rate_limit" });
      return;
    }
    console.error("[api/combatantInfo]", e);
    res.status(500).json({ error: (e as Error).message || "server error" });
  }
}
