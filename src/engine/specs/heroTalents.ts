// ============================================
// 영웅특성 자동 감지 (Midnight 12.0.5 기준, 2026.04)
// ============================================
// 각 영웅특성 트리의 시그니처 스킬/버프 이름으로 판별.
// spell ID는 확장팩마다 바뀌므로 이름 기반.
// (tree, spec) 페어마다 별도 엔트리. 한 트리가 여러 스펙에서 쓰이면 중복 등록.

/** 영웅특성 트리 정의 */
export interface HeroTalentTree {
  /** 영문 공식명 (WCL 응답과 매칭) */
  name: string;
  /** 한국 공식 번역명 (UI 표시용) */
  nameKr: string;
  /** 직업명 (공백 포함 "Demon Hunter" 형태) */
  className: string;
  /** 기본 전문화명 (공백 없는 CamelCase "Havoc") */
  specName: string;
  /** 이 트리를 식별할 수 있는 고유 스킬/버프 이름 (소문자) */
  signatureSpells: string[];
}

/** 매칭 실패 시 디버그 로그를 한 번만 출력하기 위한 플래그 */
let debugLogged = false;

const HERO_TALENT_TREES: HeroTalentTree[] = [
  // ============================================
  // 악마사냥꾼 (Demon Hunter)
  // Midnight에서 Devourer 기본 스펙 추가, Fel-Scarred는 Havoc 잔존,
  // Void-Scarred(Devourer), Annihilator(Devourer/Vengeance) 신규
  // ============================================
  { name: "Aldrachi Reaver", nameKr: "알드라치 수확자", className: "Demon Hunter", specName: "Havoc",
    signatureSpells: ["reaver's glaive", "art of the glaive", "warblades of the aldrachi", "reaver's mark", "incorruptible spirit"] },
  { name: "Fel-Scarred", nameKr: "지옥상흔", className: "Demon Hunter", specName: "Havoc",
    signatureSpells: ["demonsurge", "student of suffering", "demonic intensity", "flamebound", "monster rising"] },
  { name: "Void-Scarred", nameKr: "공허상흔", className: "Demon Hunter", specName: "Devourer",
    signatureSpells: ["voidsurge", "void intensity", "student of the void", "untethered void", "voidbound"] },
  { name: "Annihilator", nameKr: "파멸자", className: "Demon Hunter", specName: "Devourer",
    signatureSpells: ["annihilation meteor", "void meteor", "meteoric strike", "crushing impact", "cataclysmic finale"] },
  { name: "Annihilator", nameKr: "파멸자", className: "Demon Hunter", specName: "Vengeance",
    signatureSpells: ["annihilation meteor", "void meteor", "meteoric strike", "crushing impact", "cataclysmic finale"] },

  // ============================================
  // 전사 (Warrior)
  // ============================================
  { name: "Slayer", nameKr: "학살자", className: "Warrior", specName: "Arms",
    signatureSpells: ["slayer's strike", "overwhelming blades", "imminent demise", "unrelenting onslaught", "marked for execution", "brutal finish"] },
  { name: "Slayer", nameKr: "학살자", className: "Warrior", specName: "Fury",
    signatureSpells: ["slayer's strike", "overwhelming blades", "imminent demise", "unrelenting onslaught", "marked for execution", "brutal finish"] },
  { name: "Mountain Thane", nameKr: "산왕", className: "Warrior", specName: "Fury",
    signatureSpells: ["thunder blast", "lightning strikes", "crashing thunder", "storm bolts", "keep your feet", "avatar of the storm"] },
  { name: "Mountain Thane", nameKr: "산왕", className: "Warrior", specName: "Protection",
    signatureSpells: ["thunder blast", "lightning strikes", "crashing thunder", "storm bolts", "keep your feet", "avatar of the storm"] },
  { name: "Colossus", nameKr: "거신", className: "Warrior", specName: "Arms",
    signatureSpells: ["demolish", "colossal might", "arterial bleed", "mountain of muscle", "martial expert", "tide of battle"] },
  { name: "Colossus", nameKr: "거신", className: "Warrior", specName: "Protection",
    signatureSpells: ["demolish", "colossal might", "arterial bleed", "mountain of muscle", "martial expert", "tide of battle"] },

  // ============================================
  // 죽음의 기사 (Death Knight)
  // ============================================
  { name: "Rider of the Apocalypse", nameKr: "종말의 기수", className: "Death Knight", specName: "Blood",
    signatureSpells: ["rider's champion", "apocalypse now", "a feast of souls", "mograine", "whitemane", "trollbane", "nazgrim"] },
  { name: "Rider of the Apocalypse", nameKr: "종말의 기수", className: "Death Knight", specName: "Frost",
    signatureSpells: ["rider's champion", "apocalypse now", "a feast of souls", "mograine", "whitemane", "trollbane", "nazgrim"] },
  { name: "Rider of the Apocalypse", nameKr: "종말의 기수", className: "Death Knight", specName: "Unholy",
    signatureSpells: ["rider's champion", "apocalypse now", "a feast of souls", "mograine", "whitemane", "trollbane", "nazgrim"] },
  { name: "Deathbringer", nameKr: "죽음의 인도자", className: "Death Knight", specName: "Blood",
    signatureSpells: ["reaper's mark", "exterminate", "swift and painful", "reaper's messenger", "wave of souls", "bind in darkness"] },
  { name: "Deathbringer", nameKr: "죽음의 인도자", className: "Death Knight", specName: "Frost",
    signatureSpells: ["reaper's mark", "exterminate", "swift and painful", "reaper's messenger", "wave of souls", "bind in darkness"] },
  { name: "San'layn", nameKr: "산레인", className: "Death Knight", specName: "Blood",
    signatureSpells: ["vampiric strike", "essence of the blood queen", "gift of the san'layn", "blood beast", "infliction of sorrow", "newly turned"] },
  { name: "San'layn", nameKr: "산레인", className: "Death Knight", specName: "Unholy",
    signatureSpells: ["vampiric strike", "essence of the blood queen", "gift of the san'layn", "blood beast", "infliction of sorrow", "newly turned"] },

  // ============================================
  // 도적 (Rogue)
  // ============================================
  { name: "Deathstalker", nameKr: "죽음추적자", className: "Rogue", specName: "Assassination",
    signatureSpells: ["deathstalker's mark", "darkest night", "bait and switch", "corrupt the blood"] },
  { name: "Deathstalker", nameKr: "죽음추적자", className: "Rogue", specName: "Subtlety",
    signatureSpells: ["deathstalker's mark", "darkest night", "bait and switch", "corrupt the blood"] },
  { name: "Fatebound", nameKr: "운명결속", className: "Rogue", specName: "Assassination",
    signatureSpells: ["fatebound coin", "hand of fate", "deal fate", "edge case", "destiny defined"] },
  { name: "Fatebound", nameKr: "운명결속", className: "Rogue", specName: "Outlaw",
    signatureSpells: ["fatebound coin", "hand of fate", "deal fate", "edge case", "destiny defined"] },
  { name: "Trickster", nameKr: "기만자", className: "Rogue", specName: "Outlaw",
    signatureSpells: ["unseen blade", "coup de grace", "flawless form", "cloud cover", "fazed"] },
  { name: "Trickster", nameKr: "기만자", className: "Rogue", specName: "Subtlety",
    signatureSpells: ["unseen blade", "coup de grace", "flawless form", "cloud cover", "fazed"] },

  // ============================================
  // 마법사 (Mage)
  // ============================================
  { name: "Sunfury", nameKr: "성난태양", className: "Mage", specName: "Arcane",
    signatureSpells: ["spellfire sphere", "memory of al'ar", "glorious incandescence", "burden of power", "arcane phoenix"] },
  { name: "Sunfury", nameKr: "성난태양", className: "Mage", specName: "Fire",
    signatureSpells: ["spellfire sphere", "memory of al'ar", "glorious incandescence", "burden of power", "arcane phoenix"] },
  { name: "Frostfire", nameKr: "서리불꽃", className: "Mage", specName: "Fire",
    signatureSpells: ["frostfire bolt", "frostfire mastery", "excess frost", "isothermic core", "severe temperatures"] },
  { name: "Frostfire", nameKr: "서리불꽃", className: "Mage", specName: "Frost",
    signatureSpells: ["frostfire bolt", "frostfire mastery", "excess frost", "isothermic core", "severe temperatures"] },
  { name: "Spellslinger", nameKr: "주문술사", className: "Mage", specName: "Arcane",
    signatureSpells: ["splinterstorm", "splintering sorcery", "slippery slinging", "augury abounds", "controlled instincts"] },
  { name: "Spellslinger", nameKr: "주문술사", className: "Mage", specName: "Frost",
    signatureSpells: ["splinterstorm", "splintering sorcery", "slippery slinging", "augury abounds", "controlled instincts"] },

  // ============================================
  // 사냥꾼 (Hunter)
  // ============================================
  { name: "Dark Ranger", nameKr: "어둠 순찰자", className: "Hunter", specName: "BeastMastery",
    signatureSpells: ["black arrow", "shadow surge", "smoke screen", "withering fire", "soul drinker"] },
  { name: "Dark Ranger", nameKr: "어둠 순찰자", className: "Hunter", specName: "Marksmanship",
    signatureSpells: ["black arrow", "shadow surge", "smoke screen", "withering fire", "soul drinker"] },
  { name: "Pack Leader", nameKr: "무리의 지도자", className: "Hunter", specName: "BeastMastery",
    signatureSpells: ["howl of the pack leader", "vicious hunt", "pack coordination", "wild attacks", "tireless hunt"] },
  { name: "Pack Leader", nameKr: "무리의 지도자", className: "Hunter", specName: "Survival",
    signatureSpells: ["howl of the pack leader", "vicious hunt", "pack coordination", "wild attacks", "tireless hunt"] },
  { name: "Sentinel", nameKr: "파수꾼", className: "Hunter", specName: "Marksmanship",
    signatureSpells: ["sentinel's mark", "moonlight chakram", "don't look back", "eyes closed", "symphonic arsenal"] },
  { name: "Sentinel", nameKr: "파수꾼", className: "Hunter", specName: "Survival",
    signatureSpells: ["sentinel's mark", "moonlight chakram", "don't look back", "eyes closed", "symphonic arsenal"] },

  // ============================================
  // 흑마법사 (Warlock)
  // ============================================
  { name: "Diabolist", nameKr: "악마학자", className: "Warlock", specName: "Demonology",
    signatureSpells: ["diabolic ritual", "infernal bolt", "ruination", "demonic art", "mother of chaos"] },
  { name: "Diabolist", nameKr: "악마학자", className: "Warlock", specName: "Destruction",
    signatureSpells: ["diabolic ritual", "infernal bolt", "ruination", "demonic art", "mother of chaos"] },
  { name: "Hellcaller", nameKr: "지옥소환사", className: "Warlock", specName: "Affliction",
    signatureSpells: ["wither", "blackened soul", "mark of peroth'arn", "malevolence", "zevrim's resilience"] },
  { name: "Hellcaller", nameKr: "지옥소환사", className: "Warlock", specName: "Destruction",
    signatureSpells: ["wither", "blackened soul", "mark of peroth'arn", "malevolence", "zevrim's resilience"] },
  { name: "Soul Harvester", nameKr: "영혼 수확자", className: "Warlock", specName: "Affliction",
    signatureSpells: ["succulent soul", "demonic soul", "sataiel's volition", "shared fate", "wicked reaping"] },
  { name: "Soul Harvester", nameKr: "영혼 수확자", className: "Warlock", specName: "Demonology",
    signatureSpells: ["succulent soul", "demonic soul", "sataiel's volition", "shared fate", "wicked reaping"] },

  // ============================================
  // 기원사 (Evoker)
  // ============================================
  { name: "Chronowarden", nameKr: "시간 감시자", className: "Evoker", specName: "Preservation",
    signatureSpells: ["chrono flame", "chronoboon", "temporal burst", "time convergence", "motes of possibility"] },
  { name: "Chronowarden", nameKr: "시간 감시자", className: "Evoker", specName: "Augmentation",
    signatureSpells: ["chrono flame", "chronoboon", "temporal burst", "time convergence", "motes of possibility"] },
  { name: "Flameshaper", nameKr: "불꽃형성자", className: "Evoker", specName: "Devastation",
    signatureSpells: ["engulf", "consume flame", "titanic precision", "draconic instincts", "traveling flame"] },
  { name: "Flameshaper", nameKr: "불꽃형성자", className: "Evoker", specName: "Preservation",
    signatureSpells: ["engulf", "consume flame", "titanic precision", "draconic instincts", "traveling flame"] },
  { name: "Scalecommander", nameKr: "비늘사령관", className: "Evoker", specName: "Devastation",
    signatureSpells: ["bombardments", "mass disintegrate", "maneuverability", "melt armor", "menacing presence", "command squadron"] },
  { name: "Scalecommander", nameKr: "비늘사령관", className: "Evoker", specName: "Augmentation",
    signatureSpells: ["bombardments", "mass disintegrate", "maneuverability", "melt armor", "menacing presence", "command squadron"] },

  // ============================================
  // 성기사 (Paladin)
  // ============================================
  { name: "Templar", nameKr: "성전사", className: "Paladin", specName: "Retribution",
    signatureSpells: ["hammer of light", "shake the heavens", "sacrosanct crusade", "wake of ashes"] },
  { name: "Templar", nameKr: "성전사", className: "Paladin", specName: "Protection",
    signatureSpells: ["hammer of light", "shake the heavens", "sacrosanct crusade", "wake of ashes"] },
  { name: "Herald of the Sun", nameKr: "태양의 사자", className: "Paladin", specName: "Holy",
    signatureSpells: ["dawnlight", "sun sear", "morning star", "solar grace"] },
  { name: "Herald of the Sun", nameKr: "태양의 사자", className: "Paladin", specName: "Retribution",
    signatureSpells: ["dawnlight", "sun sear", "morning star", "solar grace"] },
  { name: "Lightsmith", nameKr: "빛의 대장장이", className: "Paladin", specName: "Holy",
    signatureSpells: ["holy armaments", "sacred weapon", "holy bulwark", "laying down arms"] },
  { name: "Lightsmith", nameKr: "빛의 대장장이", className: "Paladin", specName: "Protection",
    signatureSpells: ["holy armaments", "sacred weapon", "holy bulwark", "laying down arms"] },

  // ============================================
  // 사제 (Priest)
  // ============================================
  { name: "Archon", nameKr: "집정관", className: "Priest", specName: "Holy",
    signatureSpells: ["empowered surges", "energy compression", "divine halo", "power surge"] },
  { name: "Archon", nameKr: "집정관", className: "Priest", specName: "Shadow",
    signatureSpells: ["empowered surges", "energy compression", "divine halo", "power surge"] },
  { name: "Voidweaver", nameKr: "공허술사", className: "Priest", specName: "Discipline",
    signatureSpells: ["entropic rift", "void blast", "voidwraith", "darkening horizon"] },
  { name: "Voidweaver", nameKr: "공허술사", className: "Priest", specName: "Shadow",
    signatureSpells: ["entropic rift", "void blast", "voidwraith", "darkening horizon"] },
  { name: "Oracle", nameKr: "예언자", className: "Priest", specName: "Discipline",
    signatureSpells: ["premonition", "preventive measures", "waste no time", "miraculous recovery"] },
  { name: "Oracle", nameKr: "예언자", className: "Priest", specName: "Holy",
    signatureSpells: ["premonition", "preventive measures", "waste no time", "miraculous recovery"] },

  // ============================================
  // 드루이드 (Druid) — 영웅특성 4개
  // ============================================
  { name: "Druid of the Claw", nameKr: "발톱의 드루이드", className: "Druid", specName: "Feral",
    signatureSpells: ["ravage", "claw rampage", "frantic momentum", "wildpower surge"] },
  { name: "Druid of the Claw", nameKr: "발톱의 드루이드", className: "Druid", specName: "Guardian",
    signatureSpells: ["ravage", "claw rampage", "frantic momentum", "wildpower surge"] },
  { name: "Wildstalker", nameKr: "야생추적자", className: "Druid", specName: "Feral",
    signatureSpells: ["thriving growth", "root network", "flower walk", "bursting growth"] },
  { name: "Wildstalker", nameKr: "야생추적자", className: "Druid", specName: "Restoration",
    signatureSpells: ["thriving growth", "root network", "flower walk", "bursting growth"] },
  { name: "Keeper of the Grove", nameKr: "숲의 수호자", className: "Druid", specName: "Balance",
    signatureSpells: ["dream surge", "treants of the moon", "grove's inspiration"] },
  { name: "Keeper of the Grove", nameKr: "숲의 수호자", className: "Druid", specName: "Restoration",
    signatureSpells: ["dream surge", "treants of the moon", "grove's inspiration"] },
  { name: "Elune's Chosen", nameKr: "엘룬의 대행자", className: "Druid", specName: "Balance",
    signatureSpells: ["boundless moonlight", "lunar insight", "the eternal moon"] },
  { name: "Elune's Chosen", nameKr: "엘룬의 대행자", className: "Druid", specName: "Guardian",
    signatureSpells: ["boundless moonlight", "lunar insight", "the eternal moon"] },

  // ============================================
  // 주술사 (Shaman)
  // ============================================
  { name: "Stormbringer", nameKr: "폭풍인도자", className: "Shaman", specName: "Elemental",
    signatureSpells: ["tempest", "supercharge", "arc discharge", "unrelenting storms"] },
  { name: "Stormbringer", nameKr: "폭풍인도자", className: "Shaman", specName: "Enhancement",
    signatureSpells: ["tempest", "supercharge", "arc discharge", "unrelenting storms"] },
  { name: "Totemic", nameKr: "토템술사", className: "Shaman", specName: "Enhancement",
    signatureSpells: ["surging totem", "totemic rebound", "whirling elements", "oversurge"] },
  { name: "Totemic", nameKr: "토템술사", className: "Shaman", specName: "Restoration",
    signatureSpells: ["surging totem", "totemic rebound", "whirling elements", "oversurge"] },
  { name: "Farseer", nameKr: "선견자", className: "Shaman", specName: "Elemental",
    signatureSpells: ["call of the ancestors", "ancestral swiftness", "elemental reverb", "final calling"] },
  { name: "Farseer", nameKr: "선견자", className: "Shaman", specName: "Restoration",
    signatureSpells: ["call of the ancestors", "ancestral swiftness", "elemental reverb", "final calling"] },

  // ============================================
  // 수도사 (Monk)
  // ============================================
  { name: "Shado-Pan", nameKr: "음영파", className: "Monk", specName: "Brewmaster",
    signatureSpells: ["flurry strikes", "wisdom of the wall", "against all odds", "high impact"] },
  { name: "Shado-Pan", nameKr: "음영파", className: "Monk", specName: "Windwalker",
    signatureSpells: ["flurry strikes", "wisdom of the wall", "against all odds", "high impact"] },
  { name: "Conduit of the Celestials", nameKr: "천신의 대변자", className: "Monk", specName: "Mistweaver",
    signatureSpells: ["celestial conduit", "strength of the black ox", "august dynasty", "heart of the jade serpent"] },
  { name: "Conduit of the Celestials", nameKr: "천신의 대변자", className: "Monk", specName: "Windwalker",
    signatureSpells: ["celestial conduit", "strength of the black ox", "august dynasty", "heart of the jade serpent"] },
  { name: "Master of Harmony", nameKr: "조화의 종사", className: "Monk", specName: "Brewmaster",
    signatureSpells: ["aspect of harmony", "harmonic gambit", "manifestation", "endless draught"] },
  { name: "Master of Harmony", nameKr: "조화의 종사", className: "Monk", specName: "Mistweaver",
    signatureSpells: ["aspect of harmony", "harmonic gambit", "manifestation", "endless draught"] },
];

