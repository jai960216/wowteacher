// ============================================
// LRUPersistCache — 무거운 events 응답 전용 localStorage LRU 캐시
// ============================================
// 기존 PersistCache(reportInfo·partition·combatantInfo)는 그대로 두고, 무거운 events
// 응답(getCasts·getBuffs·getResources·getDamageDone·getHealingDone·getDamageTable·
// getHealingTable·getFightPlayerIds·getDeaths·getExternalBuffEvents·getIncomingCasts)
// 만 단일 'events' prefix 아래 LRU + 8MB cap으로 관리.
//
// 단일 prefix 전략 이유: prefix별로 따로 cap을 두면 8MB×N = 수십 MB로 localStorage
// 10MB 한도 초과. 하나의 cap 안에서 LRU 경쟁이 quota-safe. 키 자체에 함수 식별자 포함.
//
// 함정 대응:
// - QuotaExceededError: 50% 까지 evict 후 재시도, 두 번째 실패 시 swallow
// - 동시 탭 race: index 미존재 orphan은 evict 시 가장 오래된 것으로 자동 정리.
//   set 50회마다 lazy sweep으로 index 재계산
// - JSON.stringify 1회: 한 번만 stringify해서 그 결과를 setItem에 그대로 전달

interface LRUEntry<T> {
  v: T;
  at: number;       // 저장 시각 (ms)
  ttl: number;      // TTL (ms)
  ver: string;      // cacheVersion — 다른 버전이면 miss
  size: number;     // serialized 길이 (UTF-16 추정)
}

interface IndexRow {
  size: number;
  lastAccess: number;
}

interface LRUOptions {
  prefix: string;
  cacheVersion: string;
  maxBytes: number;
  defaultTTL: number;
}

export class LRUPersistCache {
  private readonly prefix: string;
  private readonly cacheVersion: string;
  private readonly maxBytes: number;
  private readonly defaultTTL: number;
  private readonly indexKey: string;
  private readonly keyPrefix: string;
  private setCount = 0;
  // 같은 ms 안의 여러 호출에서도 단조 증가 보장 — lastAccess는 Date.now()*1000 + seq.
  // localStorage 직렬화 후에도 비교만 가능하면 되므로 number로 충분.
  private accessSeq = 0;
  private static readonly SWEEP_INTERVAL = 50;

  constructor(opts: LRUOptions) {
    this.prefix = opts.prefix;
    this.cacheVersion = opts.cacheVersion;
    this.maxBytes = opts.maxBytes;
    this.defaultTTL = opts.defaultTTL;
    this.indexKey = `wcl_lru:${this.prefix}:_idx`;
    this.keyPrefix = `wcl_lru:${this.prefix}:`;
  }

  private k(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** 단조 증가 access stamp — 같은 ms 안의 동시 호출도 LRU 순서 보존 */
  private nextAccess(): number {
    return Date.now() * 1000 + (this.accessSeq++ & 0x3ff);
  }

  private readIndex(): Record<string, IndexRow> {
    try {
      const raw = localStorage.getItem(this.indexKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object") ? parsed as Record<string, IndexRow> : {};
    } catch {
      return {};
    }
  }

  private writeIndex(idx: Record<string, IndexRow>): void {
    try {
      localStorage.setItem(this.indexKey, JSON.stringify(idx));
    } catch {
      // index 자체가 quota를 넘기면 (드뭄) 빈 index로 리셋해 복구
      try { localStorage.removeItem(this.indexKey); } catch { /* 무시 */ }
    }
  }

  /**
   * localStorage iterate해서 실제 존재하는 키 기준으로 index 재구성.
   * 다른 탭이 동시에 set 해서 index와 어긋난 orphan 정리.
   * 비싸므로 set 50회마다 1회.
   */
  private sweep(): void {
    try {
      const idx = this.readIndex();
      const actual: Record<string, IndexRow> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(this.keyPrefix) || k === this.indexKey) continue;
        const logical = k.slice(this.keyPrefix.length);
        // index에 있던 lastAccess는 보존, 없으면 현재 시각 (orphan은 가장 최근으로 봐도 곧 evict 대상)
        const existing = idx[logical];
        let size = existing?.size ?? 0;
        if (!size) {
          // size 모르면 entry에서 추정
          try {
            const raw = localStorage.getItem(k);
            size = raw ? raw.length * 2 : 0;
          } catch { /* 무시 */ }
        }
        actual[logical] = {
          size,
          lastAccess: existing?.lastAccess ?? 0,  // orphan은 lastAccess 0 → 가장 오래된 것으로 evict 우선
        };
      }
      this.writeIndex(actual);
    } catch { /* 무시 — sweep 실패는 동작에 영향 없음 */ }
  }

