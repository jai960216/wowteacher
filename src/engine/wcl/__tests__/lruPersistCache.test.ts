import { describe, it, expect, beforeEach } from "vitest";
import { LRUPersistCache } from "../lruPersistCache";

// localStorage 모의 — Node 환경에서 vitest 기본은 window·localStorage 미정의.
// quota·동시 탭 race 시뮬레이션을 위해 capacity 제한 가능한 stub.
class FakeStorage {
  private store: Map<string, string> = new Map();
  private capacity: number = Infinity;

  get length(): number { return this.store.size; }
  key(i: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    // capacity는 byte 합으로 검사 (UTF-16 기준 length*2)
    let total = 0;
    for (const [kk, vv] of this.store) {
      if (kk === k) continue;
      total += vv.length * 2;
    }
    if (total + v.length * 2 > this.capacity) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.store.set(k, v);
  }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  setCapacity(b: number): void { this.capacity = b; }
}

const fakeLs = new FakeStorage();
// global 주입 — vitest 기본 환경(node)에선 globalThis.localStorage 미정의
(globalThis as unknown as { localStorage: FakeStorage }).localStorage = fakeLs;

function newCache(opts?: { ver?: string; maxBytes?: number; ttl?: number }) {
  return new LRUPersistCache({
    prefix: "test",
    cacheVersion: opts?.ver ?? "1",
    maxBytes: opts?.maxBytes ?? 1024 * 1024,
    defaultTTL: opts?.ttl ?? 30 * 24 * 60 * 60 * 1000,
  });
}

describe("LRUPersistCache 기본 동작", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("set 후 get 가능", () => {
    const c = newCache();
    c.set("k1", { hello: "world" });
    expect(c.get<{ hello: string }>("k1")).toEqual({ hello: "world" });
  });

  it("miss 시 null", () => {
    const c = newCache();
    expect(c.get("nope")).toBeNull();
  });

  it("delete 후 miss", () => {
    const c = newCache();
    c.set("k1", "v1");
    c.delete("k1");
    expect(c.get("k1")).toBeNull();
  });

  it("clear 시 모든 항목 + index 제거", () => {
    const c = newCache();
    c.set("k1", "v1");
    c.set("k2", "v2");
    c.clear();
    expect(c.get("k1")).toBeNull();
    expect(c.get("k2")).toBeNull();
    // index 키도 제거됐는지 — fakeLs 직접 확인
    expect(fakeLs.getItem("wcl_lru:test:_idx")).toBeNull();
  });
});

describe("LRUPersistCache TTL", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("TTL 만료 시 null 반환 + 자동 삭제", () => {
    const c = newCache({ ttl: 10 });
    c.set("k1", "v1");
    expect(c.get("k1")).toBe("v1");
    // 시간 경과 시뮬레이션 — fakeLs의 entry at을 직접 조작
    const raw = fakeLs.getItem("wcl_lru:test:k1")!;
    const entry = JSON.parse(raw);
    entry.at = Date.now() - 1000;
    fakeLs.setItem("wcl_lru:test:k1", JSON.stringify(entry));
    expect(c.get("k1")).toBeNull();
    // 자동 삭제 확인
    expect(fakeLs.getItem("wcl_lru:test:k1")).toBeNull();
  });
});

describe("LRUPersistCache 버전 미스매치", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("다른 버전으로 만든 entry는 다른 캐시에서 null + 삭제", () => {
    const c1 = newCache({ ver: "1" });
    c1.set("k1", "v1");
    expect(c1.get("k1")).toBe("v1");

    // ver "2"로 새 캐시 인스턴스 생성 — entry.ver="1"은 이제 stale
    const c2 = newCache({ ver: "2" });
    expect(c2.get("k1")).toBeNull();
    // 자동 삭제 확인
    expect(fakeLs.getItem("wcl_lru:test:k1")).toBeNull();
  });
});

