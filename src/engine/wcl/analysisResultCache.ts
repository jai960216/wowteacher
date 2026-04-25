// ============================================
// AnalysisResultCache — 분석 결과 RAM LRU 캐시
// ============================================
// runFullAnalysis() 결과 자체를 메모리에 캐시. 같은 (myFight, refFight, metric, players)
// 조합으로 다시 진입하면 1~16번의 WCL 쿼리 + 분석 재계산을 모두 skip.
//
// - RAM only (FullAnalysis는 깊은 객체 + 무거워서 직렬화 비용이 큼)
// - 모듈 싱글톤 — React StrictMode 더블 렌더에서도 같은 Map 사용
// - 새로고침 시 자동 클리어 (의도)
// - 로그아웃 시 clearAnalysisCache() 호출 (clearAllCaches 경유)

import type { FullAnalysis } from "../analysis/types";

const MAX_ENTRIES = 20;

// LRU 순서: head=oldest, tail=newest
const order: string[] = [];
const store = new Map<string, FullAnalysis>();

export interface AnalysisKeyParams {
  myReportCode: string;
  myFightId: number;
  refReportCode: string;
  refFightId: number;
  myPlayerId: number;
  refPlayerId: number;
  metric: "dps" | "hps";
  cacheVersion: string;
}

/**
 * 분석 결과 캐시 키. 모든 식별자를 포함해 ref/metric/fight 변경 시 자동으로 다른 키 생성.
 * cacheVersion 포함이라 패치 시 환경변수 bump만으로 무효화 가능.
 */
export function makeAnalysisKey(p: AnalysisKeyParams): string {
  return [
    `v${p.cacheVersion}`,
    p.metric,
    `${p.myReportCode}:${p.myFightId}:${p.myPlayerId}`,
    `${p.refReportCode}:${p.refFightId}:${p.refPlayerId}`,
  ].join("|");
}

export function getAnalysis(key: string): FullAnalysis | null {
  const v = store.get(key);
  if (!v) return null;
  // touch — order tail로 이동
  const idx = order.indexOf(key);
  if (idx !== -1) order.splice(idx, 1);
  order.push(key);
  return v;
}

export function setAnalysis(key: string, v: FullAnalysis): void {
  if (store.has(key)) {
    const idx = order.indexOf(key);
    if (idx !== -1) order.splice(idx, 1);
  } else if (store.size >= MAX_ENTRIES) {
    const oldest = order.shift();
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, v);
  order.push(key);
}

export function clearAnalysisCache(): void {
  store.clear();
  order.length = 0;
}

/** 테스트·디버깅 용 */
export function _analysisCacheSize(): number {
  return store.size;
}
