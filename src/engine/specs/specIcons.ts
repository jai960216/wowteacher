// ============================================
// 기본 전문화(spec) → Wowhead 아이콘 slug 매핑
// ============================================
// URL 패턴: https://wow.zamimg.com/images/wow/icons/medium/{slug}.jpg
// 같은 이름 spec이 여러 직업에 있으므로 "class:spec" 조합 키 사용.

const SPEC_ICON_SLUG: Record<string, string> = {
  // Death Knight
  "deathknight:blood": "spell_deathknight_bloodpresence",
  "deathknight:frost": "spell_deathknight_frostpresence",
  "deathknight:unholy": "spell_deathknight_unholypresence",

  // Demon Hunter — Devourer는 로컬 커스텀 아이콘(public/icons)
  "demonhunter:havoc": "ability_demonhunter_specdps",
  "demonhunter:vengeance": "ability_demonhunter_spectank",
  "demonhunter:devourer": "/icons/포식.webp",

  // Druid
  "druid:balance": "spell_nature_starfall",
  "druid:feral": "ability_druid_catform",
  "druid:guardian": "ability_racial_bearform",
  "druid:restoration": "spell_nature_healingtouch",

  // Evoker
  "evoker:devastation": "classicon_evoker_devastation",
  "evoker:preservation": "classicon_evoker_preservation",
  "evoker:augmentation": "classicon_evoker_augmentation",

  // Hunter
  "hunter:beastmastery": "ability_hunter_bestialdiscipline",
  "hunter:marksmanship": "ability_hunter_focusedaim",
  "hunter:survival": "ability_hunter_camouflage",

  // Mage
  "mage:arcane": "spell_holy_magicalsentry",
  "mage:fire": "spell_fire_firebolt02",
  "mage:frost": "spell_frost_frostbolt02",

  // Monk
  "monk:brewmaster": "spell_monk_brewmaster_spec",
  "monk:mistweaver": "spell_monk_mistweaver_spec",
  "monk:windwalker": "spell_monk_windwalker_spec",

  // Paladin
  "paladin:holy": "spell_holy_holybolt",
  "paladin:protection": "ability_paladin_shieldofthetemplar",
  "paladin:retribution": "spell_holy_auraoflight",

  // Priest
  "priest:discipline": "spell_holy_powerwordshield",
  "priest:holy": "spell_holy_guardianspirit",
  "priest:shadow": "spell_shadow_shadowwordpain",

  // Rogue
  "rogue:assassination": "ability_rogue_eviscerate",
  "rogue:outlaw": "ability_rogue_waylay",
  "rogue:subtlety": "ability_stealth",

  // Shaman
  "shaman:elemental": "spell_nature_lightning",
  "shaman:enhancement": "spell_shaman_improvedstormstrike",
  "shaman:restoration": "spell_nature_magicimmunity",

  // Warlock
  "warlock:affliction": "spell_shadow_deathcoil",
  "warlock:demonology": "spell_shadow_metamorphosis",
  "warlock:destruction": "spell_shadow_rainoffire",

  // Warrior
  "warrior:arms": "ability_warrior_savageblow",
  "warrior:fury": "ability_warrior_innerrage",
  "warrior:protection": "ability_warrior_defensivestance",
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_']/g, "");
}

/**
 * 스펙 아이콘 URL 반환.
 * 매핑 값이 "/" 또는 "http" 로 시작하면 그대로 반환 (로컬/외부 URL),
 * 아니면 wowhead slug로 간주하고 zamimg URL 조립.
 * 매핑 없으면 빈 문자열 — 호출 측에서 직업 아이콘으로 fallback.
 */
export function getSpecIconUrl(className: string, specName: string): string {
  if (!className || !specName) return "";
  const key = `${normalize(className)}:${normalize(specName)}`;
  const value = SPEC_ICON_SLUG[key];
  if (!value) return "";
  if (value.startsWith("/") || value.startsWith("http")) return value;
  return `https://wow.zamimg.com/images/wow/icons/medium/${value}.jpg`;
}
