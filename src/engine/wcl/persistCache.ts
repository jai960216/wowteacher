// ============================================
// TTL 기반 localStorage 캐시 유틸
// ============================================
// 세션 간에도 보존돼 페이지 새로고침 시 WCL 쿼리 재사용.
// - Map<string, Promise<T>>의 inflight 병합은 그대로 유지 (메모리)
// - 해결된 값은 이곳에 직렬화해서 저장 (저장소)

interface Entry<T> {
  v: T;
  at: number;      // 저장 시각 (ms)
  ttl: number;     // TTL (ms)
}

export class PersistCache<T> {
  private prefix: string;
  private defaultTTL: number;

  constructor(prefix: string, defaultTTL: number) {
    this.prefix = prefix;
    this.defaultTTL = defaultTTL;
  }

  private k(key: string): string {
    return `wcl_cache:${this.prefix}:${key}`;
  }

  get(key: string): T | null {
    try {
      const raw = localStorage.getItem(this.k(key));
      if (!raw) return null;
      const entry = JSON.parse(raw) as Entry<T>;
      if (Date.now() - entry.at > entry.ttl) {
        localStorage.removeItem(this.k(key));
        return null;
      }
      return entry.v;
    } catch {
      return null;
    }
  }

  set(key: string, value: T, ttl?: number): void {
    const entry: Entry<T> = { v: value, at: Date.now(), ttl: ttl ?? this.defaultTTL };
    try {
      localStorage.setItem(this.k(key), JSON.stringify(entry));
    } catch {
      // quota 초과 → 같은 prefix 전체 비우고 재시도
      this.clear();
      try { localStorage.setItem(this.k(key), JSON.stringify(entry)); } catch { /* 포기 */ }
    }
  }

  delete(key: string): void {
    try { localStorage.removeItem(this.k(key)); } catch { /* 무시 */ }
  }

  clear(): void {
    const myPrefix = `wcl_cache:${this.prefix}:`;
    const keysToDelete: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(myPrefix)) keysToDelete.push(k);
      }
      for (const k of keysToDelete) localStorage.removeItem(k);
    } catch { /* 무시 */ }
  }
}

/** 모든 WCL 캐시 prefix를 한 번에 비움 (로그아웃·수동 초기화 용). */
export function clearAllPersistCaches(): void {
  const prefix = "wcl_cache:";
  const keysToDelete: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keysToDelete.push(k);
    }
    for (const k of keysToDelete) localStorage.removeItem(k);
  } catch { /* 무시 */ }
}
