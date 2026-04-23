// ============================================
// 캐스트 이벤트 필터 — 패시브/자원 이벤트 제외
// ============================================
// WCL Casts 데이터에는 실제 버튼 입력이 아닌
// 패시브 발동, 자원 수급, 자동 공격 등이 섞여 있음.
// spell ID는 확장팩마다 바뀌므로 **이름 기반**으로 필터링.

import type { WCLCastEvent } from "../wcl/api";
import { devLog } from "../../debug";

/** 패시브/자원/자동 이벤트로 판별할 이름 패턴 (소문자) */
const PASSIVE_NAME_PATTERNS = [
  "soul fragment",         // 영혼파편 수급
  "lesser soul fragment",  // 하위 영혼파편
  "shattered soul",        // 산산조각난 영혼
  "auto attack",           // 자동 공격
  "auto shot",             // 자동 사격
  "melee",                 // 근접 자동
  "attack",                // Attack (일부 자동공격 변형)
];

/** 정확히 일치하는 이름 (소문자) */
const PASSIVE_EXACT_NAMES = new Set([
  "melee",
  "attack",
  "auto attack",
  "soul fragment",
]);

/**
 * 실제 버튼 입력 캐스트만 필터링
 * - ability 이름에 패시브 패턴 포함되면 제거
 */
export function filterPassiveCasts(casts: WCLCastEvent[]): WCLCastEvent[] {
  // begincast만 있고 cast가 없는 스킬 ID 탐지
  const hasCastEvent = new Set<number>();
  const hasBeginCastEvent = new Set<number>();
  for (const c of casts) {
    if (c.type === "cast") hasCastEvent.add(c.abilityGameID);
    if (c.type === "begincast") hasBeginCastEvent.add(c.abilityGameID);
  }
  // begincast만 있는 스킬 → begincast를 유지해야 함
  const begincastOnly = new Set<number>();
  for (const id of hasBeginCastEvent) {
    if (!hasCastEvent.has(id)) begincastOnly.add(id);
  }
  if (begincastOnly.size > 0) {
    devLog("[filter] begincast만 있는 스킬:", [...begincastOnly].join(", "));
  }

  const filtered = casts.filter(c => {
    // begincast 제거 — 단, cast 이벤트가 없는 스킬은 유지
    if (c.type === "begincast" && !begincastOnly.has(c.abilityGameID)) return false;

    const name = (c.abilityName ?? "").toLowerCase().trim();
    if (!name) return true;

    if (PASSIVE_EXACT_NAMES.has(name)) return false;

    for (const pattern of PASSIVE_NAME_PATTERNS) {
      if (name.includes(pattern)) return false;
    }

    return true;
  });

  // 디버깅
  const removed = casts.length - filtered.length;
  if (removed > 0) {
    // 제거된 것들의 이름 목록
    const removedNames = new Map<string, number>();
    for (const c of casts) {
      const name = (c.abilityName ?? "").toLowerCase().trim();
      if (name && (PASSIVE_EXACT_NAMES.has(name) || PASSIVE_NAME_PATTERNS.some(p => name.includes(p)))) {
        removedNames.set(c.abilityName, (removedNames.get(c.abilityName) ?? 0) + 1);
      }
    }
    devLog(`[filter] 제거됨 ${removed}건:`, [...removedNames.entries()].map(([n, c]) => `${n}(${c})`).join(", "));
  }

  // 다단히트 중복 제거: 같은 abilityName이 0.5초 이내에 반복되면 첫 번째만 유지
  const deduped: WCLCastEvent[] = [];
  const lastCastTime = new Map<string, number>(); // abilityName → last timestamp

  for (const c of filtered) {
    const name = c.abilityName || String(c.abilityGameID);
    const lastTime = lastCastTime.get(name) ?? -Infinity;
    const gap = (c.timestamp - lastTime) / 1000; // 초

    if (gap < 0.5) continue; // 0.5초 이내 = 같은 스킬의 다단히트

    deduped.push(c);
    lastCastTime.set(name, c.timestamp);
  }

  if (deduped.length < filtered.length) {
    devLog(`[filter] 다단히트 중복 제거: ${filtered.length} → ${deduped.length} (${filtered.length - deduped.length}건 제거)`);
  }

  return deduped;
}

/**
 * 영혼파편 관련 캐스트만 추출 (2차 자원 추적용)
 */
export function extractSoulFragmentEvents(casts: WCLCastEvent[]): WCLCastEvent[] {
  return casts.filter(c => {
    const name = (c.abilityName ?? "").toLowerCase();
    return name.includes("soul fragment") || name.includes("shattered soul");
  });
}

