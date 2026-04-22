// ============================================
// 타임라인 비교 엔진
// ============================================
// 내 캐스트 타임라인 vs 상위권 캐스트 타임라인 비교
// WarcraftLogs API에서 가져온 데이터 기반

import type { WCLCastEvent } from "./wcl/api";

export interface CompareEntry {
  /** 전투 시작 기준 시간 (초) */
  time: number;
  /** 내 스킬 ID (null = 이 시점에 안 씀) */
  mySpellId: number | null;
  /** 상대 스킬 ID (null = 이 시점에 안 씀) */
  refSpellId: number | null;
  /** 판정 */
  verdict: "MATCH" | "DIFF" | "MISSING" | "EXTRA";
}

export interface CompareResult {
  entries: CompareEntry[];
  matchRate: number;  // 0-100
  totalMy: number;
  totalRef: number;
  /** 내가 안 쓴 스킬들 (상대는 씀) */
  missingSpells: Map<number, number>; // spellId → 횟수
  /** 내가 더 쓴 스킬들 (상대는 안 씀) */
  extraSpells: Map<number, number>;
}

/**
 * 두 캐스트 타임라인을 시간 기반으로 비교
 *
 * @param myCasts 내 캐스트 이벤트
 * @param refCasts 비교 대상 캐스트 이벤트
 * @param fightStartTime 전투 시작 타임스탬프 (ms)
 * @param tolerance GCD 매칭 허용 오차 (초, 기본 1.0)
 */
export function compareTimelines(
  myCasts: WCLCastEvent[],
  refCasts: WCLCastEvent[],
  myFightStart: number,
  refFightStart: number,
  tolerance = 1.0,
): CompareResult {
  // 상대 시간(초)으로 변환
  const myTimeline = myCasts.map((c) => ({
    time: (c.timestamp - myFightStart) / 1000,
    spellId: c.abilityGameID,
  }));

  const refTimeline = refCasts.map((c) => ({
    time: (c.timestamp - refFightStart) / 1000,
    spellId: c.abilityGameID,
  }));

  const entries: CompareEntry[] = [];
  const usedRef = new Set<number>(); // 이미 매칭된 ref 인덱스
  const missingSpells = new Map<number, number>();
  const extraSpells = new Map<number, number>();

  let matches = 0;

  // 내 각 캐스트에 대해 가장 가까운 ref 캐스트 매칭
  for (const my of myTimeline) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let j = 0; j < refTimeline.length; j++) {
      if (usedRef.has(j)) continue;
      const dist = Math.abs(my.time - refTimeline[j].time);
      if (dist < bestDist && dist <= tolerance) {
        bestDist = dist;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0) {
      const ref = refTimeline[bestIdx];
      usedRef.add(bestIdx);

      if (my.spellId === ref.spellId) {
        entries.push({ time: my.time, mySpellId: my.spellId, refSpellId: ref.spellId, verdict: "MATCH" });
        matches++;
      } else {
        entries.push({ time: my.time, mySpellId: my.spellId, refSpellId: ref.spellId, verdict: "DIFF" });
      }
    } else {
      // ref에 매칭되는 시점 없음 → 내가 추가로 쓴 것
      entries.push({ time: my.time, mySpellId: my.spellId, refSpellId: null, verdict: "EXTRA" });
      extraSpells.set(my.spellId, (extraSpells.get(my.spellId) ?? 0) + 1);
    }
  }

  // ref에서 매칭 안 된 것들 → 내가 빠뜨린 것
  for (let j = 0; j < refTimeline.length; j++) {
    if (usedRef.has(j)) continue;
    const ref = refTimeline[j];
    entries.push({ time: ref.time, mySpellId: null, refSpellId: ref.spellId, verdict: "MISSING" });
    missingSpells.set(ref.spellId, (missingSpells.get(ref.spellId) ?? 0) + 1);
  }

  // 시간순 정렬
  entries.sort((a, b) => a.time - b.time);

  const total = Math.max(myTimeline.length, refTimeline.length);
  const matchRate = total > 0 ? Math.round((matches / total) * 100) : 100;

  return {
    entries,
    matchRate,
    totalMy: myTimeline.length,
    totalRef: refTimeline.length,
    missingSpells,
    extraSpells,
  };
}
