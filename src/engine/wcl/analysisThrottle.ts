// ============================================
// 일반 사용자 분석 횟수 제한 (1시간 슬라이딩 윈도우 20회)
// ============================================
// WCL 토큰은 client_id에 부여돼 모든 사용자가 공유하므로 (한 시간 9000pt 선착순),
// 한 명이 폭주하면 전체 사용자가 막힌다. 분석 시작 시점을 기록하고
// 윈도우 내 시도 횟수가 MAX 이상이면 차단.
//
// 관리자(VITE_ADMIN_WCL_USER_NAME 매칭)는 이 제한을 우회 — 호출자(App.tsx)가 isAdmin
// 분기를 책임진다.

const STORAGE_KEY = "wcl_analysis_history";
export const WINDOW_MS = 60 * 60 * 1000; // 1시간
export const MAX_USES = 20;

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

function readHistory(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  } catch {
    return [];
  }
}

function writeHistory(arr: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch { /* quota/SSR 등 무시 */ }
}

function pruneExpired(arr: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  return arr.filter(t => t > cutoff).sort((a, b) => a - b);
}

export interface ThrottleSnapshot {
  remaining: number;
  nextRecoveryAt: number | null; // 가장 오래된 timestamp + WINDOW_MS. 비어있으면 null.
}

export function getThrottleSnapshot(): ThrottleSnapshot {
  const now = Date.now();
  const arr = pruneExpired(readHistory(), now);
  const remaining = Math.max(0, MAX_USES - arr.length);
  const nextRecoveryAt = arr.length === 0 ? null : arr[0] + WINDOW_MS;
  return { remaining, nextRecoveryAt };
}

export function canAnalyze(): boolean {
  return getThrottleSnapshot().remaining > 0;
}

/** 분석 시도 시점을 기록. 차단 여부는 호출자가 canAnalyze로 미리 확인. */
export function recordAnalysis(): void {
  const now = Date.now();
  const arr = pruneExpired(readHistory(), now);
  arr.push(now);
  writeHistory(arr);
  notify();
}

export function clearAnalysisHistory(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
  notify();
}

export function subscribeAnalysisThrottle(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
