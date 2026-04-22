// ============================================
// WoW 기본 특성 이름 목록 + 한글 매핑
// 여기에 없는 spec 이름 = 영웅특성 (heroTalents.ts로 위임)
// ============================================

import { heroTalentNameKr } from "./heroTalents";

/** 모든 직업의 기본 특성 이름 (영어, 소문자) */
export const BASE_SPEC_NAMES = new Set([
  // Death Knight
  "blood", "frost", "unholy",
  // Demon Hunter
  "havoc", "vengeance", "devourer",
  // Druid
  "balance", "feral", "guardian", "restoration",
  // Evoker
  "devastation", "preservation", "augmentation",
  // Hunter
  "beast mastery", "beastmastery", "marksmanship", "survival",
  // Mage
  "arcane", "fire", "frost",
  // Monk
  "brewmaster", "mistweaver", "windwalker",
  // Paladin
  "holy", "protection", "retribution",
  // Priest
  "discipline", "holy", "shadow",
  // Rogue
  "assassination", "outlaw", "subtlety",
  // Shaman
  "elemental", "enhancement", "restoration",
  // Warlock
  "affliction", "demonology", "destruction",
  // Warrior
  "arms", "fury", "protection",
]);

/**
 * 기본 특성 영문명(소문자/공백 제거) → 한글명
 * 예: "beastmastery" → "야수", "havoc" → "파멸"
 * 같은 키가 여러 직업에 공유되면 한 가지 한글을 사용 (frost/holy/restoration 등)
 */
const BASE_SPEC_KR: Record<string, string> = {
  // Death Knight
  blood: "혈기", unholy: "부정",
  // Demon Hunter
  havoc: "파멸", vengeance: "복수", devourer: "포식",
  // Druid
  balance: "조화", feral: "야성", guardian: "수호",
  // Evoker
  devastation: "황폐", preservation: "보존", augmentation: "증강",
  // Hunter
  beastmastery: "야수", marksmanship: "사격", survival: "생존",
  // Mage
  arcane: "비전", fire: "화염",
  // Monk
  brewmaster: "양조", mistweaver: "운무", windwalker: "풍운",
  // Paladin
  retribution: "징벌",
  // Priest
  discipline: "수양", shadow: "암흑",
  // Rogue
  assassination: "암살", outlaw: "무법", subtlety: "잠행",
  // Shaman
  elemental: "정기", enhancement: "고양",
  // Warlock
  affliction: "고통", demonology: "악마", destruction: "파괴",
  // Warrior
  arms: "무기", fury: "분노",
  // 공용 (여러 직업)
  frost: "냉기",
  holy: "신성",
  protection: "보호",
  restoration: "회복",
};

/**
 * spec 이름이 기본 특성인지 영웅특성인지 판별
 * @returns { isHeroTalent: 영웅특성이면 true }
 */
export function classifySpec(specName: string): { isHeroTalent: boolean } {
  if (!specName) return { isHeroTalent: false };
  return { isHeroTalent: !BASE_SPEC_NAMES.has(specName.toLowerCase()) };
}

/**
 * 영문 spec 이름을 한글로 변환 (UI 표시용).
 * 기본 특성이면 BASE_SPEC_KR, 영웅특성이면 heroTalents의 한글 매핑 사용.
 * 매핑 없으면 영문 그대로 반환.
 */
export function specNameKr(englishName: string): string {
  if (!englishName) return "";
  const key = englishName.toLowerCase().replace(/[\s\-_]/g, "");
  const base = BASE_SPEC_KR[key];
  if (base) return base;
  return heroTalentNameKr(englishName);
}

/**
 * 힐러 기본 전문화 집합.
 * "restoration"(Druid+Shaman), "holy"(Paladin+Priest)는 양쪽 직업 모두 힐러라 단독으로도 판별 가능.
 * "discipline"/"mistweaver"/"preservation"은 원래 1개 직업 전용.
 * 영웅특성명(Oracle, Wildstalker 등)은 딜/탱 스펙과 공유되는 경우가 많아 여기서 판별하지 않음.
 * 판별 실패 시 UI의 DPS/HPS 토글로 수동 전환 가능하므로 안전.
 */
const HEALER_SPECS = new Set([
  "restoration",
  "holy",
  "discipline",
  "mistweaver",
  "preservation",
]);

/**
 * 주어진 spec 이름이 힐러 기본 전문화인지 여부.
 * 대소문자·공백·하이픈·언더스코어 무시.
 */
export function isHealerSpec(specName: string): boolean {
  if (!specName) return false;
  const key = specName.toLowerCase().replace(/[\s\-_]/g, "");
  return HEALER_SPECS.has(key);
}
