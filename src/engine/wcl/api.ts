// ============================================
// WarcraftLogs GraphQL API v2
// ============================================
// GraphQL 응답의 raw shape을 손으로 타입 정의하면 스키마 변경에 취약하고
// codegen 없이는 유지보수 부담이 크다. 이 파일은 응답 wrapper 역할에 한정되므로
// 로컬 범위에서만 any를 허용한다.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getToken } from "./auth";
import { setRateLimitData, getRateLimitSnapshot } from "./rateLimit";
import { detectHeroTalent } from "../specs/heroTalents";
import { devLog } from "../../debug";
// spec 필드는 항상 특성명 (Devourer, Fury 등). 영웅특성은 별도.

const PUBLIC_API = "https://www.warcraftlogs.com/api/v2/client";
const USER_API = "https://www.warcraftlogs.com/api/v2/user";

/**
 * PI/Ebon Might/Prescience 계열 외부 버프 키워드.
 * getBuffsTable 로그 진단과 App.tsx의 "후보" UI 노출에서 공유 — 키워드 추가 시 단일 소스.
 */
export const EXTERNAL_KEYWORD_RE = /infusion|might|prescience|마력|주입|위세|예지|흑요|칠흑/i;

const RATE_LIMIT_FIELD = "rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }";

/**
 * 모든 쿼리의 최상위 블록 끝에 rateLimitData 필드를 삽입.
 * 한 요청으로 실제 데이터 + 잔여 API 한도를 함께 받아 점수 추가 소모 없이 관찰.
 */
function injectRateLimitField(gql: string): string {
  if (gql.includes("rateLimitData")) return gql;
  const lastBrace = gql.lastIndexOf("}");
  if (lastBrace === -1) return gql;
  return `${gql.slice(0, lastBrace)}  ${RATE_LIMIT_FIELD}\n${gql.slice(lastBrace)}`;
}

/**
 * WCL HTTP/GraphQL 에러. 호출부에서 status로 401/429/5xx 분기해 적절한 유저 메시지 분기 가능.
 */
export class WCLApiError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WCLApiError";
    this.status = status;
  }
}

/** GraphQL 요청 */
async function query<T>(gql: string, variables: Record<string, any> = {}, useUserApi = false): Promise<T> {
  const token = getToken();
  if (!token) throw new WCLApiError(401, "WarcraftLogs 인증이 필요합니다.");

  const res = await fetch(useUserApi ? USER_API : PUBLIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: injectRateLimitField(gql), variables }),
  });

  if (!res.ok) {
    // 429: snapshot 없으면 synthetic으로 세팅 — 유저가 최소한 "몇 분 후" 카운트다운은 볼 수 있게.
    // 실제 성공 쿼리가 돌면 진짜 값으로 덮어씀. WCL이 Retry-After 헤더를 주면 그 값 사용.
    if (res.status === 429 && !getRateLimitSnapshot()) {
      const retryAfterSec = Number(res.headers.get("retry-after")) || 3600; // 헤더 없으면 worst case 1h
      setRateLimitData({ limitPerHour: 18000, pointsSpentThisHour: 18000, pointsResetIn: retryAfterSec });
    }
    throw new WCLApiError(res.status, `WarcraftLogs API error: ${res.status}`);
  }

  const json = await res.json();
  // GraphQL 에러 — HTTP는 200이지만 응답에 errors 있음. status 0으로 구분해 errorMessage에서 감싼 메시지 노출.
  if (json.errors) throw new WCLApiError(0, json.errors[0]?.message ?? "GraphQL error");
  if (json.data?.rateLimitData) setRateLimitData(json.data.rateLimitData);
  return json.data;
}

// ---- 타입 ----

export interface WCLFight {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  kill: boolean;
  difficulty: number;
  encounterID: number;
  friendlyPlayers: number[];
}

export interface WCLPlayer {
  id: number;
  name: string;
  type: string;       // masterData actor type (e.g. "DemonHunter")
  spec: string;       // masterData actor subType (e.g. "Havoc")
  server: string;
  className: string;  // 정규화된 이름 (e.g. "Demon Hunter") — 모든 조회의 기준
  classID: number;    // Blizzard classID (하위 호환)
}

export interface WCLCastEvent {
  timestamp: number;
  type: string;
  sourceID: number;
  abilityGameID: number;
  abilityName: string;    // WCL ability.name
  abilityIcon: string;    // WCL ability.abilityIcon
  fight: number;
}

export interface WCLBuffEvent {
  timestamp: number;
  type: string;
  sourceID: number;
  targetID: number;
  abilityGameID: number;
  stacks?: number;
  fight: number;
}

export interface WCLResourceEvent {
  timestamp: number;
  sourceID: number;
  resourceAmount: number;   // 현재 자원량 (classResources[0].amount)
  resourceMax: number;       // 최대 자원량 (classResources[0].max)
  resourceType: number;      // 자원 타입 (17=Fury 등)
  waste: number;
  fight: number;
}

export interface WCLReportInfo {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  fights: WCLFight[];
  players: WCLPlayer[];
  /** NPC 목록 (보스, 쫄 등) */
  npcs: Array<{ id: number; name: string; type: string }>;
  abilityMap: Record<number, string>;
}

// ---- 직업 매핑 ----

// =============================================
// WCL classID (알파벳순) — WCL API 전체에서 사용
// 1=DK 2=Druid 3=Hunter 4=Mage 5=Monk
// 6=Paladin 7=Priest 8=Rogue 9=Shaman 10=Warlock
// 11=Warrior 12=DemonHunter 13=Evoker
// =============================================

/** WCL classID → API className (characterRankings용) */
export const CLASSID_TO_APINAME: Record<number, string> = {
  1: "Death Knight", 2: "Druid", 3: "Hunter", 4: "Mage", 5: "Monk",
  6: "Paladin", 7: "Priest", 8: "Rogue", 9: "Shaman", 10: "Warlock",
  11: "Warrior", 12: "Demon Hunter", 13: "Evoker",
};

/** WCL classID → 한글 직업명 */
export const CLASS_NAMES_KR: Record<number, string> = {
  1: "죽음의 기사", 2: "드루이드", 3: "사냥꾼", 4: "마법사", 5: "수도사",
  6: "성기사", 7: "사제", 8: "도적", 9: "주술사", 10: "흑마법사",
  11: "전사", 12: "악마사냥꾼", 13: "기원사",
};

