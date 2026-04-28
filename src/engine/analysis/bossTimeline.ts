// ============================================
// 보스 타임라인 — 보스 캐스트 스냅샷 + 페이즈 마커
// ============================================
//
// 분석 결과의 UI-ready 형태. WCL raw events를 받아 차트가 바로 그릴 수 있는
// 초 단위 좌표 + 메커닉 분류 + 디듀프까지 마친 데이터로 변환.

import type { WCLBossCastEvent, PhaseTransition, WCLReportInfo } from "../wcl/api";
import type { BossCastSnapshot, PhaseMarker } from "./types";

/**
 * 보스 NPC actor id 추출.
 * - subType="Boss" 매칭과 fight.name 부분 일치 매칭의 **합집합**.
 * - 한 리포트에 여러 fight가 있을 때 다른 fight의 보스가 subType="Boss"로
 *   표시돼 있으면 현재 fight 보스가 누락될 수 있어, fight name fallback도 항상 함께 적용.
 * - 짧은 이름 노이즈 방지용으로 fightName.length >= 3 가드.
 * - environment NPC ("World" / "Environment" / "Unknown") 거부 (설계 §12.3).
 */
const ENVIRONMENT_NPC_NAMES = new Set(["world", "environment", "unknown"]);

export function pickBossActorIds(
  npcs: WCLReportInfo["npcs"],
  fightName: string,
): Set<number> {
  const out = new Set<number>();
  for (const n of npcs) {
    if (n.subType !== "Boss") continue;
    if (n.name && ENVIRONMENT_NPC_NAMES.has(n.name.toLowerCase())) continue;
    out.add(n.id);
  }
  if (fightName.length >= 3) {
    const fightLower = fightName.toLowerCase();
    for (const n of npcs) {
      if (!n.name) continue;
      const lower = n.name.toLowerCase();
      if (ENVIRONMENT_NPC_NAMES.has(lower)) continue;
      if (lower.includes(fightLower) || fightLower.includes(lower)) out.add(n.id);
    }
  }
  return out;
}

/**
 * 보스 캐스트 raw → 차트용 스냅샷.
 * - bossActorIds: 보스 NPC sourceID 집합 (쫄·소환수·환경 캐스트 제외용 필터)
 * - npcNameMap: sourceID → 표시 이름
 * - abilityMap: id → name 보강 (raw에 abilityName 비어있을 때)
 *
 * 메커닉 분류(`mechClass`)는 2026-04-29 카이메루스 라이브 검증 결과 폐기.
 * 키워드 휴리스틱은 false negative가 너무 많아 실용성이 없음(90 casts 중 0 매칭).
 * UI는 본인/상대 트랙처럼 스킬별 행 그룹으로 표시하며 사용자가 selectedIds로 직접 가린다.
 *
 * 아이콘은 spellMeta(SpellResolver) 단일 경로로 해석. events 응답엔 abilityIcon이 없음.
 */
export function buildBossSnapshots(
  rawCasts: WCLBossCastEvent[],
  fightStart: number,
  bossActorIds: Set<number>,
  npcNameMap: Map<number, string>,
  abilityMap: Record<number, string>,
): BossCastSnapshot[] {
  const out: BossCastSnapshot[] = [];
  for (const c of rawCasts) {
    if (!bossActorIds.has(c.sourceID)) continue;
    const name = c.abilityName || abilityMap[c.abilityGameID] || `#${c.abilityGameID}`;
    out.push({
      timestamp: (c.timestamp - fightStart) / 1000,
      spellId: c.abilityGameID,
      spellName: name,
      sourceName: npcNameMap.get(c.sourceID) ?? "보스",
    });
  }
  // 시간순 정렬 — 입력이 뒤섞일 가능성 방어 (디듀프가 인접 비교라 정렬 선행 필수)
  out.sort((a, b) => a.timestamp - b.timestamp);
  return dedupeAdjacent(out);
}

/**
 * 같은 메커닉 연속 발사(0.3s 내) 디듀프.
 * 보스가 광역 타겟에게 같은 스킬을 같은 시점에 2~5번 fire하는 패턴 흡수.
 */
function dedupeAdjacent(arr: BossCastSnapshot[]): BossCastSnapshot[] {
  const out: BossCastSnapshot[] = [];
  for (const s of arr) {
    const last = out[out.length - 1];
    if (last && last.spellId === s.spellId && Math.abs(s.timestamp - last.timestamp) < 0.3) continue;
    out.push(s);
  }
  return out;
}

/**
 * WCL phaseTransitions raw → UI용 PhaseMarker.
 * 1차 라벨은 "P{id}". encounter별 의미 라벨은 후속.
 */
export function buildPhaseMarkers(
  raw: PhaseTransition[],
  fightStart: number,
): PhaseMarker[] {
  return raw
    .map(p => ({
      timeSec: Math.max(0, (p.startTime - fightStart) / 1000),
      phaseId: p.id,
      label: `P${p.id}`,
    }))
    .sort((a, b) => a.timeSec - b.timeSec);
}
