import { describe, it, expect, beforeEach } from "vitest";
import {
  makeAnalysisKey,
  getAnalysis,
  setAnalysis,
  clearAnalysisCache,
  _analysisCacheSize,
} from "../analysisResultCache";
import type { FullAnalysis } from "../../analysis/types";

// FullAnalysis는 깊은 객체라 테스트엔 최소 stub만
function stub(name: string): FullAnalysis {
  return { playerName: name } as unknown as FullAnalysis;
}

describe("makeAnalysisKey", () => {
  beforeEach(() => clearAnalysisCache());

  it("같은 params면 같은 키", () => {
    const params = {
      myReportCode: "abc", myFightId: 1,
      refReportCode: "xyz", refFightId: 2,
      myPlayerId: 10, refPlayerId: 20,
      metric: "dps" as const, cacheVersion: "1",
    };
    expect(makeAnalysisKey(params)).toBe(makeAnalysisKey(params));
  });

  it("metric만 달라져도 키가 다름", () => {
    const base = {
      myReportCode: "abc", myFightId: 1,
      refReportCode: "xyz", refFightId: 2,
      myPlayerId: 10, refPlayerId: 20,
      cacheVersion: "1",
    };
    expect(makeAnalysisKey({ ...base, metric: "dps" }))
      .not.toBe(makeAnalysisKey({ ...base, metric: "hps" }));
  });

  it("cacheVersion 다르면 키 다름 (시즌 전환 시 자동 무효화)", () => {
    const base = {
      myReportCode: "abc", myFightId: 1,
      refReportCode: "xyz", refFightId: 2,
      myPlayerId: 10, refPlayerId: 20,
      metric: "dps" as const,
    };
    expect(makeAnalysisKey({ ...base, cacheVersion: "1" }))
      .not.toBe(makeAnalysisKey({ ...base, cacheVersion: "2" }));
  });

  it("ref player 다르면 키 다름", () => {
    const base = {
      myReportCode: "abc", myFightId: 1,
      refReportCode: "xyz", refFightId: 2,
      myPlayerId: 10,
      metric: "dps" as const, cacheVersion: "1",
    };
    expect(makeAnalysisKey({ ...base, refPlayerId: 20 }))
      .not.toBe(makeAnalysisKey({ ...base, refPlayerId: 21 }));
  });
});

describe("AnalysisResultCache get/set", () => {
  beforeEach(() => clearAnalysisCache());

  it("set 후 get 가능", () => {
    setAnalysis("k1", stub("a"));
    expect(getAnalysis("k1")?.playerName).toBe("a");
  });

  it("miss 시 null", () => {
    expect(getAnalysis("nope")).toBeNull();
  });

  it("같은 key 재set 시 사이즈 유지 + 값 갱신", () => {
    setAnalysis("k1", stub("a"));
    setAnalysis("k1", stub("b"));
    expect(_analysisCacheSize()).toBe(1);
    expect(getAnalysis("k1")?.playerName).toBe("b");
  });

  it("clear 후 비어있음", () => {
    setAnalysis("k1", stub("a"));
    setAnalysis("k2", stub("b"));
    clearAnalysisCache();
    expect(_analysisCacheSize()).toBe(0);
    expect(getAnalysis("k1")).toBeNull();
  });
});

describe("AnalysisResultCache LRU evict (cap 20)", () => {
  beforeEach(() => clearAnalysisCache());

  it("21번째 set 시 가장 오래된 항목 evict", () => {
    for (let i = 0; i < 20; i++) setAnalysis(`k${i}`, stub(`v${i}`));
    expect(_analysisCacheSize()).toBe(20);
    expect(getAnalysis("k0")).not.toBeNull();

    // 새로 들어가면 k0이 가장 오래됨 → evict
    // (단 위에서 k0을 get했으므로 lastAccess 갱신됨, k1이 oldest)
    setAnalysis("k20", stub("v20"));
    expect(_analysisCacheSize()).toBe(20);
    expect(getAnalysis("k1")).toBeNull(); // evicted
    expect(getAnalysis("k0")).not.toBeNull(); // 보존
    expect(getAnalysis("k20")).not.toBeNull();
  });

  it("get은 LRU 순서를 갱신 (touch)", () => {
    for (let i = 0; i < 20; i++) setAnalysis(`k${i}`, stub(`v${i}`));
    // k0를 touch → 가장 최근으로
    getAnalysis("k0");
    setAnalysis("k20", stub("v20"));
    // 이제 oldest는 k1
    expect(getAnalysis("k1")).toBeNull();
    expect(getAnalysis("k0")).not.toBeNull();
  });

  it("동일 key 재set은 evict 안 일어남 (사이즈 유지)", () => {
    for (let i = 0; i < 20; i++) setAnalysis(`k${i}`, stub(`v${i}`));
    setAnalysis("k0", stub("v0-new"));
    expect(_analysisCacheSize()).toBe(20);
    // 모든 항목 그대로 살아있음
    for (let i = 0; i < 20; i++) {
      expect(getAnalysis(`k${i}`)).not.toBeNull();
    }
  });
});
