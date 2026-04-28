import { describe, it, expect } from "vitest";
import { buildBossSnapshots, buildPhaseMarkers, classifyMech } from "../bossTimeline";
import type { WCLBossCastEvent, PhaseTransition } from "../../wcl/api";

const FIGHT_START = 1_000_000; // ms

function mkCast(over: Partial<WCLBossCastEvent> = {}): WCLBossCastEvent {
  return {
    timestamp: FIGHT_START,
    sourceID: 1,
    abilityGameID: 100,
    abilityName: "Test Spell",
    abilityIcon: "",
    fight: 1,
    ...over,
  };
}

describe("classifyMech", () => {
  it("키워드 화이트리스트 매칭은 major", () => {
    expect(classifyMech("Decimate")).toBe("major");
    expect(classifyMech("Annihilation")).toBe("major");
    expect(classifyMech("Obliterate Soul")).toBe("major");
    expect(classifyMech("Void Storm")).toBe("major");
    expect(classifyMech("Phase Transition")).toBe("major");
    expect(classifyMech("Berserk")).toBe("major");
    expect(classifyMech("Enrage")).toBe("major");
  });

  it("키워드 미매칭은 normal", () => {
    expect(classifyMech("Melee")).toBe("normal");
    expect(classifyMech("Auto Attack")).toBe("normal");
    expect(classifyMech("Shadow Bolt")).toBe("normal");
    expect(classifyMech("")).toBe("normal");
  });

  it("대소문자 무관", () => {
    expect(classifyMech("ANNIHILATION")).toBe("major");
    expect(classifyMech("annihilation")).toBe("major");
    expect(classifyMech("AnNiHiLaTiOn")).toBe("major");
  });
});

describe("buildBossSnapshots", () => {
  const npcNameMap = new Map<number, string>([[1, "Boss"], [2, "Add"]]);
  const abilityMap: Record<number, string> = {};

  it("bossActorIds에 없는 sourceID는 제외", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ sourceID: 1, abilityGameID: 100, abilityName: "BossSpell" }),
      mkCast({ sourceID: 2, abilityGameID: 200, abilityName: "AddSpell" }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out).toHaveLength(1);
    expect(out[0].spellId).toBe(100);
  });

  it("timestamp는 fightStart 기준 초로 정규화", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ timestamp: FIGHT_START + 0 }),
      mkCast({ timestamp: FIGHT_START + 30_000, abilityGameID: 101 }),
      mkCast({ timestamp: FIGHT_START + 90_500, abilityGameID: 102 }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out[0].timestamp).toBe(0);
    expect(out[1].timestamp).toBe(30);
    expect(out[2].timestamp).toBe(90.5);
  });

  it("0.3s 이내 같은 spellId 연속은 디듀프", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ timestamp: FIGHT_START + 10_000, abilityGameID: 100 }),
      mkCast({ timestamp: FIGHT_START + 10_100, abilityGameID: 100 }),
      mkCast({ timestamp: FIGHT_START + 10_200, abilityGameID: 100 }),
      mkCast({ timestamp: FIGHT_START + 11_000, abilityGameID: 100 }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out).toHaveLength(2);
    expect(out[0].timestamp).toBe(10);
    expect(out[1].timestamp).toBe(11);
  });

  it("디듀프는 같은 spellId만 — 다른 spell은 인접해도 유지", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ timestamp: FIGHT_START + 5_000, abilityGameID: 100 }),
      mkCast({ timestamp: FIGHT_START + 5_100, abilityGameID: 101 }),
      mkCast({ timestamp: FIGHT_START + 5_200, abilityGameID: 102 }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out).toHaveLength(3);
  });

  it("입력이 시간 역순이어도 정렬 후 디듀프", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ timestamp: FIGHT_START + 11_000, abilityGameID: 100 }),
      mkCast({ timestamp: FIGHT_START + 10_100, abilityGameID: 100 }),
      mkCast({ timestamp: FIGHT_START + 10_000, abilityGameID: 100 }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out).toHaveLength(2);
    expect(out[0].timestamp).toBe(10);
    expect(out[1].timestamp).toBe(11);
  });

  it("abilityName 비어있으면 abilityMap 폴백, 그것도 없으면 #ID", () => {
    const bossIds = new Set([1]);
    const map = { 200: "MappedName" };
    const raw = [
      mkCast({ abilityGameID: 200, abilityName: "" }),
      mkCast({ abilityGameID: 300, abilityName: "" }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, map);
    expect(out[0].spellName).toBe("MappedName");
    expect(out[1].spellName).toBe("#300");
  });

  it("iconUrl: 비어있으면 undefined, http면 그대로, slug면 zamimg URL", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ abilityGameID: 100, abilityIcon: "" }),
      mkCast({ abilityGameID: 101, abilityIcon: "https://example.com/x.jpg" }),
      mkCast({ abilityGameID: 102, abilityIcon: "spell_shadow_test" }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out[0].iconUrl).toBeUndefined();
    expect(out[1].iconUrl).toBe("https://example.com/x.jpg");
    expect(out[2].iconUrl).toBe("https://wow.zamimg.com/images/wow/icons/large/spell_shadow_test.jpg");
  });

  it("sourceName은 npcNameMap에서, 미매칭 시 '보스'", () => {
    const bossIds = new Set([1, 99]);
    const raw = [
      mkCast({ sourceID: 1 }),
      mkCast({ sourceID: 99, abilityGameID: 101 }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out[0].sourceName).toBe("Boss");
    expect(out[1].sourceName).toBe("보스");
  });

  it("빈 입력 → 빈 배열", () => {
    const out = buildBossSnapshots([], FIGHT_START, new Set([1]), npcNameMap, abilityMap);
    expect(out).toEqual([]);
  });

  it("bossActorIds 비어있으면 모두 필터", () => {
    const raw = [mkCast(), mkCast({ abilityGameID: 101 })];
    const out = buildBossSnapshots(raw, FIGHT_START, new Set(), npcNameMap, abilityMap);
    expect(out).toEqual([]);
  });

  it("mechClass는 spellName 분류 결과 반영", () => {
    const bossIds = new Set([1]);
    const raw = [
      mkCast({ abilityGameID: 100, abilityName: "Annihilation" }),
      mkCast({ abilityGameID: 101, abilityName: "Melee", timestamp: FIGHT_START + 1000 }),
    ];
    const out = buildBossSnapshots(raw, FIGHT_START, bossIds, npcNameMap, abilityMap);
    expect(out[0].mechClass).toBe("major");
    expect(out[1].mechClass).toBe("normal");
  });
});

