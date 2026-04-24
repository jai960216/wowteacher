// ============================================
// /api/wcl/report — 리포트 기본 정보 공유 캐시
// ============================================

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";
import { cacheGet, cacheSet, TTL } from "../_lib/cache.js";
import { wclQuery, WclError, extractUserToken } from "../_lib/wclToken.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const code = String(req.query.code || "");
  if (!code) { res.status(400).json({ error: "code 필수" }); return; }

  const cacheKey = `report:${code}`;

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

    const data = await wclQuery(`
      query ($code: String!) {
        reportData {
          report(code: $code) {
            code
            title
            startTime
            endTime
            fights {
              id
              name
              startTime
              endTime
              kill
              difficulty
              encounterID
              friendlyPlayers
            }
            masterData {
              actors(type: "Player") {
                id
                name
                type
                subType
                server
              }
              abilities {
                gameID
                name
                icon
              }
            }
            region { slug }
            zone { id name }
          }
        }
      }
    `, { code }, userToken);

    await cacheSet(cacheKey, data, TTL.reportInfo);
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
    console.error("[api/report]", e);
    res.status(500).json({ error: (e as Error).message || "server error" });
  }
}
