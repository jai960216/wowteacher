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

let current: RateLimitInfo | null = null;
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

export function resetRateLimitForTest(): void {
  current = null;
  listeners.clear();
}