/** WCL classID → WoW 클래스 컬러 */
export const CLASS_COLORS: Record<number, string> = {
  1: "#C41F3B", 2: "#FF7D0A", 3: "#ABD473", 4: "#69CCF0", 5: "#00FF96",
  6: "#F58CBA", 7: "#FFFFFF", 8: "#FFF569", 9: "#0070DE", 10: "#9482C9",
  11: "#C79C6E", 12: "#A330C9", 13: "#33937F",
};

/** WCL classID → zamimg 아이콘 파일명 */
const CLASSID_TO_ICONSLUG: Record<number, string> = {
  1: "deathknight", 2: "druid", 3: "hunter", 4: "mage", 5: "monk",
  6: "paladin", 7: "priest", 8: "rogue", 9: "shaman", 10: "warlock",
  11: "warrior", 12: "demonhunter", 13: "evoker",
};

/** masterData actor type/subType 문자열 → WCL classID */
const TYPE_TO_CLASSID: Record<string, number> = {
  DeathKnight: 1, Druid: 2, Hunter: 3, Mage: 4, Monk: 5,
  Paladin: 6, Priest: 7, Rogue: 8, Shaman: 9, Warlock: 10,
  Warrior: 11, DemonHunter: 12, Evoker: 13,
};

/** 공식 WoW 클래스 아이콘 URL */
export function getClassIconUrl(classID: number): string {
  const slug = CLASSID_TO_ICONSLUG[classID];
  if (!slug) return "";
  return `https://wow.zamimg.com/images/wow/icons/medium/classicon_${slug}.jpg`;
}

/** 난이도 */
export const DIFFICULTY_NAMES: Record<number, string> = {
  1: "공찾", 3: "일반", 4: "영웅", 5: "신화",
};

export const DIFFICULTY_COLORS: Record<number, string> = {
  1: "#1eff00", 3: "#1eff00", 4: "#a335ee", 5: "#ff8000",
};

/** 퍼센타일 → 색상 (WCL 스타일) */
export function getPercentileColor(pct: number): string {
  if (pct >= 99) return "#e268a8"; // 핑크 (legendary)
  if (pct >= 95) return "#ff8000"; // 오렌지
  if (pct >= 75) return "#a335ee"; // 보라
  if (pct >= 50) return "#0070dd"; // 파랑
  if (pct >= 25) return "#1eff00"; // 초록
  return "#666";                    // 회색
}

// ---- 쿼리 ----

/**
 * 리포트 기본 정보 + 전투 목록 + 플레이어 목록.
 * 세션 동안 같은 reportCode는 캐시에서 반환 → 동일 report 재조회로 API point 소모 방지.
 * inflight 요청 병합: 같은 코드에 동시 호출이 들어오면 같은 Promise 공유.
 */
const reportInfoCache = new Map<string, Promise<WCLReportInfo>>();

/** 로그아웃·계정 전환 시 세션 캐시 전체 클리어. auth.ts logoutHook에서 호출. */
export function clearAllCaches(): void {
  reportInfoCache.clear();
  partitionCache.clear();
  combatantInfoCache.clear();
}

export async function getReportInfo(reportCode: string): Promise<WCLReportInfo> {
  const cached = reportInfoCache.get(reportCode);
  if (cached) return cached;

  const promise = fetchReportInfo(reportCode);
  reportInfoCache.set(reportCode, promise);
  promise.catch(() => reportInfoCache.delete(reportCode));
  return promise;
}

async function fetchReportInfo(reportCode: string): Promise<WCLReportInfo> {
  const data = await query<any>(`
    query ($code: String!) {
      reportData {
        report(code: $code) {
          code
          title
          startTime
          endTime
          fights {
            id
            name
            startTime
            endTime
            kill
            difficulty
            encounterID
            friendlyPlayers
          }
          masterData {
            players: actors(type: "Player") {
              id
              name
              type
              subType
              server
            }
            npcs: actors(type: "NPC") {
              id
              name
              type
              subType
            }
            abilities {
              gameID
              name
              type
            }
          }
        }
      }
    }
  `, { code: reportCode });

  const report = data.reportData.report;

  // ability ID → name 매핑
  const abilityMap: Record<number, string> = {};
  for (const ab of (report.masterData.abilities ?? [])) {
    if (ab.gameID && ab.name) abilityMap[ab.gameID] = ab.name;
  }
  devLog(`[getReportInfo] abilities 매핑: ${Object.keys(abilityMap).length}개`);

  return {
    code: report.code,
    title: report.title,
    startTime: report.startTime,
    endTime: report.endTime,
    fights: (report.fights ?? []).map((f: any) => ({ ...f, friendlyPlayers: f.friendlyPlayers ?? [] })),
    abilityMap,
    npcs: (report.masterData.npcs ?? []).map((a: any) => ({
      id: a.id,
      name: a.name ?? "",
      type: a.type ?? "",
    })),
    players: (report.masterData.players ?? []).map((a: any) => {
      // actors(type: "Player") → type=클래스명, subType=스펙명
      const classID = TYPE_TO_CLASSID[a.type] ?? TYPE_TO_CLASSID[a.subType] ?? 0;
      return {
        id: a.id,
        name: a.name,
        type: a.type ?? "",
        spec: a.subType ?? "",
        server: a.server ?? "",
        className: CLASSID_TO_APINAME[classID] ?? "",
        classID,
      };
    }),
  };
}

/** 특정 전투의 캐스트 이벤트 */
export async function getCasts(
  reportCode: string,
  _fightId: number,
  sourceId: number,
  startTime: number,
  endTime: number,
): Promise<WCLCastEvent[]> {
  void _fightId;
  const allEvents: WCLCastEvent[] = [];
  let currentStart: number = startTime;
  const MAX_PAGES = 30;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $sourceID: Int!) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              sourceID: $sourceID
              dataType: Casts
              limit: 500
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      sourceID: sourceId,
    });

    const events: any = data.reportData.report.events;
    for (const e of events.data) {
      allEvents.push({
        ...e,
        abilityName: e.ability?.name ?? "",
        abilityIcon: e.ability?.abilityIcon ?? "",
      });
    }
    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  return allEvents;
}

/** 특정 전투의 버프 이벤트 */
/**
 * 특정 fight의 start/end 타임스탬프만 가볍게 조회.
 * 랭킹 rank에서 외부 버프 펼치기 시 getBuffsTable 호출 전에 필요.
 */
