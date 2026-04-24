// ============================================
// 패턴 분석 — 딜사이클, 자원별 습관
// 탈태(메타) ON/OFF 상태별 분리 분석
// ============================================

import type { CastSnapshot } from "./types";

// ---- 타입 ----

/** 자원 구간별 스킬 선택 비교 */
export interface ResourceHabit {
  rangeLabel: string;
  rangeMin: number;
  rangeMax: number;
  myTotal: number;
  refTotal: number;
  myTop: Array<{ spellId: number; count: number; pct: number }>;
  refTop: Array<{ spellId: number; count: number; pct: number }>;
  biggestDiff: {
    spellId: number;
    myPct: number;
    refPct: number;
    diff: number;
  } | null;
}

/** 상태별(탈태 ON/OFF) 분석 블록 */
export interface StateAnalysis {
  label: string;           // "일반" 또는 "탈태"
  isMeta: boolean;
  myCasts: number;
  refCasts: number;
  resourceHabits: ResourceHabit[];
  /** 가장 많이 쓴 스킬 Top 10 */
  mySpellRanking: Array<{ spellId: number; count: number; pct: number }>;
  refSpellRanking: Array<{ spellId: number; count: number; pct: number }>;
}

/** 전체 패턴 분석 결과 */
export interface PatternAnalysis {
  opener: {
    my: CastSnapshot[];
    ref: CastSnapshot[];
  };
  /** 상태별 분석 (일반 + 탈태) */
  byState: StateAnalysis[];
  /** 빈 시간 직전 패턴 */
  preGapPatterns: Array<{
    gapStart: number;
    gapDuration: number;
    lastCasts: CastSnapshot[];
  }>;
  /** 탈태 사용 비교 */
  metaUsage: {
    myCount: number;
    refCount: number;
    myAvgCasts: number;   // 탈태 1회당 평균 캐스트 수
    refAvgCasts: number;
  };
  insights: Array<{
    category: string;
    message: string;
    priority: "high" | "medium" | "low";
    spellId?: number;
  }>;
}

// ---- 분석 함수 ----

const OPENER_SIZE = 15;
const GAP_THRESHOLD = 2.0;

export function analyzePatterns(
  mySnapshots: CastSnapshot[],
  refSnapshots: CastSnapshot[],
  resourceMax: number = 120,
): PatternAnalysis {
  // 오프너
  const opener = {
    my: mySnapshots.slice(0, OPENER_SIZE),
    ref: refSnapshots.slice(0, OPENER_SIZE),
  };

  // 탈태 ON/OFF 분리
  const myNormal = mySnapshots.filter(c => !c.isDuringMeta);
  const myMeta = mySnapshots.filter(c => c.isDuringMeta);
  const refNormal = refSnapshots.filter(c => !c.isDuringMeta);
  const refMeta = refSnapshots.filter(c => c.isDuringMeta);

  const ranges = [
    { label: "0~30", min: 0, max: 30 },
    { label: "30~60", min: 30, max: 60 },
    { label: "60~90", min: 60, max: 90 },
    { label: "90+", min: 90, max: resourceMax + 999 },
  ];

  const byState: StateAnalysis[] = [
    buildStateAnalysis("일반", false, myNormal, refNormal, ranges),
    buildStateAnalysis("탈태", true, myMeta, refMeta, ranges),
  ];

  // 빈 시간 패턴
  const preGapPatterns = findPreGapPatterns(mySnapshots);

  // 탈태 사용 비교
  const metaUsage = buildMetaUsage(mySnapshots, refSnapshots);

  // 인사이트
  const insights = generateInsights(preGapPatterns, metaUsage);

  return { opener, byState, preGapPatterns, metaUsage, insights };
}

// ---- 내부 함수 ----

function buildStateAnalysis(
  label: string, isMeta: boolean,
  my: CastSnapshot[], ref: CastSnapshot[],
  ranges: Array<{ label: string; min: number; max: number }>,
): StateAnalysis {
  const resourceHabits = ranges.map(r => buildResourceHabit(r.label, r.min, r.max, my, ref));

  const mySpells = countSpells(my);
  const refSpells = countSpells(ref);

  return {
    label, isMeta,
    myCasts: my.length,
    refCasts: ref.length,
    resourceHabits,
    mySpellRanking: topN(mySpells, my.length, 10),
    refSpellRanking: topN(refSpells, ref.length, 10),
  };
}