/** className 정규화: "DemonHunter" → "demonhunter", "Demon Hunter" → "demonhunter" */
function normalizeClass(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]/g, "");
}

/**
 * 캐스트/버프 이름 목록에서 영웅특성 트리 감지
 * @param abilityNames 스킬/버프 이름 목록
 * @param className 직업명 (필터용, "Warrior", "DemonHunter" 등)
 * @returns 영문 트리명 (감지 실패 시 "")
 */
export function detectHeroTalent(
  abilityNames: string[],
  className?: string,
): string {
  const lowerNames = new Set(abilityNames.map(n => n.toLowerCase()));

  // className으로 후보 좁히기
  const normalizedInput = className ? normalizeClass(className) : "";
  const candidates = normalizedInput
    ? HERO_TALENT_TREES.filter(t => normalizeClass(t.className) === normalizedInput)
    : HERO_TALENT_TREES;

  if (candidates.length === 0 && className) {
    // 알려진 직업 매핑이 없으면 타 직업 시그니처에 오염될 수 있으므로 빈 문자열 반환
    return "";
  }

  for (const tree of candidates) {
    for (const sig of tree.signatureSpells) {
      for (const name of lowerNames) {
        if (name.includes(sig)) return tree.name;
      }
    }
  }

  // 디버그: 매칭 실패 시 후보 스킬 중 고유해 보이는 것 출력 (처음 1회만)
  if (className && candidates.length > 0 && !debugLogged) {
    debugLogged = true;
    const heroKeywords = ["strike", "blast", "surge", "storm", "rift", "mark", "blade",
      "demolish", "reap", "execute", "crush", "burn", "flame", "void", "shadow",
      "celestial", "templar", "herald", "archon", "diabolist", "hellcaller",
      "rider", "deathbringer", "druid", "wild", "pack", "dark", "slinger",
      "annihilat", "harvest", "sentinel", "chrono", "oracle", "lightsmith",
      "farseer", "harmony", "grove", "elune", "san'layn", "vampir"];
    const suspicious = [...lowerNames].filter(n => heroKeywords.some(kw => n.includes(kw))).slice(0, 20);
    console.log(`[detectHeroTalent] ${className} 매칭 실패. 후보 스킬:`, suspicious.join(", "));
  }

  return "";
}