export async function getFightTime(
  reportCode: string,
  fightID: number,
): Promise<{ startTime: number; endTime: number } | null> {
  const data: any = await query<any>(`
    query ($code: String!, $fightIDs: [Int]!) {
      reportData {
        report(code: $code) {
          fights(fightIDs: $fightIDs) {
            id
            startTime
            endTime
          }
        }
      }
    }
  `, { code: reportCode, fightIDs: [fightID] });
  const fight = data.reportData?.report?.fights?.[0];
  if (!fight) return null;
  return { startTime: fight.startTime ?? 0, endTime: fight.endTime ?? 0 };
}

/**
 * 특정 플레이어가 받은 buff 요약 (targetID 기준).
 * WCL의 report.table(dataType: Buffs) 한 번 호출로 uptime·횟수 요약 받음.
 * 외부 버프(마주/칠흑 등) 카운트 용도.
 */
export async function getBuffsTable(
  reportCode: string,
  targetId: number,
  startTime: number,
  endTime: number,
): Promise<Array<{ spellId: number; name: string; icon: string; totalUses: number; uptimePercent: number }>> {
  const data: any = await query<any>(`
    query ($code: String!, $startTime: Float!, $endTime: Float!, $targetID: Int!) {
      reportData {
        report(code: $code) {
          table(
            dataType: Buffs
            startTime: $startTime
            endTime: $endTime
            targetID: $targetID
          )
        }
      }
    }
  `, {
    code: reportCode,
    startTime,
    endTime,
    targetID: targetId,
  });

  const table = data.reportData.report.table;
  const parsed = typeof table === "string" ? JSON.parse(table) : table;
  // WCL 응답 shape: { data: { auras: [...] } } 또는 { data: { entries: [...] } } — fallback 모두 시도
  const entries: any[] = parsed?.data?.auras ?? parsed?.auras ?? parsed?.data?.entries ?? parsed?.entries ?? [];
  const duration = endTime - startTime;

  const mapped = entries.map((e: any) => {
    const totalUptime = e.totalUptime ?? e.uptime ?? 0;
    return {
      spellId: e.guid ?? e.id ?? 0,
      name: e.name ?? "",
      icon: (e.icon ?? "").replace(/\.jpg$/i, ""),
      totalUses: e.totalUses ?? e.uses ?? 0,
      uptimePercent: duration > 0 ? Math.round((totalUptime / duration) * 1000) / 10 : 0,
    };
  });

  // 외부 버프 후보 — PI/EM/Prescience 계열 키워드 매칭 항목은 uptime 컷과 무관하게 전부 출력.
  // 마주가 3번만 걸렸으면 uptime 10% 근처로 Top20 밖이라 이전 로그에선 보이지 않았음.
  const externalCandidates = mapped.filter(b => EXTERNAL_KEYWORD_RE.test(b.name));
  devLog(
    `[getBuffsTable] target=${targetId} | ${mapped.length}종 | 외부버프후보:`,
    externalCandidates.length > 0
      ? externalCandidates.map(b => `${b.name}(#${b.spellId}) ${b.totalUses}회 ${b.uptimePercent}%`).join(" | ")
      : "없음",
  );

  return mapped;
}

/**
 * 특정 플레이어가 외부에서 받은 특정 buff들의 정확한 apply 횟수·uptime.
 * `table(dataType: Buffs)`는 외부 시전 buff 일부를 집계 누락하는 알려진 WCL 버그가 있어서
 * events 원본 이벤트 스트림에 filterExpression으로 관심 ID만 명시해 받음.
 * applybuff 카운트 = 받은 횟수, apply~remove 구간 합산 = uptime.
 */
export async function getExternalBuffEvents(
  reportCode: string,
  targetId: number,
  startTime: number,
  endTime: number,
  spellIds: number[],
): Promise<Array<{ spellId: number; applyCount: number; uptimePercent: number }>> {
  const validIds = spellIds.filter(n => Number.isFinite(n) && n > 0);
  if (validIds.length === 0) return [];
  const filter = `ability.id in (${validIds.join(", ")})`;

  const allEvents: any[] = [];
  let currentStart = startTime;
  // 페이지네이션 진행 감시 — nextPageTimestamp가 진행 안 하거나 역행하면 무한 루프 방지.
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $targetID: Int!, $filter: String!) {
        reportData {
          report(code: $code) {
            events(
              dataType: Buffs
              hostilityType: Friendlies
              startTime: $startTime
              endTime: $endTime
              targetID: $targetID
              filterExpression: $filter
              limit: 10000
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      targetID: targetId,
      filter,
    });
    const events = data.reportData?.report?.events;
    if (!events) break;
    allEvents.push(...(events.data ?? []));
    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  // 페이지 경계에서 timestamp 비단조 가능성 — state machine 돌리기 전 정렬 보장.
  allEvents.sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const duration = endTime - startTime;
  type Acc = { applies: number; active: boolean; activeStart: number; uptime: number };
  const bySpell: Record<number, Acc> = {};
  for (const id of validIds) bySpell[id] = { applies: 0, active: false, activeStart: 0, uptime: 0 };

  for (const e of allEvents) {
    const sid: number | null = e.abilityGameID ?? null;
    if (sid === null) continue;
    const s = bySpell[sid];
    if (!s) continue;
    if (e.type === "applybuff") {
      s.applies += 1;
      if (!s.active) { s.active = true; s.activeStart = e.timestamp; }
    } else if (e.type === "refreshbuff") {
      if (!s.active) { s.active = true; s.activeStart = e.timestamp; }
    } else if (e.type === "removebuff") {
      if (s.active) {
        const delta = e.timestamp - s.activeStart;
        if (delta > 0) s.uptime += delta;
        s.active = false;
      }
    }
  }
  // 전투 끝까지 active인 채로 남은 경우 fight 종료까지 연장
  for (const id of validIds) {
    const s = bySpell[id];
    if (s.active) {
      const delta = endTime - s.activeStart;
      if (delta > 0) s.uptime += delta;
    }
  }

  const results = validIds.map(id => {
    const s = bySpell[id];
    return {
      spellId: id,
      applyCount: s.applies,
      uptimePercent: duration > 0 ? Math.round((s.uptime / duration) * 1000) / 10 : 0,
    };
  });
  const hit = results.filter(r => r.applyCount > 0);
  devLog(
    `[getExternalBuffEvents] target=${targetId}:`,
    hit.length > 0 ? hit.map(r => `#${r.spellId} ${r.applyCount}회 ${r.uptimePercent}%`).join(" | ") : "없음",
  );
  return results;
}

/**
 * 특정 플레이어가 "받은" cast 이벤트 (events dataType: Casts, targetID = 플레이어).
 * buff event가 누락되는 경우 시전자의 cast 이벤트로 역추정 — WCL 사이트 Buffs 탭도
 * 이 방식을 병행한다고 알려짐. applybuff 없이 PI 3회를 보여주는 현상 대응.
 */
export async function getIncomingCasts(
  reportCode: string,
  targetId: number,
  startTime: number,
  endTime: number,
  spellIds: number[],
): Promise<Array<{ spellId: number; castCount: number }>> {
  const validIds = spellIds.filter(n => Number.isFinite(n) && n > 0);
  if (validIds.length === 0) return [];
  const filter = `ability.id in (${validIds.join(", ")})`;

  const allEvents: any[] = [];
  let currentStart = startTime;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $targetID: Int!, $filter: String!) {
        reportData {
          report(code: $code) {
            events(
              dataType: Casts
              hostilityType: Friendlies
              startTime: $startTime
              endTime: $endTime
              targetID: $targetID
              filterExpression: $filter
              limit: 10000
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      targetID: targetId,
      filter,
    });
    const events = data.reportData?.report?.events;
    if (!events) break;
    allEvents.push(...(events.data ?? []));
    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  const counts: Record<number, number> = {};
  for (const id of validIds) counts[id] = 0;
  for (const e of allEvents) {
    const sid: number | null = e.abilityGameID ?? null;
    if (sid === null || !(sid in counts)) continue;
    // type 체크 없이 cast 관련 이벤트 전부 카운트 (cast/begincast)
    counts[sid] += 1;
  }

  const results = validIds.map(id => ({ spellId: id, castCount: counts[id] }));
  const hit = results.filter(r => r.castCount > 0);
  devLog(
    `[getIncomingCasts] target=${targetId}:`,
    hit.length > 0 ? hit.map(r => `#${r.spellId} ${r.castCount}회`).join(" | ") : "없음",
  );
  return results;
}

export async function getBuffs(
  reportCode: string,
  _fightId: number,
  targetId: number,
  startTime: number,
  endTime: number,
): Promise<WCLBuffEvent[]> {
  void _fightId;
  const allEvents: WCLBuffEvent[] = [];
  let currentStart: number = startTime;
  const MAX_PAGES = 30;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $targetID: Int!) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              targetID: $targetID
              dataType: Buffs
              hostilityType: Friendlies
              limit: 500
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      targetID: targetId,
    });

    const events: any = data.reportData.report.events;
    allEvents.push(...events.data);
    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  return allEvents;
}

