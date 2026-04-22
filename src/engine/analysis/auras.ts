// ============================================
// 오라(버프/디버프) 가동시간 + 스택 추적
// ============================================

import type { WCLBuffEvent } from "../wcl/api";

/** 단일 오라의 활성 구간 */
export interface AuraWindow {
  start: number;
  end: number;
  stacks: number;  // 이 구간의 스택 수 (비스택 버프는 1)
}

/** 오라 정보 */
export interface AuraInfo {
  spellId: number;
  name: string;
  windows: AuraWindow[];
  totalUptime: number;
  uptimePercent: number;
  isStacking: boolean;
  maxStacks: number;
}

export function buildAuraTimeline(
  buffs: WCLBuffEvent[],
  fightStart: number,
  fightEnd: number,
  abilityMap: Record<number, string>,
): AuraInfo[] {
  const fightDuration = (fightEnd - fightStart) / 1000;
  const sorted = [...buffs].sort((a, b) => a.timestamp - b.timestamp);

  const bySpell = new Map<number, WCLBuffEvent[]>();
  for (const b of sorted) {
    const arr = bySpell.get(b.abilityGameID);
    if (arr) arr.push(b); else bySpell.set(b.abilityGameID, [b]);
  }

  const auras: AuraInfo[] = [];

  for (const [spellId, events] of bySpell) {
    const name = abilityMap[spellId] ?? `#${spellId}`;
    const windows: AuraWindow[] = [];
    let isStacking = false;
    let maxStacks = 0;
    let currentStart: number | null = null;
    let currentStacks = 1;

    for (const e of events) {
      const timeSec = (e.timestamp - fightStart) / 1000;

      switch (e.type) {
        case "applybuff":
        case "refreshbuff":
          // 이전 구간 닫고 새로 시작
          if (currentStart !== null && currentStart < timeSec) {
            windows.push({ start: currentStart, end: timeSec, stacks: currentStacks });
          }
          currentStart = timeSec;
          currentStacks = e.stacks ?? 1;
          break;

        case "applybuffstack":
          isStacking = true;
          // 스택 변경 → 이전 구간 닫고 새 스택으로 시작
          if (currentStart !== null && currentStart < timeSec) {
            windows.push({ start: currentStart, end: timeSec, stacks: currentStacks });
          }
          currentStacks = e.stacks ?? (currentStacks + 1);
          if (currentStacks > maxStacks) maxStacks = currentStacks;
          currentStart = timeSec;
          break;

        case "removebuffstack":
          isStacking = true;
          if (currentStart !== null && currentStart < timeSec) {
            windows.push({ start: currentStart, end: timeSec, stacks: currentStacks });
          }
          currentStacks = e.stacks ?? Math.max(0, currentStacks - 1);
          currentStart = timeSec;
          break;

        case "removebuff":
          if (currentStart !== null && currentStart < timeSec) {
            windows.push({ start: currentStart, end: timeSec, stacks: currentStacks });
          }
          currentStart = null;
          currentStacks = 0;
          break;
      }
    }

    // 전투 끝까지 활성
    if (currentStart !== null && currentStart < fightDuration) {
      windows.push({ start: currentStart, end: fightDuration, stacks: currentStacks });
    }

    if (windows.length === 0) continue;

    // 인접한 같은 스택 구간 병합
    const merged: AuraWindow[] = [];
    for (const w of windows) {
      const last = merged[merged.length - 1];
      if (last && last.stacks === w.stacks && Math.abs(last.end - w.start) < 0.1) {
        last.end = w.end;
      } else {
        merged.push({ ...w });
      }
    }

    const totalUptime = merged.reduce((s, w) => s + (w.end - w.start), 0);
    const uptimePercent = fightDuration > 0 ? (totalUptime / fightDuration) * 100 : 0;

    if (!isStacking) maxStacks = 1;

    auras.push({
      spellId, name,
      windows: merged,
      totalUptime,
      uptimePercent: Math.round(uptimePercent * 10) / 10,
      isStacking, maxStacks,
    });
  }

  auras.sort((a, b) => b.totalUptime - a.totalUptime);
  return auras;
}
