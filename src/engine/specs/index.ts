// ============================================
// 직업/특성 정의 레지스트리
// ============================================

import { HAVOC_DH } from "./demon-hunter";

export interface SpecDefinition {
  name: string;
  className: string;
  classID: number;
  specID: number;
  baseGCD: number;
  resource: { type: string; typeId: number; max: number };
  majorCooldowns: Array<{
    spellId: number;
    name: string;
    cd: number;        // 초
    icon: string;
  }>;
  builders: Array<{ spellId: number; name: string }>;
  spenders: Array<{ spellId: number; name: string }>;
  lustSpellIds: number[];
}

/** classID + specName → SpecDefinition */
const SPEC_REGISTRY: SpecDefinition[] = [
  HAVOC_DH,
];

export function getSpecDefinition(classID: number, specName?: string): SpecDefinition | null {
  // specName이 있으면 정확 매칭
  if (specName) {
    const found = SPEC_REGISTRY.find(
      (s) => s.classID === classID && s.name.toLowerCase() === specName.toLowerCase()
    );
    if (found) return found;
  }
  // classID만으로 첫 번째 매칭
  return SPEC_REGISTRY.find((s) => s.classID === classID) ?? null;
}

export { HAVOC_DH };
