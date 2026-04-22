import { describe, it, expect } from "vitest";
import { SpellResolver, getIconUrl } from "../resolver";

describe("getIconUrl", () => {
  it("올바른 URL 생성", () => {
    expect(getIconUrl("inv_12_dh_void_ability_consume")).toBe(
      "https://wow.zamimg.com/images/wow/icons/medium/inv_12_dh_void_ability_consume.jpg"
    );
  });

  it("사이즈 옵션", () => {
    expect(getIconUrl("test_icon", "large")).toContain("/large/");
    expect(getIconUrl("test_icon", "small")).toContain("/small/");
  });
});

describe("SpellResolver", () => {
  it("로컬 이름 등록", () => {
    const resolver = new SpellResolver();
    resolver.registerLocal(473662, "흡수");

    const spell = resolver.get(473662);
    expect(spell).toBeDefined();
    expect(spell!.localName).toBe("흡수");
    expect(spell!.icon).toBe(""); // 아직 Wowhead 미조회
  });

  it("캐시 내보내기/가져오기", () => {
    const resolver1 = new SpellResolver();
    resolver1.registerLocal(473662, "흡수");

    const json = resolver1.exportCache();

    const resolver2 = new SpellResolver();
    resolver2.importCache(json);

    const spell = resolver2.get(473662);
    expect(spell).toBeDefined();
    expect(spell!.localName).toBe("흡수");
  });

  it("simcName 검색", () => {
    const resolver = new SpellResolver();
    // 수동으로 캐시에 넣기
    resolver.importCache(JSON.stringify({
      473662: {
        id: 473662,
        name: "Consume",
        simcName: "consume",
        localName: "흡수",
        icon: "inv_12_dh_void_ability_consume",
        iconUrl: "https://wow.zamimg.com/images/wow/icons/medium/inv_12_dh_void_ability_consume.jpg",
      },
    }));

    const found = resolver.findBySimcName("consume");
    expect(found).toBeDefined();
    expect(found!.id).toBe(473662);
    expect(found!.localName).toBe("흡수");

    const notFound = resolver.findBySimcName("nonexistent");
    expect(notFound).toBeNull();
  });
});

// Wowhead API 실제 호출 테스트 (네트워크 필요)
describe("SpellResolver - Wowhead API", () => {
  it("실제 스펠 조회", async () => {
    const resolver = new SpellResolver();
    const spell = await resolver.resolve(473662, "흡수");

    expect(spell.id).toBe(473662);
    expect(spell.name).toBe("Consume");
    expect(spell.simcName).toBe("consume");
    expect(spell.localName).toBe("흡수");
    expect(spell.icon).toBe("inv_12_dh_void_ability_consume");
    expect(spell.iconUrl).toContain("inv_12_dh_void_ability_consume");

    console.log("스펠 메타:", spell);
  });

  it("보리차 로그의 모든 스펠 일괄 조회", async () => {
    const resolver = new SpellResolver();
    const spells = [
      { id: 473662, localName: "흡수" },
      { id: 1223412, localName: "영혼 파편" },
      { id: 473728, localName: "공허 광선" },
      { id: 1221150, localName: "붕괴하는 별" },
      { id: 1217610, localName: "집어삼키기" },
      { id: 1226019, localName: "수확" },
    ];

    await resolver.resolveMany(spells);
    const cache = resolver.getAll();

    console.log("\n=== 스펠 매핑 결과 ===");
    for (const s of spells) {
      const meta = cache[s.id];
      console.log(`${s.localName} → ${meta?.name} (${meta?.simcName}) | 아이콘: ${meta?.icon}`);
    }

    // 모든 스펠이 해석되었는지 확인
    for (const s of spells) {
      const meta = cache[s.id];
      expect(meta).toBeDefined();
      expect(meta!.name).toBeTruthy();
      expect(meta!.icon).toBeTruthy();
      expect(meta!.simcName).toBeTruthy();
    }
  });
});
