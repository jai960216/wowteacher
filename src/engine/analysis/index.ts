// ============================================
// 통합 분석 진입점
// ============================================

import {
  getCasts, getBuffs, getResources, getDamageDone, getDamageTable, getHealingDone, getHealingTable, getCombatantInfo,
  type WCLReportInfo, type WCLFight,
} from "../wcl/api";
import { analyzeUptime, compareUptime } from "./uptime";
import { buildCastSnapshots, mergeTimelines, detectCooldowns } from "./timeline";
import { analyzePatterns } from "./patterns";
import { filterPassiveCasts } from "./filters";
import { buildAuraTimeline } from "./auras";
import { detectHeroTalent } from "../specs/heroTalents";
import type {
  FullAnalysis, GearComparison, DamageAnalysis, HealingAnalysis, DamageBreakdownEntry,
  ResourceAnalysis, CooldownUsage, WCLDamageEvent, WCLHealEvent, WCLCombatantInfo, GearItem,
  HealingTableEntry,
} from "./types";

export interface AnalysisInput {
  myReport: WCLReportInfo;
  myFight: WCLFight;
  myPlayerId: number;
  myClassID: number;
  mySpec: string;
  myHeroSpec: string;
  myName: string;
  refReportCode: string;
  refReport: WCLReportInfo;
  refFight: WCLFight;
  refPlayerId: number;
  refName: string;
  refHeroSpec: string;
  /** 힐러 모드 여부. true면 getHealingDone/Table 추가 수집 + healing/healingBreakdown 채움 */
  isHealer: boolean;
}