function buildMetaUsage(my: CastSnapshot[], ref: CastSnapshot[]) {
  const countWindows = (snapshots: CastSnapshot[]) => {
    let windows = 0;
    let totalCasts = 0;
    let inMeta = false;
    let currentCasts = 0;
    for (const s of snapshots) {
      if (s.isDuringMeta && !inMeta) {
        inMeta = true;
        currentCasts = 0;
      }
      if (s.isDuringMeta) currentCasts++;
      if (!s.isDuringMeta && inMeta) {
        inMeta = false;
        windows++;
        totalCasts += currentCasts;
      }
    }
    if (inMeta) { windows++; totalCasts += currentCasts; }
    return { count: windows, avgCasts: windows > 0 ? totalCasts / windows : 0 };
  };

  const myMeta = countWindows(my);
  const refMeta = countWindows(ref);

  return {
    myCount: myMeta.count,
    refCount: refMeta.count,
    myAvgCasts: Math.round(myMeta.avgCasts),
    refAvgCasts: Math.round(refMeta.avgCasts),
  };
}

function buildResourceHabit(
  label: string, min: number, max: number,
  my: CastSnapshot[], ref: CastSnapshot[],
): ResourceHabit {
  const myInRange = my.filter(c => c.resource >= min && c.resource < max);
  const refInRange = ref.filter(c => c.resource >= min && c.resource < max);

  const mySpells = countSpells(myInRange);
  const refSpells = countSpells(refInRange);

  const myTop = topN(mySpells, myInRange.length, 5);
  const refTop = topN(refSpells, refInRange.length, 5);

  const allSpellIds = new Set([...mySpells.keys(), ...refSpells.keys()]);
  let biggestDiff: ResourceHabit["biggestDiff"] = null;
  let maxDiff = 0;

  for (const id of allSpellIds) {
    const myPct = myInRange.length > 0 ? ((mySpells.get(id) ?? 0) / myInRange.length) * 100 : 0;
    const refPct = refInRange.length > 0 ? ((refSpells.get(id) ?? 0) / refInRange.length) * 100 : 0;
    const diff = Math.abs(myPct - refPct);
    if (diff > maxDiff && diff > 5) {
      maxDiff = diff;
      biggestDiff = { spellId: id, myPct: round(myPct), refPct: round(refPct), diff: round(diff) };
    }
  }

  return { rangeLabel: label, rangeMin: min, rangeMax: max, myTotal: myInRange.length, refTotal: refInRange.length, myTop, refTop, biggestDiff };
}

function findPreGapPatterns(snapshots: CastSnapshot[]): PatternAnalysis["preGapPatterns"] {
  const patterns: PatternAnalysis["preGapPatterns"] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const gap = snapshots[i].timestamp - snapshots[i - 1].timestamp;
    if (gap >= GAP_THRESHOLD) {
      const start = Math.max(0, i - 3);
      patterns.push({ gapStart: snapshots[i - 1].timestamp, gapDuration: gap, lastCasts: snapshots.slice(start, i) });
    }
  }
  return patterns;
}

function generateInsights(
  preGaps: PatternAnalysis["preGapPatterns"],
  metaUsage: PatternAnalysis["metaUsage"],
): PatternAnalysis["insights"] {
  const insights: PatternAnalysis["insights"] = [];

  // 탈태
  if (metaUsage.myCount > 0 || metaUsage.refCount > 0) {
    insights.push({ priority: "medium", category: "탈태",
      message: `${metaUsage.myCount}회 vs ${metaUsage.refCount}회 | 탈태당 캐스트 ${metaUsage.myAvgCasts} vs ${metaUsage.refAvgCasts}` });
  }

  // 빈 시간
  if (preGaps.length > 0) {
    insights.push({ priority: preGaps.length > 3 ? "high" : "low", category: "빈 시간",
      message: `2초+ 빈 구간 ${preGaps.length}회` });
  }

  const order = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => order[a.priority] - order[b.priority]);
  return insights;
}

// ---- 유틸 ----

function countSpells(casts: CastSnapshot[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of casts) m.set(c.spellId, (m.get(c.spellId) ?? 0) + 1);
  return m;
}

function topN(counts: Map<number, number>, total: number, n: number) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([spellId, count]) => ({ spellId, count, pct: round(total > 0 ? (count / total) * 100 : 0) }));
}

function round(n: number): number { return Math.round(n * 10) / 10; }
