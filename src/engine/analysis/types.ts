// ============================================
// 분석 엔진 공통 타입
// ============================================

/** 단일 캐스트 + 그 순간의 맥락 */
export interface CastSnapshot {
  timestamp: number;         // 전투 시작 기준 초
  spellId: number;
  spellName: string;
  resource: number;          // 캐스트 시점 주 자원량 (분노 등)
  resourceMax: number;
  soulFragments: number;     // 영혼파편 (악마사냥꾼 2차 자원, 0이면 해당 없음)
  activeBuffs: number[];     // 활성 버프 spellId 목록
  isDuringLust: boolean;     // 피욕 중 여부
  isDuringMeta: boolean;     // 변신(메타) 중 여부
}

/** 타임라인 한 쌍 (내 캐스트 vs 상대 캐스트, 시간 정렬) */
export interface TimelineEntry {
  timeSec: number;
  my: CastSnapshot | null;
  ref: CastSnapshot | null;
}

/** 쿨다운 사용 기록 (실제 데이터에서 감지) */
export interface CooldownUsage {
  spellId: number;
  spellName: string;
  myTimings: number[];       // 전투 시작 기준 초
  refTimings: number[];
  estimatedCD: number;       // 사용 간격에서 추정한 쿨타임
  myUses: number;
  refUses: number;
}

/** GCD 가동률 */
export interface UptimeAnalysis {
  totalFightDuration: number;
  totalCasts: number;
  estimatedGCD: number;
  activeTime: number;
  uptimePercent: number;
  deadZones: Array<{
    start: number;
    end: number;
    duration: number;
    reason?: string;
  }>;
  refUptimePercent: number;
  uptimeDiff: number;
  estimatedDPSLoss: number;
}

/** 장비/스탯 비교 */
export interface GearComparison {
  myIlvl: number;
  refIlvl: number;
  myStats: Record<string, number>;
  refStats: Record<string, number>;
  myGear: GearItem[];
  refGear: GearItem[];
  myTalents: Array<{ spellID: number; name: string; icon: string }>;
  refTalents: Array<{ spellID: number; name: string; icon: string }>;
  myHeroTree: string;
  refHeroTree: string;
  myHeroTalents: Array<{ spellID: number; name: string; icon: string }>;
  refHeroTalents: Array<{ spellID: number; name: string; icon: string }>;
  myTalentTree: Array<{ id: number; rank: number; nodeID: number }>;
  refTalentTree: Array<{ id: number; rank: number; nodeID: number }>;
  myAuras: Array<{ ability: number; name: string; icon: string; stacks: number }>;
  refAuras: Array<{ ability: number; name: string; icon: string; stacks: number }>;
}

/** DPS 구간 분석 */
export interface DamageAnalysis {
  myTotalDPS: number;
  refTotalDPS: number;
  myTotalDamage: number;
  refTotalDamage: number;
  dpsGap: number;
  dpsGapPercent: number;
  timeline: Array<{
    startSec: number;
    endSec: number;
    myDPS: number;
    refDPS: number;
    gap: number;
  }>;
}

/** HPS 구간 분석 (DamageAnalysis 미러) */
export interface HealingAnalysis {
  myTotalHPS: number;
  refTotalHPS: number;
  myTotalHealing: number;
  refTotalHealing: number;
  hpsGap: number;
  hpsGapPercent: number;
  timeline: Array<{
    startSec: number;
    endSec: number;
    myHPS: number;
    refHPS: number;
    gap: number;
  }>;
}

/** 피해 비중 테이블 항목 */
export interface DamageBreakdownEntry {
  spellId: number;
  spellName: string;
  icon: string;
  myDamage: number;
  refDamage: number;
  myPercent: number;
  refPercent: number;
  myHits: number;
  refHits: number;
}

/** 종합 분석 결과 */
export interface FullAnalysis {
  playerName: string;
  refName: string;
  encounter: string;
  fightDuration: { my: number; ref: number };
  myHeroSpec: string;
  refHeroSpec: string;
  myIlvlPercentile: number;   // 내 ilvl 퍼센타일 (0 = 데이터 없음)
  refIlvlPercentile: number;  // 상대 ilvl 퍼센타일

  // 진단용 — 분석 결과에서 원본 리포트·fight·actor id 참조. WCL 사이트 URL 생성 및 데이터 비교용.
  myReportCode: string;
  myFightID: number;
  myPlayerId: number;
  refReportCode: string;
  refFightID: number;
  refPlayerId: number;