  get<T>(key: string): T | null {
    let raw: string | null;
    try {
      raw = localStorage.getItem(this.k(key));
    } catch { return null; }
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as LRUEntry<T>;
      // 버전 미스매치 → 즉시 삭제
      if (entry.ver !== this.cacheVersion) {
        this.delete(key);
        return null;
      }
      // TTL 만료
      if (Date.now() - entry.at > entry.ttl) {
        this.delete(key);
        return null;
      }
      // touch — index의 lastAccess 갱신
      const idx = this.readIndex();
      const stamp = this.nextAccess();
      if (idx[key]) {
        idx[key].lastAccess = stamp;
        this.writeIndex(idx);
      } else {
        // orphan이었으면 보강
        idx[key] = { size: entry.size ?? raw.length * 2, lastAccess: stamp };
        this.writeIndex(idx);
      }
      return entry.v;
    } catch {
      // 파싱 실패한 깨진 항목 — 정리
      this.delete(key);
      return null;
    }
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const entry: LRUEntry<T> = {
      v: value,
      at: Date.now(),
      ttl: ttl ?? this.defaultTTL,
      ver: this.cacheVersion,
      size: 0,  // serialized 후 채움
    };
    let serialized: string;
    try {
      serialized = JSON.stringify(entry);
    } catch {
      return; // 직렬화 불가 — 조용히 포기
    }
    const byteLen = serialized.length * 2; // UTF-16 보수적 상한
    // entry.size를 실제 값으로 다시 박아 넣어 재직렬화 — 그래야 get 시 entry.size 신뢰 가능
    entry.size = byteLen;
    try {
      serialized = JSON.stringify(entry);
    } catch {
      return;
    }
    const finalLen = serialized.length * 2;

    // cap 초과 예측 → 70%까지 사전 evict
    const idx = this.readIndex();
    const currentTotal = Object.values(idx).reduce((s, r) => s + (r.size || 0), 0);
    if (currentTotal + finalLen > this.maxBytes) {
      this.evictUntil(idx, this.maxBytes * 0.7 - finalLen);
    }

    if (!this.tryWrite(key, serialized, finalLen, idx)) {
      // QuotaExceededError 등 — 현재 사용량의 50% 이하까지 공격적으로 evict 후 재시도.
      // (cap 기준이 아닌 실제 사용량 기준 — 다른 origin 데이터 등으로 cap 보다 적게 차도 quota 폭발 가능)
      const refreshed = this.readIndex();
      const total = Object.values(refreshed).reduce((s, r) => s + (r.size || 0), 0);
      this.evictUntil(refreshed, total * 0.5);
      if (!this.tryWrite(key, serialized, finalLen, refreshed)) {
        // 두 번째도 실패 → swallow + warn (저장 못해도 동작은 OK)
        if (typeof console !== "undefined") {
          console.warn(`[LRUPersistCache] set 실패 (quota): ${this.prefix}:${key}`);
        }
      }
    }

    this.setCount++;
    if (this.setCount >= LRUPersistCache.SWEEP_INTERVAL) {
      this.setCount = 0;
      this.sweep();
    }
  }

  private tryWrite(
    key: string,
    serialized: string,
    size: number,
    idx: Record<string, IndexRow>,
  ): boolean {
    try {
      localStorage.setItem(this.k(key), serialized);
      idx[key] = { size, lastAccess: this.nextAccess() };
      this.writeIndex(idx);
      return true;
    } catch {
      return false;
    }
  }

  /** lastAccess 오름차순(가장 오래된 것부터)으로 size 합 < target까지 제거 */
  private evictUntil(idx: Record<string, IndexRow>, targetBytes: number): void {
    if (targetBytes < 0) targetBytes = 0;
    const entries = Object.entries(idx)
      .map(([k, r]) => ({ k, size: r.size || 0, lastAccess: r.lastAccess || 0 }))
      .sort((a, b) => a.lastAccess - b.lastAccess);
    let total = entries.reduce((s, e) => s + e.size, 0);
    for (const e of entries) {
      if (total <= targetBytes) break;
      try { localStorage.removeItem(this.k(e.k)); } catch { /* 무시 */ }
      delete idx[e.k];
      total -= e.size;
    }
    this.writeIndex(idx);
  }

  delete(key: string): void {
    try { localStorage.removeItem(this.k(key)); } catch { /* 무시 */ }
    const idx = this.readIndex();
    if (idx[key]) {
      delete idx[key];
      this.writeIndex(idx);
    }
  }

  clear(): void {
    const keysToDelete: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.keyPrefix)) keysToDelete.push(k);
      }
      for (const k of keysToDelete) {
        try { localStorage.removeItem(k); } catch { /* 무시 */ }
      }
      try { localStorage.removeItem(this.indexKey); } catch { /* 무시 */ }
    } catch { /* 무시 */ }
  }
}

// ============================================
// 단일 events 인스턴스 — 모든 무거운 응답 공유
// ============================================

const DAY_MS = 24 * 60 * 60 * 1000;

export const eventsLru = new LRUPersistCache({
  prefix: "events",
  cacheVersion: ((import.meta.env.VITE_CACHE_VERSION as string | undefined) ?? "1"),
  maxBytes: 8 * 1024 * 1024,        // 8 MB
  defaultTTL: 30 * DAY_MS,           // 30일 (사망 fight events는 immutable)
});

export function clearEventsLru(): void {
  eventsLru.clear();
}
