// ============================================
// 레이드/보스 영문 → 한글 매핑
// ============================================
// WCL API는 영문만 반환. 한국 공식 번역을 하드코딩.
// 시즌 전환마다 보스가 바뀌므로 업데이트 필요.
// 출처: 와우 인벤, 나무위키, Blizzard 한국.

const ENCOUNTER_KR: Record<string, string> = {
  // ---- Midnight Season 1 (2026.03~, 12.0.x) ----

  // 레이드/존 이름
  "The Voidspire": "공허첨탑",
  "The Dreamrift": "꿈의 균열",
  "March on Quel'Danas": "쿠엘다나스 진격로",

  // The Voidspire — 6보스
  "Imperator Averzian": "전제군주 아베르지안",
  "Vorasius": "보라시우스",
  "Fallen-King Salhadaar": "몰락한 왕 살라다르",
  "Vaelgor & Ezzorak": "바엘고어와 에조라크",
  "Lightblinded Vanguard": "빛에 눈이 먼 선봉대",
  "Crown of the Cosmos": "우주의 왕관",

  // The Dreamrift — 1보스
  "Chimaerus, the Undreamt God": "꿈결을 벗어난 신 카이메루스",

  // March on Quel'Danas — 2보스
  "Belo'ren, Child of Al'ar": "알라르의 자손 벨로렌",
  "Midnight Falls": "한밤의 도래",  // 한국 커뮤니티에선 "르우라"로도 부름
};

/**
 * 영문 인카운터/존 이름 → 한글명.
 * 매핑 없으면 영문 그대로 반환.
 */
export function encounterNameKr(englishName: string): string {
  if (!englishName) return "";
  return ENCOUNTER_KR[englishName] ?? englishName;
}

/**
 * 한글 매핑이 존재하는지 확인 (UI에서 병기 표시할 때 부제 노출 여부 결정).
 */
export function hasKrName(englishName: string): boolean {
  return !!ENCOUNTER_KR[englishName];
}
