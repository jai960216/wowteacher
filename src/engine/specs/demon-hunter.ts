// ============================================
// 포식 악마사냥꾼 (Havoc Demon Hunter) 스펙 데이터
// ============================================

import type { SpecDefinition } from "./index";

export const HAVOC_DH: SpecDefinition = {
  name: "Havoc",
  className: "DemonHunter",
  classID: 12,
  specID: 577,
  baseGCD: 1.5,
  resource: { type: "Fury", typeId: 17, max: 120 },
  majorCooldowns: [
    { spellId: 191427, name: "Metamorphosis", cd: 180, icon: "ability_demonhunter_metamorphasisdps" },
    { spellId: 258925, name: "Fel Barrage", cd: 90, icon: "inv_felbarrage" },
    { spellId: 258860, name: "Essence Break", cd: 40, icon: "spell_shadow_ritualofsacrifice" },
    { spellId: 342817, name: "Glaive Tempest", cd: 25, icon: "inv_glaive_1h_artifactaldorchi_d_03dual" },
    { spellId: 198013, name: "Eye Beam", cd: 30, icon: "ability_demonhunter_eyebeam" },
    { spellId: 370965, name: "The Hunt", cd: 90, icon: "ability_ardenweald_demonhunter" },
  ],
  builders: [
    { spellId: 370966, name: "Demon's Bite" },
    { spellId: 162794, name: "Chaos Strike" },  // also spender but generates on crit
  ],
  spenders: [
    { spellId: 198013, name: "Eye Beam" },
    { spellId: 188499, name: "Blade Dance" },
    { spellId: 210152, name: "Death Sweep" },
    { spellId: 162794, name: "Chaos Strike" },
    { spellId: 210153, name: "Annihilation" },
    { spellId: 258920, name: "Immolation Aura" },
  ],
  lustSpellIds: [2825, 32182, 80353, 264667, 390386],  // Bloodlust, Heroism, Time Warp, etc.
};