/** 내부: 대소문자·공백·하이픈·언더스코어·아포스트로피 무시한 키 생성 */
function normalizeTreeName(s: string): string {
  return s.toLowerCase().replace(/[\s\-_']/g, "");
}

/**
 * 영문 영웅특성 트리명 → 한글명 변환 (UI 표시용).
 * 대소문자·공백·아포스트로피 무시하고 매칭. 매핑 없으면 영문 그대로 반환.
 */
export function heroTalentNameKr(englishName: string): string {
  if (!englishName) return "";
  // 숫자 ID 문자열 방어 — 파싱이 숫자를 담아 UI에 그대로 뜨는 사고 방지
  if (/^\d+$/.test(englishName.trim())) return "";
  const key = normalizeTreeName(englishName);
  const tree = HERO_TALENT_TREES.find(t => normalizeTreeName(t.name) === key);
  return tree?.nameKr ?? englishName;
}

/**
 * 특정 직업의 모든 영웅특성 트리 목록 (중복 제거).
 * UI 필터/드롭다운에 사용.
 */
export function getHeroTalentsForClass(className: string): Array<{ name: string; nameKr: string }> {
  const normalized = normalizeClass(className);
  const seen = new Set<string>();
  const result: Array<{ name: string; nameKr: string }> = [];
  for (const tree of HERO_TALENT_TREES) {
    if (normalizeClass(tree.className) !== normalized) continue;
    if (seen.has(tree.name)) continue;
    seen.add(tree.name);
    result.push({ name: tree.name, nameKr: tree.nameKr });
  }
  return result;
}