describe("LRUPersistCache LRU evict (cap 초과)", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("cap 초과 시 가장 오래된 항목부터 제거", () => {
    // 작은 cap으로 테스트 — 한 entry가 약 1KB가 되도록 큰 payload
    const big = "x".repeat(2000); // length*2 ≈ 4KB
    const c = newCache({ maxBytes: 16 * 1024 }); // 16KB → 약 4개 entry 한도

    c.set("k1", big);
    c.set("k2", big);
    c.set("k3", big);
    c.set("k4", big);
    c.set("k5", big);

    // k1·k2 정도는 evict 되어야 함 — 70% 타깃 = 11.2KB → 약 2~3개만 남음
    expect(c.get("k5")).toBe(big);
    expect(c.get("k4")).toBe(big);
    // 가장 오래된 k1은 evict 되었을 가능성 높음
    expect(c.get("k1")).toBeNull();
  });

  it("get 후 set은 LRU 갱신 — 최근 touch한 항목은 evict 안 됨", () => {
    const big = "x".repeat(2000);
    const c = newCache({ maxBytes: 16 * 1024 });

    c.set("k1", big);
    c.set("k2", big);
    c.set("k3", big);
    // k1을 touch
    c.get("k1");
    c.set("k4", big);
    c.set("k5", big);

    // k1은 최근 touch → 보존, k2가 oldest
    expect(c.get("k1")).toBe(big);
    expect(c.get("k2")).toBeNull();
  });
});

describe("LRUPersistCache QuotaExceededError 시뮬레이션", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("setItem QuotaExceededError 시 50%까지 evict 후 재시도", () => {
    const c = newCache({ maxBytes: 100 * 1024 }); // logical cap은 100KB
    fakeLs.setCapacity(20 * 1024); // 실제 storage는 20KB만 — set 도중 quota 폭발

    const big = "x".repeat(2000); // ~4KB
    // 여러 번 set → 결국 quota 초과되면 evict 후 재시도
    let lastWritten: string | null = null;
    for (let i = 0; i < 10; i++) {
      c.set(`k${i}`, big);
      lastWritten = `k${i}`;
    }
    // 마지막 set은 살아있어야 (quota fail 후 evict + 재시도 성공)
    expect(c.get(lastWritten!)).toBe(big);
  });

  it("evict해도 quota 못 맞추면 swallow (예외 안 던짐)", () => {
    const c = newCache({ maxBytes: 1024 * 1024 });
    fakeLs.setCapacity(0); // 어떤 setItem도 실패

    expect(() => c.set("k1", "v1")).not.toThrow();
    expect(c.get("k1")).toBeNull();
  });
});

describe("LRUPersistCache 깨진 데이터 방어", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("JSON 깨진 entry는 null + 자동 삭제", () => {
    const c = newCache();
    fakeLs.setItem("wcl_lru:test:k1", "{not json");
    expect(c.get("k1")).toBeNull();
    expect(fakeLs.getItem("wcl_lru:test:k1")).toBeNull();
  });

  it("orphan key (index에 없으나 storage에 있음) — get 시 index 보강", () => {
    const c = newCache();
    // 직접 entry 주입, index에는 등록 안 함
    const entry = { v: "orphan", at: Date.now(), ttl: 1e10, ver: "1", size: 100 };
    fakeLs.setItem("wcl_lru:test:orphan-key", JSON.stringify(entry));

    expect(c.get<string>("orphan-key")).toBe("orphan");
    // get이 index에 보강했는지
    const idx = JSON.parse(fakeLs.getItem("wcl_lru:test:_idx")!);
    expect(idx["orphan-key"]).toBeDefined();
  });
});

describe("LRUPersistCache prefix 격리", () => {
  beforeEach(() => { fakeLs.clear(); fakeLs.setCapacity(Infinity); });

  it("다른 prefix는 서로 영향 없음", () => {
    const a = new LRUPersistCache({
      prefix: "events", cacheVersion: "1",
      maxBytes: 1024 * 1024, defaultTTL: 1e10,
    });
    const b = new LRUPersistCache({
      prefix: "other", cacheVersion: "1",
      maxBytes: 1024 * 1024, defaultTTL: 1e10,
    });
    a.set("shared", "from-a");
    b.set("shared", "from-b");
    expect(a.get("shared")).toBe("from-a");
    expect(b.get("shared")).toBe("from-b");

    a.clear();
    expect(a.get("shared")).toBeNull();
    expect(b.get("shared")).toBe("from-b"); // 다른 prefix는 영향 없음
  });
});