/** 특정 전투의 자원 이벤트 */
export async function getResources(
  reportCode: string,
  _fightId: number,
  sourceId: number,
  startTime: number,
  endTime: number,
): Promise<WCLResourceEvent[]> {
  void _fightId;
  const allEvents: WCLResourceEvent[] = [];
  let currentStart: number = startTime;
  const MAX_PAGES = 30;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $sourceID: Int!) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              sourceID: $sourceID
              dataType: Resources
              limit: 500
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      sourceID: sourceId,
    });

    const events: any = data.reportData.report.events;

    // WCL Resource 이벤트 실제 구조:
    // { resourceChange: 10, resourceChangeType: 17, maxResourceAmount: 120, waste: 0 }
    // classResources 없음! resourceChange = 변동량 (누적 계산 필요)
    for (const e of events.data) {
      allEvents.push({
        timestamp: e.timestamp,
        sourceID: e.sourceID ?? sourceId,
        resourceAmount: e.resourceChange ?? 0,  // 변동량 (나중에 누적)
        resourceMax: e.maxResourceAmount ?? 0,
        resourceType: e.resourceChangeType ?? 0,
        waste: e.waste ?? 0,
        fight: e.fight ?? 0,
      });
    }

    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  return allEvents;
}

/** 리포트 URL에서 코드 추출 */
export function parseReportUrl(url: string): { code: string; fight?: number } | null {
  const m = url.match(/warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  const code = m[1];
  const fightMatch = url.match(/fight=(\d+)/);
  const fight = fightMatch ? parseInt(fightMatch[1]) : undefined;
  return { code, fight };
}

// ============================================
// 캐릭터 검색 + 랭킹
// ============================================

/** zoneRankings에서 파싱된 보스별 성적 */
export interface BossRanking {
  encounterID: number;
  encounterName: string;
  rankPercent: number;       // Best % (전체 퍼센타일)
  medianPercent: number;     // Median %
  bracketPercent: number;    // ilvl % (아이템레벨 퍼센타일)
  highestDPS: number;
  totalKills: number;
  fastestKill: number;
  spec: string;
  bracket: number;           // 아이템레벨 구간
}

export interface ZoneRankingData {
  zoneName: string;
  difficulty: number;
  bestPerfAvg: number;
  medianPerfAvg: number;
  bosses: BossRanking[];
}

export interface WCLRanking {
  name: string;
  server: string;
  region: string;
  class: string;
  spec: string;
  amount: number;
  duration: number;
  reportCode: string;
  fightID: number;
  rank: number;
  bracketData: number;  // ilvl 구간 (WCL bracket ID)
  externalBuffs?: Array<{ spellId: number; name: string; count: number; uptimePercent: number }>;
}

/** 캐릭터의 특정 보스 킬 기록 (report code + fight ID 포함) */
export async function getMyEncounterRankings(
  name: string,
  serverSlug: string,
  serverRegion: string,
  encounterID: number,
  difficulty: number,
  metric: "dps" | "hps" = "dps",
): Promise<Array<{ reportCode: string; fightID: number; amount: number; startTime: number; duration: number }>> {
  const data: any = await query(`
    query ($name: String!, $server: String!, $region: String!, $encounterID: Int!, $difficulty: Int!, $metric: CharacterRankingMetricType!) {
      characterData {
        character(name: $name, serverSlug: $server, serverRegion: $region) {
          encounterRankings(encounterID: $encounterID, difficulty: $difficulty, metric: $metric)
        }
      }
    }
  `, { name, server: serverSlug, region: serverRegion, encounterID, difficulty, metric });

  const raw = data.characterData?.character?.encounterRankings;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const ranks = parsed?.ranks ?? [];
  devLog(`[getMyEncounterRankings] ${name} encounter=${encounterID} diff=${difficulty}: ${ranks.length}건`);
  if (ranks.length > 0) {
    devLog(`[getMyEncounterRankings] 첫 항목:`, JSON.stringify(ranks[0]).slice(0, 500));
  }
  return ranks.map((r: any) => ({
    reportCode: r.report?.code ?? "",
    fightID: r.report?.fightID ?? 0,
    amount: r.amount ?? 0,
    startTime: r.startTime ?? 0,
    duration: r.duration ?? 0,
  })).filter((r: any) => r.reportCode);
}

/** 로그인한 유저의 캐릭터 목록 가져오기 (user API) */
export async function getMyCharacters(): Promise<Array<{
  id: number;
  name: string;
  server: string;
  serverSlug: string;
  region: string;
  classID: number;
  className: string;
  heroSpec: string;
}>> {
  const data: any = await query(`
    {
      userData {
        currentUser {
          characters {
            id
            name
            server {
              slug
              name
              region {
                slug
              }
            }
            classID
          }
        }
      }
    }
  `, {}, true);

  const chars = data.userData?.currentUser?.characters ?? [];
  devLog("[getMyCharacters] raw:", chars.map((c: any) => ({ name: c.name, classID: c.classID })));
  return chars.map((c: any) => {
    const classID = c.classID ?? 0;
    const className = CLASSID_TO_APINAME[classID] ?? "";
    return {
      id: c.id,
      name: c.name,
      server: c.server?.name ?? c.server?.slug ?? "",
      serverSlug: c.server?.slug ?? "",
      region: c.server?.region?.slug ?? "",
      classID,
      className,
      heroSpec: "",
    };
  });
}

/** 캐릭터 이름 + 서버로 검색 → zoneRankings(난이도별) + 최근 로그 */
export async function searchCharacter(
  name: string,
  serverSlug: string,
  serverRegion: string,
  metric: "dps" | "hps" = "dps",
): Promise<{ classID: number; className: string; allZoneRankings: ZoneRankingData[] }> {
  // 난이도별 zoneRankings를 GraphQL alias로 한번에 가져옴
  const data: any = await query(`
    query ($name: String!, $server: String!, $region: String!, $metric: CharacterRankingMetricType!) {
      characterData {
        character(name: $name, serverSlug: $server, serverRegion: $region) {
          name
          classID
          mythic: zoneRankings(difficulty: 5, metric: $metric)
          heroic: zoneRankings(difficulty: 4, metric: $metric)
          normal: zoneRankings(difficulty: 3, metric: $metric)
        }
      }
    }
  `, { name, server: serverSlug, region: serverRegion, metric });

  const char = data.characterData.character;

  // 난이도별 zoneRankings 파싱
  const allZoneRankings: ZoneRankingData[] = [];
  const diffNames: Record<string, number> = { mythic: 5, heroic: 4, normal: 3 };

  for (const [key, diffNum] of Object.entries(diffNames)) {
    const zr = char[key];
    if (!zr) continue;
    const parsed = typeof zr === "string" ? JSON.parse(zr) : zr;
    // 첫 난이도에서 원본 키 확인
    if (parsed?.rankings?.[0] && !((searchCharacter as any)._logged)) {
      (searchCharacter as any)._logged = true;
      devLog("[zoneRankings] 원본 보스 키:", Object.keys(parsed.rankings[0]).join(", "));
      devLog("[zoneRankings] 원본 보스[0]:", JSON.stringify(parsed.rankings[0]).slice(0, 500));
      devLog("[zoneRankings] 원본 루트 키:", Object.keys(parsed).join(", "));
    }
    if (parsed && parsed.rankings && parsed.rankings.length > 0) {
      allZoneRankings.push({
        zoneName: parsed.zone?.name ?? parsed.zoneName ?? "",
        difficulty: diffNum,
        bestPerfAvg: parsed.bestPerformanceAverage ?? 0,
        medianPerfAvg: parsed.medianPerformanceAverage ?? 0,
        bosses: (parsed.rankings as any[]).map((r: any) => ({
          encounterID: r.encounter?.id ?? 0,
          encounterName: r.encounter?.name ?? "",
          rankPercent: r.rankPercent ?? 0,
          medianPercent: r.medianPercent ?? 0,
          bracketPercent: r.bracketPercent ?? r.rankPercentBracket ?? 0,
          highestDPS: r.bestAmount ?? r.totalAmount ?? 0,
          totalKills: r.totalKills ?? 0,
          fastestKill: r.fastestKill ?? 0,
          spec: r.spec ?? r.bestSpec ?? "",
          bracket: r.bracket ?? r.bracketData ?? 0,
        })),
      });
    }
  }

  const classID = char.classID ?? 0;
  const className = CLASSID_TO_APINAME[classID] ?? "";
  devLog("[searchCharacter]", name, "classID:", classID, "→ className:", className,
    "| zoneRankings:", allZoneRankings.map(z => DIFFICULTY_NAMES[z.difficulty]).join(",") || "없음");

  return {
    classID,
    className,
    allZoneRankings,
  };
}

/**
 * encounter → zone의 default partition 자동 조회 (캐시).
 * WCL은 밸런스 패치마다 새 partition을 만들어 default를 갱신함. 하드코딩하면
 * 시즌 후반에 사이트 랭킹과 데이터가 어긋남 (구 partition의 옛 데이터 표시).
 * 네트워크/스키마 실패 시 1로 degrade — 랭킹 플로우 전체가 차단되지 않게.
 */
const partitionCache = new Map<number, Promise<number>>();
const PARTITION_FALLBACK = 1;

export function getDefaultPartition(encounterId: number): Promise<number> {
  const cached = partitionCache.get(encounterId);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const data: any = await query<any>(`
        query ($id: Int!) {
          worldData {
            encounter(id: $id) {
              zone {
                id
                partitions { id default name }
              }
            }
          }
        }
      `, { id: encounterId });
      const partitions: Array<{ id: number; default: boolean; name: string }> =
        data.worldData?.encounter?.zone?.partitions ?? [];
      const def = partitions.find(p => p.default)?.id
        ?? (partitions.length > 0 ? Math.max(...partitions.map(p => p.id)) : PARTITION_FALLBACK);
      if (partitions.length === 0) {
        console.warn(`[getDefaultPartition] encounter ${encounterId}: partitions 0건, fallback=${PARTITION_FALLBACK}`);
      } else {
        devLog(
          `[getDefaultPartition] encounter ${encounterId} → partition ${def}`,
          "| 후보:", partitions.map(p => `${p.id}${p.default ? "*" : ""}:${p.name}`).join(", "),
        );
      }
      return def;
    } catch (e) {
      console.warn(`[getDefaultPartition] encounter ${encounterId} 조회 실패, fallback=${PARTITION_FALLBACK}:`, e);
      return PARTITION_FALLBACK;
    }
  })();

  partitionCache.set(encounterId, promise);
  // 성공 응답도 캐싱 (catch는 안에서 처리되므로 promise 자체는 reject 안 함)
  return promise;
}

