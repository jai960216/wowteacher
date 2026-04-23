// ============================================
// 캐스트 타임라인 빌더
// ============================================
// 캐스트 + 자원 + 버프 + 영혼파편을 합쳐서 매 캐스트마다 맥락을 붙임

import type { WCLCastEvent, WCLBuffEvent, WCLResourceEvent } from "../wcl/api";
import type { CastSnapshot, TimelineEntry } from "./types";
import { devLog } from "../../debug";

// 피의 욕망 계열 spell IDs
const LUST_IDS = new Set([2825, 32182, 80353, 264667, 390386, 386540]);

import { extractSoulFragmentEvents } from "./filters";

/**
 * 한 플레이어의 캐스트 스냅샷 목록 생성
 * 필터된 캐스트(스킬만) + 원본 캐스트(영혼파편 추적용) 사용
 *
 * @param filteredCasts 패시브 제거된 실제 스킬 캐스트
 * @param allCasts 원본 전체 캐스트 (영혼파편 추적용)
 * @param resources 자원 이벤트
 * @param buffs 버프 이벤트
 * @param fightStart 전투 시작 timestamp (ms)
 * @param resourceMax 주 자원 최대값
 */
export function buildCastSnapshots(
  filteredCasts: WCLCastEvent[],
  resources: WCLResourceEvent[],
  buffs: WCLBuffEvent[],
  fightStart: number,
  resourceMax: number = 120,
  allCasts?: WCLCastEvent[],
  abilityMap?: Record<number, string>,
): CastSnapshot[] {
  const sorted = [...filteredCasts].sort((a, b) => a.timestamp - b.timestamp);

  // 자원 이벤트 시간순 정렬
  const resSorted = [...resources].sort((a, b) => a.timestamp - b.timestamp);

  // 버프 이벤트 시간순 정렬
  const buffEvents = [...buffs].sort((a, b) => a.timestamp - b.timestamp);

  // 영혼파편 이벤트 추출 (원본 캐스트에서, 이름 기반)
  const soulFragEvents = allCasts
    ? extractSoulFragmentEvents(allCasts).sort((a, b) => a.timestamp - b.timestamp)
    : [];

  // 스택형 spell ID 사전 감지 — 스택 이벤트가 있는 ID는 탈태 감지에서 제외
  const stackingSpellIds = new Set<number>();
  for (const b of buffEvents) {
    if (b.type === "applybuffstack" || b.type === "removebuffstack") {
      stackingSpellIds.add(b.abilityGameID);
    }
  }

  // 메타 감지용: "metamorphosis" 포함 + 비스택형 spell ID만
  const metaSpellIds = new Set<number>();
  if (abilityMap) {
    for (const [id, name] of Object.entries(abilityMap)) {
      const numId = Number(id);
      if (name.toLowerCase().includes("metamorphosis") && !stackingSpellIds.has(numId)) {
        metaSpellIds.add(numId);
      }
    }
    // 디버깅
    const stackingMeta = [...stackingSpellIds].filter(id => (abilityMap[id] ?? "").toLowerCase().includes("metamorphosis"));
    devLog("[timeline] 탈태 ID (비스택):", [...metaSpellIds].map(id => `${id}(${abilityMap[id]})`).join(", ") || "없음");
    devLog("[timeline] 제외된 스택형 메타 ID:", stackingMeta.map(id => `${id}(${abilityMap[id]})`).join(", ") || "없음");

    // 비스택 메타 버프 이벤트 카운트
    const metaApply = buffEvents.filter(b => metaSpellIds.has(b.abilityGameID) && b.type === "applybuff").length;
    const metaRemove = buffEvents.filter(b => metaSpellIds.has(b.abilityGameID) && b.type === "removebuff").length;
    devLog("[timeline] 탈태 applybuff:", metaApply, "removebuff:", metaRemove);
  }

  // 상태 추적
  const activeBuffs = new Map<number, boolean>();
  let buffIdx = 0;
  let resIdx = 0;
  let lastResource = 0;
  let lustActive = false;
  let metaActive = false;

  // 영혼파편 상태
  // 영혼파편: 이벤트가 있을 때만 추적 (DH 전용)
  let soulFragments = soulFragEvents.length > 0 ? 25 : 0;
  const SOUL_FRAG_MAX = 50;
  let sfIdx = 0;

  const snapshots: CastSnapshot[] = [];

  for (const cast of sorted) {
    // 이 캐스트 시점까지의 버프 이벤트 처리
    while (buffIdx < buffEvents.length && buffEvents[buffIdx].timestamp <= cast.timestamp) {
      const b = buffEvents[buffIdx];
      const isApply = b.type === "applybuff" || b.type === "refreshbuff";
      const isRemove = b.type === "removebuff";

      // 버프 이름으로 판별 — abilityMap에서 조회
      const buffName = (abilityMap?.[b.abilityGameID] ?? "").toLowerCase();
      // 탈태: 정확히 "metamorphosis"만 (Void Metamorphosis 등 제외)
      // + applybuffstack은 패시브 스택이므로 무시
      // 탈태: 비스택형 metamorphosis spell ID만 (스택형 x50은 영혼구슬)
      const isMeta = metaSpellIds.has(b.abilityGameID);
      const isLust = LUST_IDS.has(b.abilityGameID)
        || buffName.includes("bloodlust") || buffName.includes("heroism")
        || buffName.includes("time warp") || buffName.includes("fury of the aspects");

      if (isApply) {
        activeBuffs.set(b.abilityGameID, true);
        if (isLust) lustActive = true;
        if (isMeta) {
          metaActive = true;
          soulFragments = 30; // 변신 시작 → 30으로 변경
        }
      } else if (isRemove) {
        activeBuffs.delete(b.abilityGameID);
        if (isLust) lustActive = false;
        if (isMeta) {
          metaActive = false;
          soulFragments = 0; // 변신 종료 → 0으로 초기화
        }
      }
      buffIdx++;
    }

    // 이 캐스트 시점까지의 영혼파편 수급 처리
    while (sfIdx < soulFragEvents.length && soulFragEvents[sfIdx].timestamp <= cast.timestamp) {
      soulFragments = Math.min(SOUL_FRAG_MAX, soulFragments + 1);
      sfIdx++;
    }

    // 이 캐스트 시점의 주 자원량 (resourceChange를 누적)
    while (resIdx < resSorted.length && resSorted[resIdx].timestamp <= cast.timestamp) {
      const change = resSorted[resIdx].resourceAmount; // 변동량 (resourceChange)
      const waste = resSorted[resIdx].waste ?? 0;
      const max = resSorted[resIdx].resourceMax;
      if (max > 0) resourceMax = max;
      // 양수 = 생성, 음수 = 소비
      lastResource = Math.max(0, Math.min(resourceMax, lastResource + change - waste));
      resIdx++;
    }

    const timeSec = (cast.timestamp - fightStart) / 1000;

    snapshots.push({
      timestamp: timeSec,
      spellId: cast.abilityGameID,
      spellName: cast.abilityName ?? "",
      resource: lastResource,
      resourceMax,
      soulFragments,
      activeBuffs: [...activeBuffs.keys()],
      isDuringLust: lustActive,
      isDuringMeta: metaActive,
    });
  }

  // 디버깅: 메타 감지 여부
  const metaCasts = snapshots.filter(s => s.isDuringMeta).length;
  const lustCasts = snapshots.filter(s => s.isDuringLust).length;
  devLog(`[timeline] snapshots: ${snapshots.length} | 메타중: ${metaCasts} | 피욕중: ${lustCasts} | 자원범위: ${Math.min(...snapshots.map(s => s.resource))}~${Math.max(...snapshots.map(s => s.resource))}`);

  return snapshots;
}

