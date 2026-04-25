// ============================================
// 공유 캐시 헬퍼 — TTL + 버전 관리
// ============================================

import { supabase } from "./supabase.js";

// 캐시 스키마 버전 — WCL 스키마 변경·패치 시 bump해서 전체 무효화
const CACHE_VERSION = process.env.CACHE_VERSION || "1";

function versionedKey(key: string): string {
  return `v${CACHE_VERSION}:${key}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!supabase) return null;
  const vkey = versionedKey(key);
  const { data, error } = await supabase
    .from("wcl_cache")
    .select("value, expires_at")
    .eq("key", vkey)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  // hit_count 비동기 atomic 증가 — RPC로 hit_count = hit_count + 1
  supabase.rpc("increment_wcl_cache_hit", { cache_key: vkey })
    .then(() => {}, () => {});
  return data.value as T;
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  if (!supabase) return;
  const vkey = versionedKey(key);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await supabase.from("wcl_cache").upsert(
    { key: vkey, value, expires_at: expiresAt, created_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

export async function cacheDelete(key: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("wcl_cache").delete().eq("key", versionedKey(key));
}

export async function cacheDeletePattern(pattern: string): Promise<number> {
  if (!supabase) return 0;
  // SQL LIKE 패턴 (예: "rankings:12345:%")
  const vpattern = `v${CACHE_VERSION}:${pattern}`;
  const { count, error } = await supabase
    .from("wcl_cache").delete({ count: "exact" })
    .like("key", vpattern);
  if (error) {
    console.error("[cache] pattern delete 실패:", error);
    return 0;
  }
  return count ?? 0;
}

// TTL 프리셋 (ms)
export const TTL = {
  rankings: 2 * 60 * 60 * 1000,       // 2h
  reportInfo: 24 * 60 * 60 * 1000,    // 24h
  combatantInfo: 7 * 24 * 60 * 60 * 1000, // 7d
  partition: 3 * 24 * 60 * 60 * 1000, // 3d
};