/** 특정 보스의 직업별 상위 랭킹 */
export async function getEncounterRankings(
  encounterId: number,
  className: string,
  specName: string,
  difficulty: number = 5,
  page: number = 1,
  bracket: number = 0,
  metric: "dps" | "hps" = "dps",
): Promise<{ rankings: WCLRanking[]; hasMorePages: boolean }> {
  if (!className) {
    console.error("[getEncounterRankings] className이 비어있음! 필터 없이 조회됨");
  }

  // partition은 zone마다·시즌 안에서도 밸런스 패치마다 바뀜. WCL의 default를 동적으로 따라감.
  const partition = await getDefaultPartition(encounterId);
  devLog("[getEncounterRankings] className:", className, "encounter:", encounterId, "diff:", difficulty, "metric:", metric, "partition:", partition);

  // WCL characterRankings는 className/specName을 공백 없는 CamelCase("DeathKnight")로 기대.
  // 공백 포함("Death Knight")으로 보내면 0건 반환. 공백 제거 후 서버 필터로 보내 해당 직업 상위 100명을 바로 받음.
  // metric은 CharacterRankingMetricType(lowercase 문자열 enum). "dps"가 default이며 힐러 비교 시 "hps" 사용.
  const classNoSpace = (className ?? "").replace(/\s+/g, "");
  const specNoSpace = (specName ?? "").replace(/\s+/g, "");
  const vars: Record<string, any> = {
    id: encounterId,
    page,
    partition,
    metric,
  };
  if (classNoSpace) vars.class = classNoSpace;
  if (specNoSpace) vars.spec = specNoSpace;
  if (difficulty > 0) vars.difficulty = difficulty;
  if (bracket > 0) vars.bracket = bracket;

  // includeCombatantInfo는 쿼리 포인트를 대폭 증가시킴 — 랭커의 영웅특성은
  // 실제 분석 시점에 getCombatantInfo로 받아서 쓰므로 여기선 필요 없음.
  const data: any = await query(`
    query ($id: Int!, $class: String, $spec: String, $difficulty: Int, $page: Int, $bracket: Int, $partition: Int, $metric: CharacterRankingMetricType) {
      worldData {
        encounter(id: $id) {
          name
          characterRankings(
            className: $class
            specName: $spec
            difficulty: $difficulty
            bracket: $bracket
            page: $page
            partition: $partition
            metric: $metric
          )
        }
      }
    }
  `, vars);

  const rankingsData = data.worldData?.encounter?.characterRankings;
  const parsed = typeof rankingsData === "string" ? JSON.parse(rankingsData) : rankingsData;
  const rankings = parsed?.rankings ?? [];

  // 응답 구조 진단 (rankings가 비어있으면 루트 키 + 메타 출력)
  if (rankings.length === 0) {
    console.warn("[getEncounterRankings] rankings 0건. 원본 응답:", JSON.stringify(parsed).slice(0, 800));
  } else {
    const first = rankings[0];
    devLog("[getEncounterRankings] 원본 첫 항목 키:", Object.keys(first));
    devLog("[getEncounterRankings] 원본 첫 항목:", JSON.stringify(first).slice(0, 500));
  }

  // WCL 응답의 class는 "DemonHunter" (붙여쓰기) 형태
  // 우리 className은 "Demon Hunter" (띄어쓰기) 형태
  // 비교용 정규화: 소문자 + 공백/특수문자 제거
  const normalize = (s: string): string => s.toLowerCase().replace(/[\s\-_]/g, "");

  const extractClassName = (r: any): string => {
    if (typeof r.class === "string") return r.class;
    if (typeof r.class === "object" && r.class?.name) return r.class.name;
    if (typeof r.class === "number") return CLASSID_TO_APINAME[r.class] ?? "";
    if (typeof r.className === "string") return r.className;
    return "";
  };

  // 서버 필터 제거 → 전직업이 응답에 섞여 옴. 클라이언트에서 정규화 비교로 필터링.
  // class 필드 누락은 drop(통과 금지). 서버 필터가 없으므로 fallthrough는 혼합 오염 위험.
  // 비공개 리포트(hidden=true, name="Anonymous", reportCode="a:..." 접두)는 WCL이 플레이어
  // 이름을 "Player (id)"로 익명화해서 본인 매칭·buff 조회 불가 → 아예 제외.
  const isHiddenRank = (r: any): boolean => {
    if (r?.hidden === true) return true;
    if (r?.name === "Anonymous") return true;
    const code = r?.report?.code ?? r?.reportCode ?? "";
    if (typeof code === "string" && code.startsWith("a:")) return true;
    return false;
  };
  let filtered = rankings;
  let droppedUnknown = 0;
  let droppedHidden = 0;
  if (className) {
    const target = normalize(className);
    filtered = rankings.filter((r: any) => {
      if (isHiddenRank(r)) { droppedHidden++; return false; }
      const rClass = extractClassName(r);
      if (!rClass) { droppedUnknown++; return false; }
      return normalize(rClass) === target;
    });
    devLog(
      "[getEncounterRankings] 클라이언트 필터:", className,
      "| 전체:", rankings.length, "→", filtered.length,
      droppedUnknown > 0 ? `| class 누락 drop=${droppedUnknown}` : "",
      droppedHidden > 0 ? `| 비공개 drop=${droppedHidden}` : "",
    );
  } else {
    filtered = rankings.filter((r: any) => {
      if (isHiddenRank(r)) { droppedHidden++; return false; }
      return true;
    });
    if (droppedHidden > 0) {
      devLog(`[getEncounterRankings] 비공개 drop=${droppedHidden}`);
    }
  }

  const mapped: WCLRanking[] = filtered.map((r: any, i: number) => ({
    name: r.name ?? "",
    server: r.server?.name ?? r.serverName ?? "",
    region: r.server?.region ?? r.regionName ?? "",
    class: extractClassName(r) || className,
    spec: r.spec ?? r.specName ?? specName ?? "",
    amount: r.amount ?? r.total ?? 0,
    duration: r.duration ?? 0,
    reportCode: r.report?.code ?? r.reportCode ?? "",
    fightID: r.report?.fightID ?? r.fightID ?? 0,
    rank: i + 1,
    bracketData: r.bracketData ?? 0,
  }));

  return {
    rankings: mapped,
    hasMorePages: parsed?.hasMorePages ?? false,
  };
}

