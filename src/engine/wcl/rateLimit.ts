// ============================================
// WarcraftLogs API rate limit 관찰자
// ============================================
// 모든 GraphQL 응답에 rateLimitData 필드를 자동 주입해 매 호출마다
// 최신 값을 수집. 별도 쿼리 없음 → point 추가 소모 0.

export interface RateLimitInfo {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;   // 초 단위
  observedAt: number;      // Date.now()
}

const STORAGE_KEY = "wcl_rate_limit";

// 초기값: localStorage에서 복구 → 새로고침·429 직후에도 마지막 상태 표시 가능
let current: RateLimitInfo | null = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateLimitInfo;
    // observedAt 기준으로 pointsResetIn 보정 — 배지의 "몇 분 후 초기화"는 구독자가 계산
    return parsed;
  } catch { return null; }
})();
const listeners = new Set<() => void>();

export function setRateLimitData(data: {
  limitPerHour?: number;
  pointsSpentThisHour?: number;
  pointsResetIn?: number;
}): void {
  if (data.limitPerHour == null || data.pointsSpentThisHour == null || data.pointsResetIn == null) return;
  if (
    current
    && current.limitPerHour === data.limitPerHour
    && current.pointsSpentThisHour === data.pointsSpentThisHour
    && current.pointsResetIn === data.pointsResetIn
  ) return;
  current = {
    limitPerHour: data.limitPerHour,
    pointsSpentThisHour: data.pointsSpentThisHour,
    pointsResetIn: data.pointsResetIn,
    observedAt: Date.now(),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* quota/SSR 등 무시 */ }
  // 리스너 콜백 내부의 unsubscribe가 Set을 변형해도 안전하도록 스냅샷 순회
  for (const l of [...listeners]) l();
}

export function getRateLimitSnapshot(): RateLimitInfo | null {
  return current;
}

export function subscribeRateLimit(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function clearRateLimit(): void {
  current = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
  for (const l of [...listeners]) l();
}

export function resetRateLimitForTest(): void {
  current = null;
  listeners.clear();
}