/**
 * 두 플레이어의 스냅샷을 시간축으로 정렬/병합
 * 같은 시간대의 캐스트를 나란히 볼 수 있게
 */
export function mergeTimelines(
  mySnapshots: CastSnapshot[],
  refSnapshots: CastSnapshot[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  let mi = 0;
  let ri = 0;

  while (mi < mySnapshots.length || ri < refSnapshots.length) {
    const myTime = mi < mySnapshots.length ? mySnapshots[mi].timestamp : Infinity;
    const refTime = ri < refSnapshots.length ? refSnapshots[ri].timestamp : Infinity;

    // 0.3초 이내면 같은 GCD로 취급
    if (Math.abs(myTime - refTime) < 0.3) {
      entries.push({
        timeSec: myTime,
        my: mySnapshots[mi],
        ref: refSnapshots[ri],
      });
      mi++;
      ri++;
    } else if (myTime < refTime) {
      entries.push({ timeSec: myTime, my: mySnapshots[mi], ref: null });
      mi++;
    } else {
      entries.push({ timeSec: refTime, my: null, ref: refSnapshots[ri] });
      ri++;
    }
  }

  return entries;
}

/**
 * 캐스트 데이터에서 쿨다운 스킬을 동적으로 감지
 * "15초 이상 간격으로 사용된 스킬" = 쿨다운 스킬
 */
export function detectCooldowns(
  mySnapshots: CastSnapshot[],
  refSnapshots: CastSnapshot[],
): Array<{ spellId: number; myTimings: number[]; refTimings: number[]; estimatedCD: number }> {
  const mySpellTimings = groupBySpell(mySnapshots);
  const refSpellTimings = groupBySpell(refSnapshots);

  const allSpellIds = new Set([...mySpellTimings.keys(), ...refSpellTimings.keys()]);
  const cooldowns: Array<{ spellId: number; myTimings: number[]; refTimings: number[]; estimatedCD: number }> = [];

  for (const spellId of allSpellIds) {
    const myTimings = mySpellTimings.get(spellId) ?? [];
    const refTimings = refSpellTimings.get(spellId) ?? [];

    // 이 스킬의 평균 사용 간격 계산
    const allTimings = [...myTimings, ...refTimings].sort((a, b) => a - b);
    if (allTimings.length < 2) continue;

    const gaps: number[] = [];
    // 각 플레이어 내에서 간격 측정
    for (const timings of [myTimings, refTimings]) {
      for (let i = 1; i < timings.length; i++) {
        gaps.push(timings[i] - timings[i - 1]);
      }
    }

    if (gaps.length === 0) continue;

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;

    // 15초 이상 간격 = 쿨다운 스킬로 판단
    if (avgGap >= 15) {
      cooldowns.push({
        spellId,
        myTimings,
        refTimings,
        estimatedCD: Math.round(avgGap),
      });
    }
  }

  // 추정 쿨타임이 긴 순으로 정렬 (대형 쿨기 먼저)
  cooldowns.sort((a, b) => b.estimatedCD - a.estimatedCD);

  return cooldowns;
}

function groupBySpell(snapshots: CastSnapshot[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const s of snapshots) {
    const arr = map.get(s.spellId);
    if (arr) arr.push(s.timestamp);
    else map.set(s.spellId, [s.timestamp]);
  }
  return map;
}
