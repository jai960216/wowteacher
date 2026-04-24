// ============================================
// Supabase 클라이언트 (서버 전용)
// ============================================
// service_role 키는 RLS를 우회. 반드시 서버에서만 사용.
// 클라이언트 번들에는 절대 포함되지 않음 — 파일 경로(/api/*)가 보장.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.warn("[supabase] SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 미설정 — 공유 캐시 비활성");
}

export const supabase = url && serviceKey
  ? createClient(url, serviceKey, { auth: { persistSession: false } })
  : null;

export function supabaseReady(): boolean {
  return supabase !== null;
}
