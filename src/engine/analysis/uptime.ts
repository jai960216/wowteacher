// ============================================
// GCD 가동률 분석
// ============================================

import type { WCLCastEvent } from "../wcl/api";
import type { UptimeAnalysis } from "./types";

const DEAD_ZONE_THRESHOLD = 2.0; // 2초 이상 빈 시간 = dead zone

/**
 * GCD 가동률 분석
 * @param casts 캐스트 이벤트 (timestamp 기준 정렬됨)
 * @param fightStart 전투 시작 timestamp (ms)
 * @param fightEnd 전투 종료 timestamp (ms)
 * @param baseGCD 기본 GCD (초, 하스트 미적용)
 * @param hastePct 하스트 % (0~100)
 */
export function analyzeUptime(
  casts: WCLCastEvent[],
  fightStart: number,
  fightEnd: number,
  baseGCD: number = 1.5,
  hastePct: number = 0,
): UptimeAnalysis {
  const fightDuration = (fightEnd - fightStart) / 1000; // 초
  if (casts.length === 0) {
    return {
      totalFightDuration: fightDuration,
      totalCasts: 0,
      estimatedGCD: baseGCD,
      activeTime: 0,
      uptimePercent: 0,
      deadZones: [],
      refUptimePercent: 0,
      uptimeDiff: 0,
      estimatedDPSLoss: 0,
    };
  }

  // 하스트 보정 GCD
  const gcd = Math.max(0.75, baseGCD / (1 + hastePct / 100));

  // 캐스트 간격 분석
  const sorted = [...casts].sort((a, b) => a.timestamp - b.timestamp);
  const deadZones: UptimeAnalysis["deadZones"] = [];
  let activeGCDs = 0;

  for (let i = 0; i < sorted.length; i++) {
    const timeSec = (sorted[i].timestamp - fightStart) / 1000;

    if (i === 0) {
      // 전투 시작 ~ 첫 캐스트
      if (timeSec > DEAD_ZONE_THRESHOLD) {
        deadZones.push({
          start: 0,
          end: timeSec,
          duration: timeSec,
          reason: "전투 시작 지연",
        });
      }
    } else {
      const prevSec = (sorted[i - 1].timestamp - fightStart) / 1000;
      const gap = timeSec - prevSec;

      if (gap > DEAD_ZONE_THRESHOLD) {
        deadZones.push({
          start: prevSec,
          end: timeSec,
          duration: gap,
        });
      }
    }
    activeGCDs++;
  }

  // 마지막 캐스트 ~ 전투 종료
  const lastSec = (sorted[sorted.length - 1].timestamp - fightStart) / 1000;
  if (fightDuration - lastSec > DEAD_ZONE_THRESHOLD) {
    deadZones.push({
      start: lastSec,
      end: fightDuration,
      duration: fightDuration - lastSec,
      reason: "전투 종료 전 빈 시간",
    });
  }

  const activeTime = activeGCDs * gcd;
  const uptimePercent = Math.min(100, (activeTime / fightDuration) * 100);

  return {
    totalFightDuration: fightDuration,
    totalCasts: casts.length,
    estimatedGCD: gcd,
    activeTime,
    uptimePercent,
    deadZones,
    // 상대 데이터는 나중에 채움
    refUptimePercent: 0,
    uptimeDiff: 0,
    estimatedDPSLoss: 0,
  };
}

/** 두 가동률 분석을 비교해서 diff + DPS 손실 추정 */
export function compareUptime(
  my: UptimeAnalysis,
  ref: UptimeAnalysis,
  myTotalDPS: number,
): UptimeAnalysis {
  const uptimeDiff = my.uptimePercent - ref.uptimePercent;
  // 가동률 차이로 인한 DPS 손실 추정
  // 예: 가동률 85% vs 95% → 10% 차이 → DPS의 ~10% 손실
  const estimatedDPSLoss = uptimeDiff < 0
    ? Math.abs(uptimeDiff) / 100 * myTotalDPS
    : 0;

  return {
    ...my,
    refUptimePercent: ref.uptimePercent,
    uptimeDiff,
    estimatedDPSLoss,
  };
}