export async function runFullAnalysis(input: AnalysisInput): Promise<FullAnalysis> {
  // 1) 데이터 수집 (병렬 — 10개 API 호출)
  const [
    myCasts, refCasts,
    myBuffs, refBuffs,
    myResources, refResources,
    myDmgEvents, refDmgEvents,
    myDmgTable, refDmgTable,
    myCombatantInfos, refCombatantInfos,
  ] = await Promise.all([
    getCasts(input.myReport.code, input.myFight.id, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
    getCasts(input.refReportCode, input.refFight.id, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
    getBuffs(input.myReport.code, input.myFight.id, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
    getBuffs(input.refReportCode, input.refFight.id, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
    getResources(input.myReport.code, input.myFight.id, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
    getResources(input.refReportCode, input.refFight.id, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
    getDamageDone(input.myReport.code, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
    getDamageDone(input.refReportCode, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
    getDamageTable(input.myReport.code, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
    getDamageTable(input.refReportCode, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
    getCombatantInfo(input.myReport.code, input.myFight.startTime, input.myFight.endTime),
    getCombatantInfo(input.refReportCode, input.refFight.startTime, input.refFight.endTime),
  ]);

  // 1-b) 힐러 모드: 힐량 데이터 추가 수집 (4개 쿼리)
  let myHealEvents: WCLHealEvent[] = [];
  let refHealEvents: WCLHealEvent[] = [];
  let myHealTable: HealingTableEntry[] = [];
  let refHealTable: HealingTableEntry[] = [];
  if (input.isHealer) {
    [myHealEvents, refHealEvents, myHealTable, refHealTable] = await Promise.all([
      getHealingDone(input.myReport.code, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
      getHealingDone(input.refReportCode, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
      getHealingTable(input.myReport.code, input.myPlayerId, input.myFight.startTime, input.myFight.endTime),
      getHealingTable(input.refReportCode, input.refPlayerId, input.refFight.startTime, input.refFight.endTime),
    ]);
    console.log(`[analysis] 힐량 이벤트: 나 ${myHealEvents.length}, 상대 ${refHealEvents.length}, 테이블: 나 ${myHealTable.length}종 상대 ${refHealTable.length}종`);
  }

  const myDuration = (input.myFight.endTime - input.myFight.startTime) / 1000;
  const refDuration = (input.refFight.endTime - input.refFight.startTime) / 1000;

  // 1.5) abilityMap으로 캐스트 이벤트에 이름 붙이기
  const myAbilityMap = input.myReport.abilityMap ?? {};
  const refAbilityMap = input.refReport.abilityMap ?? {};
  for (const c of myCasts) { if (!c.abilityName) c.abilityName = myAbilityMap[c.abilityGameID] ?? ""; }
  for (const c of refCasts) { if (!c.abilityName) c.abilityName = refAbilityMap[c.abilityGameID] ?? ""; }

  // 패시브/자원 이벤트 필터링 (영혼파편, 자동공격 등 제외)
  const myFilteredCasts = filterPassiveCasts(myCasts);
  const refFilteredCasts = filterPassiveCasts(refCasts);
  console.log(`[analysis] 캐스트 필터: 나 ${myCasts.length}→${myFilteredCasts.length}, 상대 ${refCasts.length}→${refFilteredCasts.length}`);

  // 2) 장비/스탯 비교
  console.log(`[analysis] CombatantInfo: my=${myCombatantInfos.length}명, ref=${refCombatantInfos.length}명`);
  console.log(`[analysis] myPlayerId=${input.myPlayerId}, available sourceIDs:`, myCombatantInfos.map(c => c.sourceID));
  console.log(`[analysis] refPlayerId=${input.refPlayerId}, available sourceIDs:`, refCombatantInfos.map(c => c.sourceID));
  console.log(`[analysis] myCasts=${myCasts.length}, myDmgEvents=${myDmgEvents.length}, myDmgTable=${myDmgTable.length}`);
  const myInfo = myCombatantInfos.find(c => c.sourceID === input.myPlayerId);
  const refInfo = refCombatantInfos.find(c => c.sourceID === input.refPlayerId);
  console.log(`[analysis] myInfo found=${!!myInfo}, refInfo found=${!!refInfo}`);
  if (myInfo) console.log(`[analysis] myStats:`, myInfo.stats, `gear items:`, myInfo.gear.length);
  if (!myInfo && myCombatantInfos.length > 0) console.warn(`[analysis] ⚠️ myPlayerId ${input.myPlayerId} not in combatantInfos!`);
  const gear = buildGearComparison(myInfo, refInfo);

  // 3) DPS 분석
  const damage = buildDamageAnalysis(
    myDmgEvents, input.myFight.startTime, input.myFight.endTime,
    refDmgEvents, input.refFight.startTime, input.refFight.endTime,
  );

  // 4) 피해 비중
  const damageBreakdown = buildDamageBreakdown(myDmgTable, refDmgTable);

  // 4.5) 대상별 피해 분석 (보스 vs 쫄)
  const targetBreakdown = buildTargetBreakdown(
    myDmgEvents, refDmgEvents,
    input.myReport.npcs, input.refReport.npcs,
    input.myFight.name,
  );

  // 5) 가동률 (필터된 캐스트 기준)
  const myUptime = analyzeUptime(myFilteredCasts, input.myFight.startTime, input.myFight.endTime);
  const refUptime = analyzeUptime(refFilteredCasts, input.refFight.startTime, input.refFight.endTime);
  const uptime = compareUptime(myUptime, refUptime, damage.myTotalDPS);

  // 6) 캐스트 타임라인 (필터된 캐스트 + 자원 + 버프 + 영혼파편 + abilityMap)
  const mySnapshots = buildCastSnapshots(myFilteredCasts, myResources, myBuffs, input.myFight.startTime, 120, myCasts, myAbilityMap);
  const refSnapshots = buildCastSnapshots(refFilteredCasts, refResources, refBuffs, input.refFight.startTime, 120, refCasts, refAbilityMap);
  const timeline = mergeTimelines(mySnapshots, refSnapshots);

  // 7) 쿨다운 (실제 데이터에서 동적 감지)
  const rawCooldowns = detectCooldowns(mySnapshots, refSnapshots);
  const cooldowns: CooldownUsage[] = rawCooldowns.map(cd => ({
    spellId: cd.spellId,
    spellName: "",
    myTimings: cd.myTimings,
    refTimings: cd.refTimings,
    estimatedCD: cd.estimatedCD,
    myUses: cd.myTimings.length,
    refUses: cd.refTimings.length,
  }));

  // 8) 자원 관리
  const resources = buildResourceAnalysis(myResources, refResources, input.myFight.startTime);

  // 8.5) 오라 (버프/디버프) 가동 구간
  const myAuras = buildAuraTimeline(myBuffs, input.myFight.startTime, input.myFight.endTime, myAbilityMap);
  const refAuras = buildAuraTimeline(refBuffs, input.refFight.startTime, input.refFight.endTime, refAbilityMap);
  console.log(`[analysis] 오라: 나 ${myAuras.length}종, 상대 ${refAuras.length}종`);

  // 9) 패턴 분석 (딜사이클, 자원별 습관, 시퀀스)
  const patterns = analyzePatterns(mySnapshots, refSnapshots);

  // 10) 영웅특성 자동 감지 (캐스트/버프 이름에서)
  const myAbilityNames = [...new Set(myCasts.map(c => c.abilityName).filter(Boolean))];
  const refAbilityNames = [...new Set(refCasts.map(c => c.abilityName).filter(Boolean))];
  // 오라 이름도 포함
  for (const a of myAuras) myAbilityNames.push(a.name);
  for (const a of refAuras) refAbilityNames.push(a.name);

  const detectedMyHero = detectHeroTalent(myAbilityNames) || input.myHeroSpec;
  const detectedRefHero = detectHeroTalent(refAbilityNames) || input.refHeroSpec;
  if (detectedMyHero) console.log("[analysis] 내 영웅특성 감지:", detectedMyHero);
  if (detectedRefHero) console.log("[analysis] 상대 영웅특성 감지:", detectedRefHero);

  // parse % / ilvl % 제거 — API className 필터 미지원으로 정확한 계산 불가
  const myIlvlPercentile = 0;
  const refIlvlPercentile = 0;

  // 11) 힐러 전용: HPS 분석 + 힐량 비중
  const healing = input.isHealer
    ? buildHealingAnalysis(
        myHealEvents, input.myFight.startTime, input.myFight.endTime,
        refHealEvents, input.refFight.startTime, input.refFight.endTime,
      )
    : undefined;
  const healingBreakdown = input.isHealer
    ? buildHealingBreakdown(myHealTable, refHealTable)
    : undefined;

  // 12) 개선 제안 (패턴 인사이트 포함)
  const suggestions = [
    ...generateSuggestions(uptime, cooldowns, resources, damage, gear),
    ...patterns.insights,
  ];
  const order = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.priority] - order[b.priority]);

  return {
    playerName: input.myName,
    refName: input.refName,
    encounter: input.myFight.name,
    fightDuration: { my: myDuration, ref: refDuration },
    myHeroSpec: detectedMyHero,
    refHeroSpec: detectedRefHero,
    myIlvlPercentile,
    refIlvlPercentile,
    isHealer: input.isHealer,
    gear,
    damage,
    damageBreakdown,
    healing,
    healingBreakdown,
    targetBreakdown,
    uptime,
    cooldowns,
    timeline,
    resources,
    myAuras,
    refAuras,
    patterns,
    suggestions,
  };
}

// ---- 내부 함수들 ----

// 셔츠(3), Ranged(17), Tabard(18)는 전투력에 기여하지 않는 저레벨 슬롯이므로 평균에서 제외
export const NON_COMBAT_SLOTS = new Set([3, 17, 18]);

function buildGearComparison(
  myInfo: WCLCombatantInfo | undefined,
  refInfo: WCLCombatantInfo | undefined,
): GearComparison {
  const avgIlvl = (gear: GearItem[]): number => {
    const items = gear.filter((g) => g.itemLevel > 0 && !NON_COMBAT_SLOTS.has(g.slot));
    return items.length > 0 ? Math.round(items.reduce((s, g) => s + g.itemLevel, 0) / items.length) : 0;
  };

  return {
    myIlvl: myInfo ? avgIlvl(myInfo.gear) : 0,
    refIlvl: refInfo ? avgIlvl(refInfo.gear) : 0,
    myStats: myInfo?.stats ?? {},
    refStats: refInfo?.stats ?? {},
    myGear: myInfo?.gear ?? [],
    refGear: refInfo?.gear ?? [],
    myTalents: (myInfo?.talents ?? []).map((t) => ({
      spellID: t.spellID ?? t.id ?? 0,
      name: t.name ?? "",
      icon: t.icon ?? "",
    })),
    refTalents: (refInfo?.talents ?? []).map((t) => ({
      spellID: t.spellID ?? t.id ?? 0,
      name: t.name ?? "",
      icon: t.icon ?? "",
    })),
    myHeroTree: myInfo?.heroTreeName ?? "",
    refHeroTree: refInfo?.heroTreeName ?? "",
    myHeroTalents: myInfo?.heroTalents ?? [],
    refHeroTalents: refInfo?.heroTalents ?? [],
    myTalentTree: myInfo?.talentTree ?? [],
    refTalentTree: refInfo?.talentTree ?? [],
    myAuras: myInfo?.auras ?? [],
    refAuras: refInfo?.auras ?? [],
  };
}

function buildDamageAnalysis(
  myEvents: WCLDamageEvent[],
  myStart: number, myEnd: number,
  refEvents: WCLDamageEvent[],
  refStart: number, refEnd: number,
): DamageAnalysis {
  const myDuration = (myEnd - myStart) / 1000;
  const refDuration = (refEnd - refStart) / 1000;
  const myTotalDamage = myEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
  const refTotalDamage = refEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
  const myTotalDPS = myDuration > 0 ? myTotalDamage / myDuration : 0;
  const refTotalDPS = refDuration > 0 ? refTotalDamage / refDuration : 0;
  const dpsGap = refTotalDPS - myTotalDPS;
  const dpsGapPercent = myTotalDPS > 0 ? (dpsGap / myTotalDPS) * 100 : 0;

  // 10초 구간
  const INTERVAL = 1;
  // 긴 쪽 기준으로 전체 구간 생성 (짧은 쪽은 끝난 후 DPS 0)
  const maxDuration = Math.max(myDuration, refDuration);
  const numIntervals = Math.ceil(maxDuration / INTERVAL);
  const timeline: DamageAnalysis["timeline"] = [];

  for (let i = 0; i < numIntervals; i++) {
    const startSec = i * INTERVAL;
    const endSec = Math.min((i + 1) * INTERVAL, maxDuration);
    const dur = endSec - startSec;
    const myDmg = sumDmgWindow(myEvents, myStart, startSec, endSec);
    const refDmg = sumDmgWindow(refEvents, refStart, startSec, endSec);
    timeline.push({
      startSec, endSec,
      myDPS: dur > 0 ? myDmg / dur : 0,
      refDPS: dur > 0 ? refDmg / dur : 0,
      gap: dur > 0 ? (refDmg / dur) - (myDmg / dur) : 0,
    });
  }

  // 3초 이동평균으로 스무딩 (1초 데이터는 스파이크가 심함)
  const SMOOTH = 3;
  const smoothed: typeof timeline = [];
  for (let i = 0; i < timeline.length; i++) {
    const start = Math.max(0, i - Math.floor(SMOOTH / 2));
    const end = Math.min(timeline.length, i + Math.ceil(SMOOTH / 2));
    let mySum = 0, refSum = 0, count = 0;
    for (let j = start; j < end; j++) {
      mySum += timeline[j].myDPS;
      refSum += timeline[j].refDPS;
      count++;
    }
    smoothed.push({
      ...timeline[i],
      myDPS: count > 0 ? mySum / count : 0,
      refDPS: count > 0 ? refSum / count : 0,
      gap: count > 0 ? (refSum - mySum) / count : 0,
    });
  }

  return { myTotalDPS, refTotalDPS, myTotalDamage, refTotalDamage, dpsGap, dpsGapPercent, timeline: smoothed };
}

function sumDmgWindow(events: WCLDamageEvent[], fightStart: number, startSec: number, endSec: number): number {
  const s = fightStart + startSec * 1000;
  const e = fightStart + endSec * 1000;
  let total = 0;
  for (const ev of events) {
    if (ev.timestamp >= s && ev.timestamp < e) total += ev.amount ?? 0;
  }
  return total;
}

function buildDamageBreakdown(
  myTable: { name: string; guid: number; total: number; hitCount: number; tickCount: number; icon: string }[],
  refTable: { name: string; guid: number; total: number; hitCount: number; tickCount: number; icon: string }[],
): DamageBreakdownEntry[] {
  const myTotal = myTable.reduce((s, e) => s + e.total, 0);
  const refTotal = refTable.reduce((s, e) => s + e.total, 0);

  const map = new Map<number, DamageBreakdownEntry>();

  for (const e of myTable) {
    map.set(e.guid, {
      spellId: e.guid,
      spellName: e.name,
      icon: e.icon,
      myDamage: e.total,
      refDamage: 0,
      myPercent: myTotal > 0 ? (e.total / myTotal) * 100 : 0,
      refPercent: 0,
      myHits: e.hitCount + e.tickCount,
      refHits: 0,
    });
  }

  for (const e of refTable) {
    const existing = map.get(e.guid);
    if (existing) {
      existing.refDamage = e.total;
      existing.refPercent = refTotal > 0 ? (e.total / refTotal) * 100 : 0;
      existing.refHits = e.hitCount + e.tickCount;
    } else {
      map.set(e.guid, {
        spellId: e.guid,
        spellName: e.name,
        icon: e.icon,
        myDamage: 0,
        refDamage: e.total,
        myPercent: 0,
        refPercent: refTotal > 0 ? (e.total / refTotal) * 100 : 0,
        myHits: 0,
        refHits: e.hitCount + e.tickCount,
      });
    }
  }

  return [...map.values()]
    .filter(e => e.myPercent >= 0.5 || e.refPercent >= 0.5)
    .sort((a, b) => Math.max(b.myPercent, b.refPercent) - Math.max(a.myPercent, a.refPercent));
}

// ---- 힐러 모드 분석 (buildDamageAnalysis/buildDamageBreakdown 미러) ----

function buildHealingAnalysis(
  myEvents: WCLHealEvent[],
  myStart: number, myEnd: number,
  refEvents: WCLHealEvent[],
  refStart: number, refEnd: number,
): HealingAnalysis {
  const myDuration = (myEnd - myStart) / 1000;
  const refDuration = (refEnd - refStart) / 1000;
  const myTotalHealing = myEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
  const refTotalHealing = refEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
  const myTotalHPS = myDuration > 0 ? myTotalHealing / myDuration : 0;
  const refTotalHPS = refDuration > 0 ? refTotalHealing / refDuration : 0;
  const hpsGap = refTotalHPS - myTotalHPS;
  const hpsGapPercent = myTotalHPS > 0 ? (hpsGap / myTotalHPS) * 100 : 0;

  const INTERVAL = 1;
  const maxDuration = Math.max(myDuration, refDuration);
  const numIntervals = Math.ceil(maxDuration / INTERVAL);
  const timeline: HealingAnalysis["timeline"] = [];

  for (let i = 0; i < numIntervals; i++) {
    const startSec = i * INTERVAL;
    const endSec = Math.min((i + 1) * INTERVAL, maxDuration);
    const dur = endSec - startSec;
    const myHeal = sumHealWindow(myEvents, myStart, startSec, endSec);
    const refHeal = sumHealWindow(refEvents, refStart, startSec, endSec);
    timeline.push({
      startSec, endSec,
      myHPS: dur > 0 ? myHeal / dur : 0,
      refHPS: dur > 0 ? refHeal / dur : 0,
      gap: dur > 0 ? (refHeal / dur) - (myHeal / dur) : 0,
    });
  }

  // 3초 이동평균 스무딩
  const SMOOTH = 3;
  const smoothed: typeof timeline = [];
  for (let i = 0; i < timeline.length; i++) {
    const start = Math.max(0, i - Math.floor(SMOOTH / 2));
    const end = Math.min(timeline.length, i + Math.ceil(SMOOTH / 2));
    let mySum = 0, refSum = 0, count = 0;
    for (let j = start; j < end; j++) {
      mySum += timeline[j].myHPS;
      refSum += timeline[j].refHPS;
      count++;
    }
    smoothed.push({
      ...timeline[i],
      myHPS: count > 0 ? mySum / count : 0,
      refHPS: count > 0 ? refSum / count : 0,
      gap: count > 0 ? (refSum - mySum) / count : 0,
    });
  }

  return { myTotalHPS, refTotalHPS, myTotalHealing, refTotalHealing, hpsGap, hpsGapPercent, timeline: smoothed };
}

function sumHealWindow(events: WCLHealEvent[], fightStart: number, startSec: number, endSec: number): number {
  const s = fightStart + startSec * 1000;
  const e = fightStart + endSec * 1000;
  let total = 0;
  for (const ev of events) {
    if (ev.timestamp >= s && ev.timestamp < e) total += ev.amount ?? 0;
  }
  return total;
}

/** HealingTableEntry는 DamageTableEntry 상위집합(structural)이라 buildDamageBreakdown 그대로 재사용. */
function buildHealingBreakdown(
  myTable: HealingTableEntry[],
  refTable: HealingTableEntry[],
): DamageBreakdownEntry[] {
  return buildDamageBreakdown(myTable, refTable);
}

function buildResourceAnalysis(
  myRes: { timestamp: number; resourceAmount: number; waste: number; resourceType: number }[],
  refRes: { timestamp: number; resourceAmount: number; waste: number; resourceType: number }[],
  myFightStart: number,
): ResourceAnalysis {
  const myWaste = myRes.reduce((s, e) => s + (e.waste ?? 0), 0);
  const refWaste = refRes.reduce((s, e) => s + (e.waste ?? 0), 0);
  const myGen = myRes.reduce((s, e) => s + (e.waste ?? 0) + Math.max(0, e.resourceAmount ?? 0), 0);
  const refGen = refRes.reduce((s, e) => s + (e.waste ?? 0) + Math.max(0, e.resourceAmount ?? 0), 0);

  // 자원 만땅 구간 감지
  const cappedMoments: ResourceAnalysis["cappedMoments"] = [];
  let cappedStart: number | null = null;
  for (const e of myRes) {
    const t = (e.timestamp - myFightStart) / 1000;
    if (e.resourceAmount >= 100) { // 대략적 만땅 기준
      if (cappedStart === null) cappedStart = t;
    } else {
      if (cappedStart !== null && t - cappedStart > 1) {
        cappedMoments.push({ timestamp: cappedStart, duration: t - cappedStart });
      }
      cappedStart = null;
    }
  }

  // 자원 타입 이름
  const resType = myRes.length > 0 ? RESOURCE_NAMES[myRes[0].resourceType] ?? "Resource" : "Resource";

  return {
    resourceType: resType,
    totalWasted: myWaste,
    wastePercent: myGen > 0 ? Math.round((myWaste / myGen) * 1000) / 10 : 0,
    refWastePercent: refGen > 0 ? Math.round((refWaste / refGen) * 1000) / 10 : 0,
    cappedMoments,
  };
}

const RESOURCE_NAMES: Record<number, string> = {
  0: "Mana", 1: "Rage", 2: "Focus", 3: "Energy", 4: "Combo Points",
  5: "Runes", 6: "Runic Power", 7: "Soul Shards", 8: "Astral Power",
  9: "Holy Power", 11: "Maelstrom", 12: "Chi", 13: "Insanity",
  16: "Arcane Charges", 17: "Fury", 18: "Pain", 19: "Essence",
};

function generateSuggestions(
  uptime: FullAnalysis["uptime"],
  _cooldowns: CooldownUsage[],
  resources: ResourceAnalysis,
  damage: DamageAnalysis,
  gear: GearComparison,
): FullAnalysis["suggestions"] {
  const s: FullAnalysis["suggestions"] = [];

  // 장비
  if (gear.myIlvl > 0 && gear.refIlvl > 0) {
    const d = gear.refIlvl - gear.myIlvl;
    if (d !== 0) s.push({ priority: "low", category: "장비", message: `템렙 ${gear.myIlvl} vs ${gear.refIlvl} (차이 ${d > 0 ? "+" : ""}${d})` });
  }

  // 스탯 비교
  const statLabels: Record<string, string> = {
    CriticalStrike: "치명타", Haste: "가속", Mastery: "특화", Versatility: "유연성",
    Agility: "민첩", Strength: "힘", Intellect: "지능",
  };
  for (const [stat, label] of Object.entries(statLabels)) {
    const my = gear.myStats[stat] ?? 0;
    const ref = gear.refStats[stat] ?? 0;
    if (my === 0 && ref === 0) continue;
    const diff = my - ref;
    const pct = ref > 0 ? (diff / ref) * 100 : 0;
    const verdict = Math.abs(pct) <= 15 ? "적정" : pct > 0 ? "과다" : "부족";
    if (verdict === "적정") continue;
    s.push({ priority: "low", category: "스탯",
      message: `${label} ${my.toLocaleString()} vs ${ref.toLocaleString()} (${diff > 0 ? "+" : ""}${diff.toLocaleString()}, ${verdict})` });
  }

  // DPS
  if (damage.dpsGap !== 0) {
    s.push({ priority: damage.dpsGapPercent > 20 ? "high" : "medium", category: "DPS",
      message: `${fmtDPS(damage.myTotalDPS)} vs ${fmtDPS(damage.refTotalDPS)} (${damage.dpsGap > 0 ? "-" : "+"}${fmtDPS(Math.abs(damage.dpsGap))}, ${Math.abs(damage.dpsGapPercent).toFixed(1)}%)` });
  }

  // 가동률
  if (Math.abs(uptime.uptimeDiff) > 2) {
    s.push({ priority: Math.abs(uptime.uptimeDiff) > 5 ? "high" : "medium", category: "가동률",
      message: `${uptime.uptimePercent.toFixed(1)}% vs ${uptime.refUptimePercent.toFixed(1)}% (차이 ${uptime.uptimeDiff > 0 ? "+" : ""}${uptime.uptimeDiff.toFixed(1)}%p, 빈 구간 ${uptime.deadZones.length}회)` });
  }

  // 자원
  if (resources.wastePercent > 5 || resources.refWastePercent > 5) {
    s.push({ priority: "low", category: "자원",
      message: `${resources.resourceType} 낭비율 ${resources.wastePercent}% vs ${resources.refWastePercent}%` });
  }

  return s;
}

function buildTargetBreakdown(
  myEvents: WCLDamageEvent[],
  refEvents: WCLDamageEvent[],
  myNpcs: Array<{ id: number; name: string }>,
  refNpcs: Array<{ id: number; name: string }>,
  fightName: string,
): FullAnalysis["targetBreakdown"] {
  // NPC ID → 이름 매핑 (리포트별)
  const myNpcMap = new Map<number, string>();
  const refNpcMap = new Map<number, string>();
  for (const n of myNpcs) myNpcMap.set(n.id, n.name);
  for (const n of refNpcs) refNpcMap.set(n.id, n.name);

  const isBossName = (name: string) => {
    const lower = name.toLowerCase();
    const fightLower = fightName.toLowerCase();
    return lower.includes(fightLower) || fightLower.includes(lower);
  };

  // 이름 기반으로 피해 집계 (targetID는 리포트마다 다르므로 이름으로 병합)
  const myByName = new Map<string, number>();
  const refByName = new Map<string, number>();

  for (const e of myEvents) {
    const name = myNpcMap.get(e.targetID) ?? `#${e.targetID}`;
    myByName.set(name, (myByName.get(name) ?? 0) + (e.amount ?? 0));
  }
  for (const e of refEvents) {
    const name = refNpcMap.get(e.targetID) ?? `#${e.targetID}`;
    refByName.set(name, (refByName.get(name) ?? 0) + (e.amount ?? 0));
  }

  const myTotal = myEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
  const refTotal = refEvents.reduce((s, e) => s + (e.amount ?? 0), 0);

  const allNames = new Set([...myByName.keys(), ...refByName.keys()]);
  const targets: FullAnalysis["targetBreakdown"]["targets"] = [];

  let myBossDmg = 0, myAddDmg = 0, refBossDmg = 0, refAddDmg = 0;

  for (const name of allNames) {
    const myDmg = myByName.get(name) ?? 0;
    const refDmg = refByName.get(name) ?? 0;
    if (myDmg + refDmg < (myTotal + refTotal) * 0.003) continue;

    const isBoss = isBossName(name);
    if (isBoss) { myBossDmg += myDmg; refBossDmg += refDmg; }
    else { myAddDmg += myDmg; refAddDmg += refDmg; }

    targets.push({
      targetID: 0, name, isBoss,
      myDamage: myDmg, refDamage: refDmg,
      myPercent: myTotal > 0 ? Math.round((myDmg / myTotal) * 1000) / 10 : 0,
      refPercent: refTotal > 0 ? Math.round((refDmg / refTotal) * 1000) / 10 : 0,
    });
  }

  // 보스 감지 실패 시 가장 피해 많은 대상 = 보스
  if (myBossDmg === 0 && refBossDmg === 0 && targets.length > 0) {
    const top = targets.reduce((a, b) => (a.myDamage + a.refDamage > b.myDamage + b.refDamage ? a : b));
    top.isBoss = true;
    myBossDmg = top.myDamage;
    refBossDmg = top.refDamage;
    myAddDmg -= top.myDamage;
    refAddDmg -= top.refDamage;
  }

  targets.sort((a, b) => Math.max(b.myDamage, b.refDamage) - Math.max(a.myDamage, a.refDamage));

  return {
    myBossDmg, myAddDmg,
    myBossPercent: myTotal > 0 ? Math.round((myBossDmg / myTotal) * 1000) / 10 : 0,
    refBossDmg, refAddDmg,
    refBossPercent: refTotal > 0 ? Math.round((refBossDmg / refTotal) * 1000) / 10 : 0,
    targets,
  };
}

function fmtDPS(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

export type { FullAnalysis } from "./types";
