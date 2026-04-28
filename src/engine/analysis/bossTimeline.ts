// ============================================
// 보스 타임라인 — 보스 캐스트 스냅샷 + 페이즈 마커
// ============================================
//
// 분석 결과의 UI-ready 형태. WCL raw events를 받아 차트가 바로 그릴 수 있는
// 초 단위 좌표 + 메커닉 분류 + 디듀프까지 마친 데이터로 변환.

import type { WCLBossCastEvent, PhaseTransition } from "../wcl/api";
import type { BossCastSnapshot, PhaseMarker } from "./types";

/**
 * 보스 캐스트 raw → 차트용 스냅샷.
 * - bossActorIds: 보스 NPC sourceID 집합 (쫄·소환수·환경 캐스트 제외용 필터)
 * - npcNameMap: sourceID → 표시 이름
 * - abilityMap: id → name 보강 (raw에 abilityName 비어있을 때)
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
      iconUrl: c.abilityIcon ? toIconUrl(c.abilityIcon) : undefined,
      sourceName: npcNameMap.get(c.sourceID) ?? "보스",
      mechClass: classifyMech(name),
    });
  }
  // 시간순 정렬 — 입력이 뒤섞일 가능성 방어 (디듀프가 인접 비교라 정렬 선행 필수)
  out.sort((a, b) => a.timestamp - b.timestamp);
  return dedupeAdjacent(out);
}

/**
 * 메커닉 분류 — 1차는 키워드 화이트리스트만.
 * cast time 정보는 events 응답에 없고 별도 가져오려면 비용 부담 → 휴리스틱 유지.
 * "전체" 옵션이 누락 폴백 역할.
 */
export function classifyMech(spellName: string): "major" | "normal" {
  const lower = spellName.toLowerCase();
  // WCL이 메커닉으로 자주 표기하는 어휘 — false positive 보다 false negative 보수적으로 다룸
  const majorKeywords = [
    "decimat", "annihil", "obliter", "incinerat", "purg", "doom",
    "void", "storm", "phase", "intermission", "rage", "berserk", "enrage",
  ];
  if (majorKeywords.some(k => lower.includes(k))) return "major";
  return "normal";
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

function toIconUrl(icon: string): string {
  if (!icon) return "";
  if (icon.startsWith("http")) return icon;
  return `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
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