  // 외부 버프 수령 여부 (label → received). Buffs events + Casts 이벤트 OR 조합.
  // buff event가 누락되는 경우(WCL API 제약) cast 이벤트로 역추정.
  externalBuffsReceived: {
    my: Record<string, boolean>;
    ref: Record<string, boolean>;
  };

  /** 힐러 모드 여부 (true이면 healing/healingBreakdown 사용, false이면 damage/damageBreakdown) */
  isHealer: boolean;

  // 장비/스탯 비교
  gear: GearComparison;

  // DPS (딜러 모드 데이터 — 힐러 모드에서도 0 근처 값이 들어올 수 있으나 UI는 healing을 우선 사용)
  damage: DamageAnalysis;
  damageBreakdown: DamageBreakdownEntry[];

  // HPS (힐러 모드에서만 채움)
  healing?: HealingAnalysis;
  healingBreakdown?: DamageBreakdownEntry[];

  // 가동률
  uptime: UptimeAnalysis;

  // 쿨다운 (실제 데이터 기반)
  cooldowns: CooldownUsage[];

  // 캐스트 타임라인 (순서 + 자원 + 버프)
  timeline: TimelineEntry[];

  // 대상별 피해 분석
  targetBreakdown: {
    myBossDmg: number;
    myAddDmg: number;
    myBossPercent: number;
    refBossDmg: number;
    refAddDmg: number;
    refBossPercent: number;
    targets: Array<{
      targetID: number;
      name: string;
      isBoss: boolean;
      myDamage: number;
      refDamage: number;
      myPercent: number;
      refPercent: number;
    }>;
  };

  // 오라 (버프/디버프 가동 구간)
  myAuras: import("./auras").AuraInfo[];
  refAuras: import("./auras").AuraInfo[];

  // 패턴 분석 (딜사이클, 자원별 습관, 시퀀스)
  patterns: import("./patterns").PatternAnalysis | null;

  // 개선 제안
  suggestions: Array<{
    priority: "high" | "medium" | "low";
    category: string;
    message: string;
    spellId?: number;
  }>;
}

/** WCL DamageDone 이벤트 */
export interface WCLDamageEvent {
  timestamp: number;
  type: string;
  sourceID: number;
  targetID: number;
  abilityGameID: number;
  amount: number;
  absorbed?: number;
  overkill?: number;
  hitType: number;
  fight: number;
}

/** WCL Healing 이벤트 (DamageEvent와 shape 동일하되 overkill 대신 overheal) */
export interface WCLHealEvent {
  timestamp: number;
  type: string;
  sourceID: number;
  targetID: number;
  abilityGameID: number;
  amount: number;       // 실효 힐량
  absorbed?: number;
  overheal?: number;    // 오버힐 (차감 전 원래 힐량 = amount + overheal)
  hitType: number;
  fight: number;
}

/** WCL 장비 아이템 */
export interface GearItem {
  id: number;
  slot: number;              // 0=Head, 1=Neck, 2=Shoulder, ...
  itemLevel: number;
  quality: number;           // 3=Rare, 4=Epic, 5=Legendary
  icon: string;
  name: string;              // 아이템 이름 (있으면)
  permanentEnchant: number;  // 마법부여 ID (0=없음)
  temporaryEnchant: number;  // 임시 마부 (돌, 기름 등)
  gems: Array<{ id: number; itemLevel: number; icon: string }>;
}

/** WCL CombatantInfo */
export interface WCLCombatantInfo {
  sourceID: number;
  specID: number;
  gear: GearItem[];
  talents: Array<{ id: number; spellID: number; name: string; icon: string }>;
  heroTalents: Array<{ spellID: number; name: string; icon: string }>;
  talentTree: Array<{ id: number; rank: number; nodeID: number }>;
  /** 전투 시작 시 활성 오라/버프 (특성 패시브 포함, 아이콘+이름 있음) */
  auras: Array<{ ability: number; name: string; icon: string; stacks: number }>;
  stats: Record<string, number>;
  heroTreeName: string;
}

/** WCL Death 이벤트 */
export interface WCLDeathEvent {
  timestamp: number;
  targetID: number;
  killerID?: number;
  killingAbilityGameID?: number;
  fight: number;
}

/** DamageDone 테이블 항목 */
export interface DamageTableEntry {
  name: string;
  guid: number;
  type: number;
  total: number;
  totalReduced: number;
  hitCount: number;
  tickCount: number;
  icon: string;
}

/** Healing 테이블 항목 (DamageTableEntry와 구조 동일, overheal 추가) */
export interface HealingTableEntry {
  name: string;
  guid: number;
  type: number;
  total: number;
  totalReduced: number;
  hitCount: number;
  tickCount: number;
  icon: string;
  overheal: number;
}
