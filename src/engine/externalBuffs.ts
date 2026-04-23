// 외부 딜 증가 버프 — 상위권 비교 시 핵심 지표
// Midnight 12.0.5 기준. 매칭: ID 1차, nameKeywords 2차, Cast 이벤트 3차 (buff event 누락 대응).
//   Power Infusion = 마력 주입 (10060, self id 37274)
//   Ebon Might = 칠흑의 힘 (395152, 404269)

export interface ExternalBuffConfig {
  ids: number[];
  nameKeywords: RegExp;
  label: string;
  short: string;
  color: string;
}

export const EXTERNAL_BUFFS: ExternalBuffConfig[] = [
  { ids: [37274, 10060], nameKeywords: /power infusion|마력 주입/i, label: "마력 주입", short: "마주", color: "#ec4899" },
  { ids: [404269, 395152], nameKeywords: /ebon might|흑요석 위세|칠흑의 힘/i, label: "칠흑의 힘", short: "칠흑", color: "#f59e0b" },
];

export const EXTERNAL_BUFF_SPELL_IDS: number[] = [...new Set(EXTERNAL_BUFFS.flatMap(c => c.ids))];

/** spell ID → 소속 cfg.label 매핑 (Cast 이벤트로 감지된 ID를 어느 buff 카테고리로 분류할지) */
export const EXTERNAL_SPELL_TO_LABEL: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  for (const cfg of EXTERNAL_BUFFS) for (const id of cfg.ids) m[id] = cfg.label;
  return m;
})();
