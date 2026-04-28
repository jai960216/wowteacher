import { describe, it, expect } from "vitest";
import { pickBossActorIds } from "../bossTimeline";
import type { WCLReportInfo } from "../../wcl/api";

type Npc = WCLReportInfo["npcs"][number];

function mkNpc(over: Partial<Npc> & Pick<Npc, "id">): Npc {
  return {
    name: "",
    type: "NPC",
    subType: "",
    ...over,
  };
}

describe("pickBossActorIds", () => {
  it("subType=Boss 단독 매칭 — 해당 fight 보스만 잡음", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 10, name: "Vexie", subType: "Boss" }),
      mkNpc({ id: 20, name: "Goblin Mechanic", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "Vexie & The Geargrinder");
    expect(out.has(10)).toBe(true);
    expect(out.has(20)).toBe(false);
  });

  it("fight name 부분 일치 fallback 단독 (subType 없는 보스)", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 10, name: "Vexie", subType: "" }),
      mkNpc({ id: 11, name: "The Geargrinder", subType: "" }),
      mkNpc({ id: 20, name: "Goblin Mechanic", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "Vexie & The Geargrinder");
    expect(out.has(10)).toBe(true);
    expect(out.has(11)).toBe(true);
    expect(out.has(20)).toBe(false);
  });

  it("subType=Boss와 fight name 매칭이 동시에 있으면 합집합", () => {
    // 한 리포트에 다른 fight의 보스가 subType=Boss인 노이즈 케이스.
    // 현재 fight의 진짜 보스는 fight name 부분일치로 들어와야 함.
    const npcs: Npc[] = [
      // 다른 fight의 보스
      mkNpc({ id: 100, name: "OtherBoss", subType: "Boss" }),
      // 현재 fight의 진짜 보스 — subType 누락
      mkNpc({ id: 200, name: "Vexie", subType: "" }),
      mkNpc({ id: 201, name: "The Geargrinder", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "Vexie & The Geargrinder");
    // 합집합 — OtherBoss + Vexie + Geargrinder 모두 포함
    expect(out.has(100)).toBe(true);
    expect(out.has(200)).toBe(true);
    expect(out.has(201)).toBe(true);
  });

  it("다중 보스가 subType=Boss이고 fight name으로도 1건 추가 매칭 → 합집합", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "Vexie", subType: "Boss" }),
      mkNpc({ id: 2, name: "The Geargrinder", subType: "Boss" }),
      // subType은 누락됐지만 NPC name이 fight name의 substring → fallback 매칭
      mkNpc({ id: 3, name: "Vexie", subType: "" }),
      mkNpc({ id: 99, name: "Random Add", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "Vexie & The Geargrinder");
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(true);
    expect(out.has(3)).toBe(true);
    expect(out.has(99)).toBe(false);
  });

  it("짧은 fight name (length < 3) 거부 — 노이즈 방지", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "Random Mob With Lots Of Words", subType: "" }),
    ];
    // length 2 → fallback 매칭 비활성화
    const out = pickBossActorIds(npcs, "AB");
    expect(out.size).toBe(0);
  });

  it("매칭 0건 → 빈 Set", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "Goblin", subType: "" }),
      mkNpc({ id: 2, name: "Mechanic", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "TotallyDifferentBossName");
    expect(out.size).toBe(0);
  });

  it("한글 fight name → 한글 NPC 부분일치", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "벡시", subType: "" }),
      mkNpc({ id: 2, name: "기어그라인더", subType: "" }),
      mkNpc({ id: 3, name: "잡몹", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "벡시와 기어그라인더");
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(true);
    expect(out.has(3)).toBe(false);
  });

  it("환경 NPC (World, Environment, Unknown)는 subType=Boss여도 거부", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "World", subType: "Boss" }),
      mkNpc({ id: 2, name: "Environment", subType: "Boss" }),
      mkNpc({ id: 3, name: "Unknown", subType: "Boss" }),
      mkNpc({ id: 4, name: "RealBoss", subType: "Boss" }),
    ];
    const out = pickBossActorIds(npcs, "RealBoss");
    expect(out.has(1)).toBe(false);
    expect(out.has(2)).toBe(false);
    expect(out.has(3)).toBe(false);
    expect(out.has(4)).toBe(true);
  });

  it("환경 NPC는 fight name fallback에서도 거부", () => {
    // fightName이 짧지만 NPC name이 World라서 부분 일치할 수 있는 가상 케이스
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "World", subType: "" }),
      mkNpc({ id: 2, name: "Worldbreaker", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "Worldbreaker");
    expect(out.has(1)).toBe(false);
    expect(out.has(2)).toBe(true);
  });

  it("빈 fightName + subType=Boss만 있을 때 — Boss만 반환", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "BossOnly", subType: "Boss" }),
      mkNpc({ id: 2, name: "Add", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "");
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(false);
  });

  it("name이 비어있는 NPC는 fallback에서 무시", () => {
    const npcs: Npc[] = [
      mkNpc({ id: 1, name: "", subType: "" }),
      mkNpc({ id: 2, name: "Vexie", subType: "" }),
    ];
    const out = pickBossActorIds(npcs, "Vexie");
    expect(out.has(1)).toBe(false);
    expect(out.has(2)).toBe(true);
  });
});
