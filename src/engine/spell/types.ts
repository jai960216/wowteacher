// ============================================
// Spell Metadata Types
// ============================================

/** 스펠 메타데이터 (Wowhead API에서 가져옴) */
export interface SpellMeta {
  /** 스펠 ID */
  id: number;
  /** 영문 이름 (SimC APL 매칭용) */
  name: string;
  /** SimC 스타일 이름 (소문자 + 언더스코어) */
  simcName: string;
  /** 한글 이름 (로그에서 추출) */
  localName: string;
  /** 아이콘 파일명 */
  icon: string;
  /** 아이콘 URL */
  iconUrl: string;
}

/** 스펠 ID → 메타데이터 캐시 */
export type SpellCache = Record<number, SpellMeta>;