// ============================================
// 추가 데이터 쿼리 (분석 엔진용)
// ============================================

import type { WCLDamageEvent, WCLHealEvent, WCLCombatantInfo, WCLDeathEvent, DamageTableEntry, HealingTableEntry } from "../analysis/types";

/** DamageDone 이벤트 (페이지네이션) */
export async function getDamageDone(
  reportCode: string,
  sourceId: number,
  startTime: number,
  endTime: number,
): Promise<WCLDamageEvent[]> {
  const allEvents: WCLDamageEvent[] = [];
  let currentStart = startTime;
  const MAX_PAGES = 30;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $sourceID: Int!) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              sourceID: $sourceID
              dataType: DamageDone
              limit: 500
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      sourceID: sourceId,
    });

    const events = data.reportData.report.events;
    allEvents.push(...events.data);
    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  return allEvents;
}

/** Healing 이벤트 (페이지네이션) — getDamageDone과 동일 shape, dataType만 Healing */
export async function getHealingDone(
  reportCode: string,
  sourceId: number,
  startTime: number,
  endTime: number,
): Promise<WCLHealEvent[]> {
  const allEvents: WCLHealEvent[] = [];
  let currentStart = startTime;
  const MAX_PAGES = 30;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: any = await query<any>(`
      query ($code: String!, $startTime: Float!, $endTime: Float!, $sourceID: Int!) {
        reportData {
          report(code: $code) {
            events(
              startTime: $startTime
              endTime: $endTime
              sourceID: $sourceID
              dataType: Healing
              limit: 500
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `, {
      code: reportCode,
      startTime: currentStart,
      endTime,
      sourceID: sourceId,
    });

    const events = data.reportData.report.events;
    for (const e of (events.data ?? [])) {
      allEvents.push({
        timestamp: e.timestamp ?? 0,
        type: e.type ?? "heal",
        sourceID: e.sourceID ?? sourceId,
        targetID: e.targetID ?? 0,
        abilityGameID: e.abilityGameID ?? 0,
        amount: e.amount ?? 0,
        absorbed: e.absorbed ?? 0,
        overheal: e.overheal ?? 0,
        hitType: e.hitType ?? 0,
        fight: e.fight ?? 0,
      });
    }
    const next = events.nextPageTimestamp ?? 0;
    if (next <= 0 || next <= currentStart) break;
    currentStart = next;
  }

  return allEvents;
}

