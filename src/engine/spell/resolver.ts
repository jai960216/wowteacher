import type { SpellMeta, SpellCache } from "./types";

// ============================================
// Spell Metadata Resolver
// ============================================
// 스펠 ID로 Wowhead API에서 아이콘, 영문 이름 등을 가져와서 캐싱
//
// 아이콘 URL: https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg
// 툴팁 API: https://nether.wowhead.com/tooltip/spell/{id}?dataEnv=1&locale=0

const WOWHEAD_TOOLTIP_URL = "https://nether.wowhead.com/tooltip/spell";
const ICON_BASE_URL = "https://wow.zamimg.com/images/wow/icons";

export type IconSize = "small" | "medium" | "large";

/**
 * 아이콘 URL 생성
 */
export function getIconUrl(iconName: string, size: IconSize = "medium"): string {
  return `${ICON_BASE_URL}/${size}/${iconName}.jpg`;
}

/**
 * 영문 스킬 이름을 SimC 스타일로 변환
 * "Void Ray" → "void_ray"
 */
function toSimcName(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Wowhead 툴팁 API에서 단일 스펠 메타데이터 조회
 */
async function fetchSpellFromWowhead(spellId: number): Promise<{ name: string; icon: string } | null> {
  try {
    const url = `${WOWHEAD_TOOLTIP_URL}/${spellId}?dataEnv=1&locale=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.name ?? "",
      icon: data.icon ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * 스펠 메타데이터 리졸버
 * - 로그에서 추출한 스펠 ID + 한글 이름으로 초기화
 * - Wowhead API에서 아이콘 + 영문 이름 가져옴
 * - 캐시하여 재사용
 */
export class SpellResolver {
  private cache: SpellCache = {};
  private pending: Map<number, Promise<SpellMeta | null>> = new Map();

  /**
   * 캐시에서 즉시 조회 (없으면 null)
   */
  get(spellId: number): SpellMeta | null {
    return this.cache[spellId] ?? null;
  }

  /**
   * 캐시의 모든 스펠 반환
   */
  getAll(): SpellCache {
    return { ...this.cache };
  }

  /**
   * 로그에서 추출한 스펠을 로컬 이름으로 미리 등록
   * (Wowhead 조회 전에도 한글 이름은 사용 가능)
   */
  registerLocal(spellId: number, localName: string): void {
    if (!this.cache[spellId]) {
      this.cache[spellId] = {
        id: spellId,
        name: "",
        simcName: "",
        localName,
        icon: "",
        iconUrl: "",
      };
    } else {
      this.cache[spellId].localName = localName;
    }
  }

  /**
   * 단일 스펠의 Wowhead 메타데이터 조회 + 캐시
   */
  async resolve(spellId: number, localName?: string): Promise<SpellMeta> {
    // 이미 완전히 해석됨
    if (this.cache[spellId]?.icon) {
      return this.cache[spellId];
    }

    // 이미 요청 중
    if (this.pending.has(spellId)) {
      const result = await this.pending.get(spellId)!;
      return result ?? this.makeFallback(spellId, localName ?? "");
    }

    const promise = this.fetchAndCache(spellId, localName ?? "");
    this.pending.set(spellId, promise);

    const result = await promise;
    this.pending.delete(spellId);
    return result ?? this.makeFallback(spellId, localName ?? "");
  }

  /**
   * 여러 스펠을 병렬로 조회
   */
  async resolveMany(spells: Array<{ id: number; localName: string }>): Promise<SpellCache> {
    // 배치를 청크로 나눠서 API 부하 줄이기
    const BATCH_SIZE = 10;
    for (let i = 0; i < spells.length; i += BATCH_SIZE) {
      const batch = spells.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((s) => this.resolve(s.id, s.localName))
      );
    }
    return this.getAll();
  }

  /**
   * 로그의 이벤트 목록에서 고유 스펠 추출 + 일괄 조회
   */
  async resolveFromLog(events: Array<{ spellId?: number; spellName?: string }>): Promise<SpellCache> {
    const unique = new Map<number, string>();
    for (const e of events) {
      if (e.spellId && e.spellName && !unique.has(e.spellId)) {
        unique.set(e.spellId, e.spellName);
      }
    }

    const spells = [...unique.entries()].map(([id, localName]) => ({ id, localName }));
    return this.resolveMany(spells);
  }

  /**
   * simcName으로 스펠 찾기 (APL 매칭용)
   */
  findBySimcName(simcName: string): SpellMeta | null {
    for (const spell of Object.values(this.cache)) {
      if (spell.simcName === simcName) return spell;
    }
    return null;
  }

  /**
   * 캐시를 JSON으로 내보내기 (오프라인 사용)
   */
  exportCache(): string {
    return JSON.stringify(this.cache, null, 2);
  }

  /**
   * JSON에서 캐시 복원
   */
  importCache(json: string): void {
    const data = JSON.parse(json) as SpellCache;
    for (const [id, meta] of Object.entries(data)) {
      this.cache[Number(id)] = meta;
    }
  }

  private async fetchAndCache(spellId: number, localName: string): Promise<SpellMeta | null> {
    const wowhead = await fetchSpellFromWowhead(spellId);
    if (!wowhead) return null;

    const meta: SpellMeta = {
      id: spellId,
      name: wowhead.name,
      simcName: toSimcName(wowhead.name),
      localName: localName || this.cache[spellId]?.localName || "",
      icon: wowhead.icon,
      iconUrl: wowhead.icon ? getIconUrl(wowhead.icon) : "",
    };

    this.cache[spellId] = meta;
    return meta;
  }

  private makeFallback(spellId: number, localName: string): SpellMeta {
    const existing = this.cache[spellId];
    if (existing) return existing;

    const fallback: SpellMeta = {
      id: spellId,
      name: localName,
      simcName: toSimcName(localName),
      localName,
      icon: "",
      iconUrl: "",
    };
    this.cache[spellId] = fallback;
    return fallback;
  }
}
