// ============================================
// Top N 스탯 스캔 — 상위 플레이어들의 능력치 분포
// ============================================

import { getReportInfo, getCombatantInfo, type WCLRanking } from "../wcl/api";
import { NON_COMBAT_SLOTS } from "./index";

export interface StatProfile {
  name: string;
  server: string;
  ilvl: number;
  stats: Record<string, number>;
  specID: number;
}

export interface StatDistribution {
  stat: string;
  label: string;
  avg: number;
  min: number;
  max: number;
  median: number;
  myValue: number;
  diff: number;        // myValue - avg
  diffPercent: number;  // (myValue - avg) / avg * 100
  verdict: "high" | "low" | "ok";
}

export interface TopStatsScanResult {
  scanned: number;
  failed: number;
  profiles: StatProfile[];
  distributions: StatDistribution[];
}

const STAT_LABELS: Record<string, string> = {
  Strength: "힘", Agility: "민첩", Stamina: "체력", Intellect: "지능",
  CriticalStrike: "치명타", Haste: "가속", Mastery: "특화", Versatility: "유연성",
};

/**
 * 상위 N명의 스탯을 스캔해서 분포 분석
 */
export async function scanTopStats(
  rankings: WCLRanking[],
  myStats: Record<string, number>,
  myIlvl: number,
  onProgress?: (done: number, total: number) => void,
): Promise<TopStatsScanResult> {
  const profiles: StatProfile[] = [];
  let failed = 0;

  // 병렬 (5개씩 배치)
  const BATCH = 5;
  for (let i = 0; i < rankings.length; i += BATCH) {
    const batch = rankings.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(r => fetchPlayerStats(r))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        profiles.push(result.value);
      } else {
        failed++;
      }
      onProgress?.(profiles.length + failed, rankings.length);
    }
  }

  // 분포 계산
  const distributions = calculateDistributions(profiles, myStats, myIlvl);

  return { scanned: profiles.length, failed, profiles, distributions };
}

async function fetchPlayerStats(ranking: WCLRanking): Promise<StatProfile | null> {
  try {
    // 1) 리포트 정보로 fight 시간 + player sourceID 가져오기
    const report = await getReportInfo(ranking.reportCode);
    const fight = report.fights.find(f => f.id === ranking.fightID);
    if (!fight) return null;

    const player = report.players.find(p => p.name.toLowerCase() === ranking.name.toLowerCase());
    if (!player) return null;

    // 2) CombatantInfo
    const combatants = await getCombatantInfo(ranking.reportCode, fight.startTime, fight.endTime);
    const info = combatants.find(c => c.sourceID === player.id);
    if (!info) return null;

    // 3) 스탯 추출 + 아이템레벨 (셔츠/Ranged/Tabard 같은 비전투 슬롯은 평균에서 제외)
    const items = info.gear.filter(g => g.itemLevel > 0 && !NON_COMBAT_SLOTS.has(g.slot));
    const ilvl = items.length > 0 ? Math.round(items.reduce((s, g) => s + g.itemLevel, 0) / items.length) : 0;

    return {
      name: ranking.name,
      server: ranking.server,
      ilvl,
      stats: info.stats,
      specID: info.specID,
    };
  } catch {
    return null;
  }
}

function calculateDistributions(
  profiles: StatProfile[],
  myStats: Record<string, number>,
  myIlvl: number,
): StatDistribution[] {
  if (profiles.length === 0) return [];

  const results: StatDistribution[] = [];

  // 아이템레벨
  const ilvls = profiles.map(p => p.ilvl).filter(v => v > 0).sort((a, b) => a - b);
  if (ilvls.length > 0) {
    const avg = ilvls.reduce((s, v) => s + v, 0) / ilvls.length;
    const diff = myIlvl - avg;
    results.push({
      stat: "ItemLevel", label: "아이템레벨",
      avg: Math.round(avg), min: ilvls[0], max: ilvls[ilvls.length - 1],
      median: ilvls[Math.floor(ilvls.length / 2)],
      myValue: myIlvl, diff: Math.round(diff),
      diffPercent: Math.round((diff / avg) * 100),
      verdict: Math.abs(diff) <= 3 ? "ok" : diff > 0 ? "high" : "low",
    });
  }

  // 2차 스탯
  const secondaryStats = ["CriticalStrike", "Haste", "Mastery", "Versatility"];
  for (const stat of secondaryStats) {
    const values = profiles.map(p => p.stats[stat] ?? 0).filter(v => v > 0).sort((a, b) => a - b);
    if (values.length === 0) continue;

    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const myVal = myStats[stat] ?? 0;
    const diff = myVal - avg;
    const pct = avg > 0 ? (diff / avg) * 100 : 0;

    // 15% 이상 차이면 high/low
    const verdict: StatDistribution["verdict"] = Math.abs(pct) <= 15 ? "ok" : pct > 0 ? "high" : "low";

    results.push({
      stat, label: STAT_LABELS[stat] ?? stat,
      avg: Math.round(avg), min: values[0], max: values[values.length - 1],
      median: values[Math.floor(values.length / 2)],
      myValue: myVal, diff: Math.round(diff),
      diffPercent: Math.round(pct),
      verdict,
    });
  }

  return results;
}
