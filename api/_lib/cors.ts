// ============================================
// CORS·Origin 검증
// ============================================

import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED = new Set([
  "https://wowteacher.co.kr",
  "https://wowteacher.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
]);

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers.origin as string | undefined) || "";
  if (ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true; // 끝났음
  }
  return false; // 계속 진행
}