/** Healing 요약 테이블 — getDamageTable 미러, overheal 필드 추가 수집 */
export async function getHealingTable(
  reportCode: string,
  sourceId: number,
  startTime: number,
  endTime: number,
): Promise<HealingTableEntry[]> {
  const data: any = await query<any>(`
    query ($code: String!, $startTime: Float!, $endTime: Float!, $sourceID: Int!) {
      reportData {
        report(code: $code) {
          table(
            dataType: Healing
            startTime: $startTime
            endTime: $endTime
            sourceID: $sourceID
          )
        }
      }
    }
  `, {
    code: reportCode,
    startTime,
    endTime,
    sourceID: sourceId,
  });

  const table = data.reportData.report.table;
  const parsed = typeof table === "string" ? JSON.parse(table) : table;
  const entries = parsed?.data?.entries ?? parsed?.entries ?? [];
  return entries.map((e: any) => ({
    name: e.name ?? "",
    guid: e.guid ?? e.id ?? 0,
    type: e.type ?? 0,
    total: e.total ?? 0,
    totalReduced: e.totalReduced ?? e.total ?? 0,
    hitCount: e.hitCount ?? 0,
    tickCount: e.tickCount ?? 0,
    icon: e.icon ?? "",
    overheal: e.overheal ?? 0,
  }));
}

/** DamageDone 요약 테이블 */
export async function getDamageTable(
  reportCode: string,
  sourceId: number,
  startTime: number,
  endTime: number,
): Promise<DamageTableEntry[]> {
  const data: any = await query<any>(`
    query ($code: String!, $startTime: Float!, $endTime: Float!, $sourceID: Int!) {
      reportData {
        report(code: $code) {
          table(
            dataType: DamageDone
            startTime: $startTime
            endTime: $endTime
            sourceID: $sourceID
          )
        }
      }
    }
  `, {
    code: reportCode,
    startTime,
    endTime,
    sourceID: sourceId,
  });

  const table = data.reportData.report.table;
  const parsed = typeof table === "string" ? JSON.parse(table) : table;
  const entries = parsed?.data?.entries ?? parsed?.entries ?? [];
  return entries.map((e: any) => ({
    name: e.name ?? "",
    guid: e.guid ?? e.id ?? 0,
    type: e.type ?? 0,
    total: e.total ?? 0,
    totalReduced: e.totalReduced ?? e.total ?? 0,
    hitCount: e.hitCount ?? 0,
    tickCount: e.tickCount ?? 0,
    icon: e.icon ?? "",
  }));
}

/** 전투 참여 플레이어 목록 (이름 → sourceID 매핑) */
export async function getFightPlayerIds(
  reportCode: string,
  startTime: number,
  endTime: number,
): Promise<Array<{ id: number; name: string }>> {
  const data: any = await query<any>(`
    query ($code: String!, $startTime: Float!, $endTime: Float!) {
      reportData {
        report(code: $code) {
          table(
            dataType: DamageDone
            startTime: $startTime
            endTime: $endTime
          )
        }
      }
    }
  `, { code: reportCode, startTime, endTime });

  const table = data.reportData.report.table;
  const parsed = typeof table === "string" ? JSON.parse(table) : table;
  const entries = parsed?.data?.entries ?? parsed?.entries ?? [];
  devLog(`[getFightPlayerIds] ${entries.length}명 발견:`, entries.map((e: any) => `${e.name}(${e.id})`).join(", "));
  return entries
    .filter((e: any) => e.name && e.id != null)
    .map((e: any) => ({ id: e.id, name: e.name }));
}

/**
 * CombatantInfo (전투 참여자 장비/특성/스탯).
 * (code, startTime, endTime) 키로 세션 캐시. statScan이 상위 N명을 순회하며 같은 전투를
 * 여러 번 긁는 패턴을 방지.
 */
const combatantInfoCache = new Map<string, Promise<WCLCombatantInfo[]>>();