describe("buildPhaseMarkers", () => {
  it("ms 절대값을 fightStart 기준 초로 변환", () => {
    const raw: PhaseTransition[] = [
      { id: 1, startTime: FIGHT_START + 0 },
      { id: 2, startTime: FIGHT_START + 60_000 },
      { id: 3, startTime: FIGHT_START + 120_000 },
    ];
    const markers = buildPhaseMarkers(raw, FIGHT_START);
    expect(markers).toHaveLength(3);
    expect(markers[0]).toEqual({ timeSec: 0, phaseId: 1, label: "P1" });
    expect(markers[1]).toEqual({ timeSec: 60, phaseId: 2, label: "P2" });
    expect(markers[2]).toEqual({ timeSec: 120, phaseId: 3, label: "P3" });
  });

  it("시간 역순 입력은 정렬됨", () => {
    const raw: PhaseTransition[] = [
      { id: 3, startTime: FIGHT_START + 120_000 },
      { id: 1, startTime: FIGHT_START + 0 },
      { id: 2, startTime: FIGHT_START + 60_000 },
    ];
    const markers = buildPhaseMarkers(raw, FIGHT_START);
    expect(markers.map(m => m.phaseId)).toEqual([1, 2, 3]);
  });

  it("fightStart 이전 timestamp는 0으로 클램프", () => {
    const raw: PhaseTransition[] = [
      { id: 1, startTime: FIGHT_START - 5000 },
    ];
    const markers = buildPhaseMarkers(raw, FIGHT_START);
    expect(markers[0].timeSec).toBe(0);
  });

  it("빈 입력 → 빈 배열 (단일 페이즈 보스)", () => {
    expect(buildPhaseMarkers([], FIGHT_START)).toEqual([]);
  });
});
