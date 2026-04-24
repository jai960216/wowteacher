// ============================================
// /api/admin/purge — 관리자 캐시 퍼지
// ============================================
// POST /api/admin/purge
// Header: X-Admin-Secret: <env ADMIN_SECRET>
// Body: { pattern: "rankings:12345:%" }  또는 { key: "report:abc123" }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheDelete, cacheDeletePattern } from "../_lib/cache";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    res.status(500).json({ error: "ADMIN_SECRET 미설정" });
    return;
  }
  const provided = req.headers["x-admin-secret"];
  if (provided !== adminSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const body = (req.body || {}) as { pattern?: string; key?: string };

  try {
    if (body.key) {
      await cacheDelete(body.key);
      res.status(200).json({ deleted: 1, key: body.key });
      return;
    }
    if (body.pattern) {
      const count = await cacheDeletePattern(body.pattern);
      res.status(200).json({ deleted: count, pattern: body.pattern });
      return;
    }
    res.status(400).json({ error: "key 또는 pattern 필요" });
  } catch (e) {
    console.error("[api/admin/purge]", e);
    res.status(500).json({ error: (e as Error).message || "server error" });
  }
}
