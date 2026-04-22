// ============================================
// Spell Registry — simcName ↔ spellId 양방향 매핑
// ============================================
// 모든 비교/평가는 spell ID로 하고,
// 이 레지스트리로 APL의 텍스트 이름 ↔ ID를 변환

export class SpellRegistry {
  private idToSimcName = new Map<number, string>();
  private simcNameToId = new Map<string, number>();
  private idToLocalName = new Map<number, string>();
  private idToIcon = new Map<number, string>();

  register(id: number, simcName: string, localName?: string, icon?: string): void {
    this.idToSimcName.set(id, simcName);
    this.simcNameToId.set(simcName, id);
    if (localName) this.idToLocalName.set(id, localName);
    if (icon) this.idToIcon.set(id, icon);
  }

  getSimcName(id: number): string | undefined {
    return this.idToSimcName.get(id);
  }

  getId(simcName: string): number | undefined {
    return this.simcNameToId.get(simcName);
  }

  getLocalName(id: number): string | undefined {
    return this.idToLocalName.get(id);
  }

  getIcon(id: number): string | undefined {
    return this.idToIcon.get(id);
  }

  getIconUrl(id: number, size: "small" | "medium" | "large" = "medium"): string | undefined {
    const icon = this.idToIcon.get(id);
    if (!icon) return undefined;
    return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
  }

  /** 디스플레이용: ID → 가장 적절한 이름 */
  getDisplayName(id: number): string {
    return this.idToLocalName.get(id) ?? this.idToSimcName.get(id) ?? `spell_${id}`;
  }

  /** 등록된 모든 ID 목록 */
  getAllIds(): number[] {
    return [...this.idToSimcName.keys()];
  }

  /** buff 스냅샷에서 simcName으로 스택 수 조회 */
  getBuffStacks(buffs: Record<number, number>, simcName: string): number {
    const id = this.simcNameToId.get(simcName);
    if (id === undefined) return 0;
    return buffs[id] ?? 0;
  }

  /** buff 스냅샷에서 simcName으로 활성 여부 조회 */
  isBuffUp(buffs: Record<number, number>, simcName: string): boolean {
    return this.getBuffStacks(buffs, simcName) > 0;
  }
}