export async function getCombatantInfo(
  reportCode: string,
  startTime: number,
  endTime: number,
): Promise<WCLCombatantInfo[]> {
  const key = `${reportCode}:${startTime}:${endTime}`;
  const cached = combatantInfoCache.get(key);
  if (cached) return cached;

  const promise = fetchCombatantInfo(reportCode, startTime, endTime);
  combatantInfoCache.set(key, promise);
  promise.catch(() => combatantInfoCache.delete(key));
  return promise;
}

async function fetchCombatantInfo(
  reportCode: string,
  startTime: number,
  endTime: number,
): Promise<WCLCombatantInfo[]> {
  const data: any = await query<any>(`
    query ($code: String!, $startTime: Float!, $endTime: Float!) {
      reportData {
        report(code: $code) {
          events(
            startTime: $startTime
            endTime: $endTime
            dataType: CombatantInfo
            limit: 50
          ) {
            data
          }
        }
      }
    }
  `, {
    code: reportCode,
    startTime,
    endTime,
  });

  const events = data.reportData.report.events.data ?? [];

  // talent entry ID는 WCL 내부 전용 — 외부 API로 spell ID 변환 불가

  return events.map((e: any) => {
    // 장비 — icon에 .jpg 포함됨, 제거해서 저장
    const gear = (e.gear ?? []).map((g: any, idx: number) => ({
      id: g.id ?? 0,
      slot: idx,
      itemLevel: g.itemLevel ?? 0,
      quality: g.quality ?? 0,
      icon: (g.icon ?? "").replace(/\.jpg$/i, ""),
      name: g.name ?? "",
      permanentEnchant: g.permanentEnchant ?? 0,
      temporaryEnchant: g.temporaryEnchant ?? 0,
      gems: (g.gems ?? []).map((gem: any) => ({
        id: gem.id ?? 0,
        itemLevel: gem.itemLevel ?? 0,
        icon: (gem.icon ?? "").replace(/\.jpg$/i, ""),
      })),
    }));

    // 스탯 — 플랫 필드에서 수집
    const stats: Record<string, number> = {};
    const statFields: Record<string, string> = {
      strength: "Strength", agility: "Agility", stamina: "Stamina", intellect: "Intellect",
      critMelee: "CriticalStrike", hasteMelee: "Haste", mastery: "Mastery",
      versatilityDamageDone: "Versatility",
      speed: "Speed", leech: "Leech", avoidance: "Avoidance",
      armor: "Armor",
    };
    for (const [field, label] of Object.entries(statFields)) {
      if (e[field] != null && e[field] > 0) stats[label] = e[field];
    }

    // 탤런트
    const allTalents = (e.talents ?? []).map((t: any) => ({
      id: t.id ?? 0,
      spellID: t.spellID ?? t.id ?? 0,
      name: t.name ?? "",
      icon: (t.icon ?? "").replace(/\.jpg$/i, ""),
    }));

    // 영웅특성 — customPowerSet (배열이면 ID 목록)
    const customPower = e.customPowerSet;
    let heroTalents: Array<{ spellID: number; name: string; icon: string }> = [];
    let heroTreeName = "";

    if (Array.isArray(customPower) && customPower.length > 0) {
      heroTalents = customPower.map((t: any) => ({
        spellID: typeof t === "number" ? t : (t.spellID ?? t.id ?? 0),
        name: typeof t === "object" ? (t.name ?? "") : "",
        icon: typeof t === "object" ? ((t.icon ?? "").replace(/\.jpg$/i, "")) : "",
      }));
    }

    // talentTree에서 영웅특성 트리 이름 찾기 — node.name이 이름 문자열일 때만 채택
    if (Array.isArray(e.talentTree)) {
      for (const node of e.talentTree) {
        if ((node.heroTree || node.subTreeID || node.type === "hero") && typeof node.name === "string" && node.name) {
          heroTreeName = node.name;
          break;
        }
      }
    }
    // 보조 경로: heroTalents[].name 시그니처로 tree 역추정 (server가 heroTreeName 안 줄 때).
    if (!heroTreeName && heroTalents.length > 0) {
      const heroNames = heroTalents.map(h => h.name).filter(Boolean);
      const detected = detectHeroTalent(heroNames, "");
      if (detected) heroTreeName = detected;
    }
    // 숫자 ID 문자열 방어 — UI에 "12345" 노출 방지
    if (/^\d+$/.test(heroTreeName.trim())) heroTreeName = "";

    return {
      sourceID: e.sourceID ?? 0,
      specID: e.specID ?? 0,
      gear,
      talents: allTalents,
      heroTalents,
      talentTree: (e.talentTree ?? []).map((t: any) => ({
        id: t.id ?? 0,
        rank: t.rank ?? 0,
        nodeID: t.nodeID ?? 0,
      })),
      auras: (e.auras ?? []).map((a: any) => ({
        ability: a.ability ?? 0,
        name: a.name ?? "",
        icon: (a.icon ?? "").replace(/\.jpg$/i, ""),
        stacks: a.stacks ?? 0,
      })),
      heroTreeName,
      stats,
    };
  });
}

/** 사망 이벤트 */
export async function getDeaths(
  reportCode: string,
  startTime: number,
  endTime: number,
): Promise<WCLDeathEvent[]> {
  const data: any = await query<any>(`
    query ($code: String!, $startTime: Float!, $endTime: Float!) {
      reportData {
        report(code: $code) {
          events(
            startTime: $startTime
            endTime: $endTime
            dataType: Deaths
            limit: 50
          ) {
            data
          }
        }
      }
    }
  `, {
    code: reportCode,
    startTime,
    endTime,
  });

  return (data.reportData.report.events.data ?? []).map((e: any) => ({
    timestamp: e.timestamp ?? 0,
    targetID: e.targetID ?? 0,
    killerID: e.killerID,
    killingAbilityGameID: e.killingAbilityGameID,
    fight: e.fight ?? 0,
  }));
}

/** 한국 서버 슬러그 매핑 */
export const KR_SERVERS: Record<string, string> = {
  "듀로탄": "duratan",
  "불타는군단": "burning-legion",
  "스톰레이지": "stormrage",
  "하이잘": "hyjal",
  "헬스크림": "hellscream",
  "윈드러너": "windrunner",
  "달라란": "dalaran",
  "세나리우스": "cenarius",
  "아즈샤라": "azshara",
  "줄진": "zuljin",
  "말퓨리온": "malfurion",
  "가로나": "garona",
  "노르간논": "norgannon",
};
