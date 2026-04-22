import { useState, useEffect, useRef, useSyncExternalStore, Fragment } from "react";
import { isAuthenticated, startAuth, handleCallback, logout } from "./engine/wcl/auth";
import { subscribeRateLimit, getRateLimitSnapshot } from "./engine/wcl/rateLimit";
import {
  getMyCharacters, searchCharacter, getReportInfo, getEncounterRankings, getFightPlayerIds, getMyEncounterRankings,
  getFightTime, getBuffsTable,
  CLASS_NAMES_KR, CLASS_COLORS, DIFFICULTY_NAMES, DIFFICULTY_COLORS,
  getClassIconUrl, getPercentileColor,
  type WCLReportInfo, type WCLRanking, type WCLFight, type ZoneRankingData,
} from "./engine/wcl/api";
import { runFullAnalysis, type FullAnalysis } from "./engine/analysis";
import { ALL_SPECS } from "./engine/specs/allSpecs";
import { specNameKr, isHealerSpec } from "./engine/specs/specNames";
import { encounterNameKr } from "./engine/specs/encounterNames";
import { getSpecIconUrl } from "./engine/specs/specIcons";
import type { CastSnapshot, GearItem } from "./engine/analysis/types";
import { scanTopStats, type TopStatsScanResult } from "./engine/analysis/statScan";
import { SpellResolver } from "./engine/spell/resolver";
import type { SpellMeta } from "./engine/spell/types";
import "./index.css";

type Step = "login" | "characters" | "overview" | "myKills" | "rankings" | "result";

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks: () => void };
  }
}

interface MyCharacter {
  id: number;
  name: string;
  server: string;
  serverSlug: string;
  region: string;
  classID: number;
  className: string;
  heroSpec: string;
}

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/medium";

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [step, _setStep] = useState<Step>(isAuthenticated() ? "characters" : "login");
  const setStep = (s: Step) => { console.log("[step]", step, "→", s); _setStep(s); };

  const [myChars, setMyChars] = useState<MyCharacter[]>([]);
  const [selectedChar, setSelectedChar] = useState<MyCharacter | null>(null);
  const [allZoneRankings, setAllZoneRankings] = useState<ZoneRankingData[]>([]);
  const [reportInfo, setReportInfo] = useState<WCLReportInfo | null>(null);
  const [selectedFight, setSelectedFight] = useState<WCLFight | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<number | null>(null);
  const [rankings, setRankings] = useState<WCLRanking[]>([]);
  const [analysis, setAnalysis] = useState<FullAnalysis | null>(null);
  const [spellMeta, setSpellMeta] = useState<Record<number, SpellMeta>>({});
  const [activeTab, setActiveTab] = useState<string>("summary");
  // 스탯 스캔/비교 기준 spec — 사용자가 선택한 상대의 기본 특성(Blood/Frost/Unholy 등).
  // 같은 특성 Top 10만 모아 스탯 분포를 비교해야 2차 스탯 우선순위 비교가 유효함.
  const [refSpec, setRefSpec] = useState<string>("");
  // 랭킹 지표: 딜러는 DPS, 힐러는 HPS. selectChar에서 자동 감지 + RankingsView 토글로 수동 변경 가능.
  const [metric, setMetric] = useState<"dps" | "hps">("dps");
  const [statScan, setStatScan] = useState<TopStatsScanResult | null>(null);
  const [statScanLoading, setStatScanLoading] = useState(false);
  const [myKills, setMyKills] = useState<Array<{ reportCode: string; fightID: number; amount: number; startTime: number; duration: number }>>([]);
  const [statScanProgress, setStatScanProgress] = useState("");
  const callbackHandled = useRef(false);
  // (encounterID, className, difficulty, perSpec) 조합별 랭킹 inflight/결과 캐시.
  // selectFight/selectBossRanking/selectMyKill이 같은 조합을 중복 호출하는 걸 방지.
  const rankingsCache = useRef(new Map<string, Promise<WCLRanking[]>>());
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code && !callbackHandled.current) {
      callbackHandled.current = true;
      // StrictMode 이중 실행 방지: URL에서 code 즉시 제거
      window.history.replaceState({}, "", window.location.pathname);
      handleCallback(code)
        .then(() => { setAuthed(true); setStep("characters"); })
        .catch((e) => setError("인증 실패: " + errorMessage(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed && step === "characters" && myChars.length === 0) {
      setLoading(true);
      getMyCharacters()
        .then(setMyChars)
        .catch((e) => setError("캐릭터 로드 실패: " + errorMessage(e)))
        .finally(() => setLoading(false));
    }
  }, [authed, step, myChars.length]);

  async function selectChar(char: MyCharacter) {
    setLoading(true); setError(null);
    try {
      const data = await searchCharacter(char.name, char.serverSlug, char.region);

      // 영웅특성: zoneRankings 보스별 spec에서 추출 (가장 많이 쓰는 spec)
      const specCounts = new Map<string, number>();
      for (const zr of data.allZoneRankings) {
        for (const b of zr.bosses) {
          if (b.spec) specCounts.set(b.spec, (specCounts.get(b.spec) ?? 0) + 1);
        }
      }
      const heroSpec = [...specCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

      const mergedChar = {
        ...char,
        classID: data.classID || char.classID || 0,
        className: data.className || char.className || "",
        heroSpec, // 영웅특성 (Devourer, Slayer 등)
      };
      // 힐러 자동 감지: zoneRankings의 기본 스펙들 중 힐러 스펙이 있으면 HPS 모드
      const allBossSpecs = data.allZoneRankings.flatMap(zr => zr.bosses.map(b => b.spec)).filter(Boolean);
      const isHealer = allBossSpecs.some(s => isHealerSpec(s));
      setMetric(isHealer ? "hps" : "dps");
      console.log("[selectChar] 힐러 감지:", isHealer, "step → overview");
      setSelectedChar(mergedChar);
      setAllZoneRankings(data.allZoneRankings);
      setStep("overview");
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }

  /** 직업의 모든 기본 특성별로 상위 N명씩 병렬 조회 후 합쳐서 반환. 동일 조합은 캐시에서 반환. */
  async function fetchClassRankings(
    encounterID: number, className: string, difficulty: number, perSpec: number = 30,
    rankingMetric: "dps" | "hps" = "dps",
  ): Promise<WCLRanking[]> {
    // 캐시 키에 metric 포함 → DPS/HPS 별도 저장
    const key = `${encounterID}:${className}:${difficulty}:${perSpec}:${rankingMetric}`;
    const cached = rankingsCache.current.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<WCLRanking[]> => {
      const specs = ALL_SPECS[className];
      if (!specs || specs.length === 0) {
        console.warn(`[rankings] ${className}: ALL_SPECS 매핑 없음, spec 없이 단일 조회`);
        const { rankings } = await getEncounterRankings(encounterID, className, "", difficulty, 1, 0, rankingMetric);
        return rankings.slice(0, perSpec);
      }

      // spec별 상위 N명 병렬 조회. WCL은 spec 필터 적용 시 페이지당 100명 해당 spec만 반환.
      // allSettled: 한 spec 요청 실패(rate limit 등)가 전체를 막지 않도록.
      const settled = await Promise.allSettled(
        specs.map(async (spec) => {
          const { rankings } = await getEncounterRankings(encounterID, className, spec, difficulty, 1, 0, rankingMetric);
          return rankings.slice(0, perSpec);
        }),
      );

      const merged: WCLRanking[] = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") merged.push(...r.value);
        else console.warn(`[rankings] ${className}/${specs[i]} 실패:`, r.reason);
      });
      console.log(`[rankings] ${className} ${merged.length}명 수집 (${specs.length}개 spec × ${perSpec}, metric=${rankingMetric})`);
      return merged;
    })();

    rankingsCache.current.set(key, promise);
    promise.catch(() => rankingsCache.current.delete(key));
    return promise;
  }

  async function selectBossRanking(encounterID: number, encounterName: string, difficulty: number) {
    if (!selectedChar) return;
    setSelectedFight({ id: 0, name: encounterName, startTime: 0, endTime: 0, kill: true, difficulty, encounterID, friendlyPlayers: [] });
    setStatScan(null); setLoading(true); setError(null);
    try {
      const kills = await getMyEncounterRankings(
        selectedChar.name, selectedChar.serverSlug, selectedChar.region,
        encounterID, difficulty,
      );
      setMyKills(kills);
      if (kills.length <= 1) {
        // 킬이 1개 이하면 선택 화면 건너뛰고 바로 랭킹으로
        const top = await fetchClassRankings(encounterID, selectedChar.className, difficulty, 30, metric);
        setRankings(top);
        setStep("rankings");
      } else {
        setStep("myKills");
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }

  /** 내 킬 기록 선택 후 → 랭킹 목록 */
  async function selectMyKill(kill: { reportCode: string; fightID: number; amount: number; startTime: number; duration: number }) {
    if (!selectedFight || !selectedChar) return;
    setStatScan(null); setLoading(true); setError(null);
    try {
      // 선택한 킬의 리포트와 전투 정보 로드
      setLoadingMsg("리포트 로딩...");
      const report = await getReportInfo(kill.reportCode);
      const fight = report.fights.find((f) => f.id === kill.fightID);
      if (!fight) throw new Error("전투를 찾을 수 없습니다.");

      // damage table로 정확한 sourceID 확인
      const fightPlayers = await getFightPlayerIds(report.code, fight.startTime, fight.endTime);
      const myNameLower = selectedChar.name.toLowerCase();
      const myEntry = fightPlayers.find(p => p.name.toLowerCase() === myNameLower);
      const pid = myEntry?.id ?? report.players.find(p => p.name.toLowerCase() === myNameLower)?.id ?? null;
      if (!pid) throw new Error("리포트에서 내 캐릭터를 찾을 수 없습니다.");

      setReportInfo(report);
      setSelectedFight({ ...selectedFight!, ...fight });
      setMyPlayerId(pid);

      // 랭킹 로드
      setLoadingMsg("상위 플레이어 로딩...");
      const top = await fetchClassRankings(selectedFight!.encounterID, selectedChar.className, selectedFight!.difficulty, 30, metric);
      setRankings(top);
      setStep("rankings");
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); setLoadingMsg(""); }
  }

  async function doAnalysis(ranking: WCLRanking) {
    if (!selectedFight || !selectedChar) return;
    setRefSpec(ranking.spec ?? "");
    setStatScan(null);
    setLoading(true); setLoadingMsg("리포트 로딩..."); setError(null);
    try {
      // 내 리포트가 없거나 가짜 fight(보스 성적에서 바로 온 경우)면 자동 검색
      let myReport = reportInfo;
      let myPid = myPlayerId;
      let myFight = selectedFight;

      if (!myReport || myPid === null || myFight.startTime === 0) {
        // myKills가 이미 있으면 첫 번째(킬 1개로 건너뛴 경우), 없으면 조회
        let bestRank = myKills[0];
        if (!bestRank) {
          setLoadingMsg("내 킬 기록 조회...");
          const myRanks = await getMyEncounterRankings(
            selectedChar.name, selectedChar.serverSlug, selectedChar.region,
            selectedFight!.encounterID, selectedFight!.difficulty,
          );
          if (myRanks.length === 0) throw new Error("해당 보스의 내 킬 기록을 찾을 수 없습니다.");
          bestRank = myRanks[0];
        }
        console.log(`[doAnalysis] 내 킬 기록: report=${bestRank.reportCode}, fight=${bestRank.fightID}, dps=${bestRank.amount.toFixed(0)}`);

        setLoadingMsg("내 리포트 로딩...");
        myReport = await getReportInfo(bestRank.reportCode);
        const actualFight = myReport.fights.find((f) => f.id === bestRank.fightID);
        if (!actualFight) throw new Error("리포트에서 해당 전투를 찾을 수 없습니다.");
        myFight = actualFight;

        // damage table로 정확한 sourceID 확인
        const fightPlayers = await getFightPlayerIds(myReport.code, myFight.startTime, myFight.endTime);
        const myNameLower = selectedChar.name.toLowerCase();
        const myEntry = fightPlayers.find(p => p.name.toLowerCase() === myNameLower);
        if (myEntry) {
          myPid = myEntry.id;
        } else {
          const me = myReport.players.find((p) => p.name.toLowerCase() === myNameLower);
          if (!me) throw new Error("리포트에서 내 캐릭터를 찾을 수 없습니다.");
          myPid = me.id;
        }
        console.log(`[doAnalysis] 최종 sourceID=${myPid}`);

        setReportInfo(myReport);
        setSelectedFight(myFight);
        setMyPlayerId(myPid);
      } else {
        // selectMyKill에서 이미 설정된 경우 — sourceID 재확인
        setLoadingMsg("플레이어 ID 확인...");
        const fightPlayers = await getFightPlayerIds(myReport!.code, myFight.startTime, myFight.endTime);
        const myNameLower = selectedChar.name.toLowerCase();
        const myFightEntry = fightPlayers.find(p => p.name.toLowerCase() === myNameLower);
        if (myFightEntry && myFightEntry.id !== myPid) {
          console.log(`[doAnalysis] sourceID 보정: masterData=${myPid} → table=${myFightEntry.id}`);
          myPid = myFightEntry.id;
          setMyPlayerId(myPid);
        }
      }

      setLoadingMsg("상대 리포트 로딩...");
      const refInfo = await getReportInfo(ranking.reportCode);
      const refFight = refInfo.fights.find((f) => f.id === ranking.fightID);
      if (!refFight) throw new Error("비교 대상 전투를 찾을 수 없습니다.");
      // 상대방도 damage table로 정확한 sourceID 찾기
      const refFightPlayers = await getFightPlayerIds(ranking.reportCode, refFight.startTime, refFight.endTime);
      const refNameLower = ranking.name.toLowerCase();
      const refFightEntry = refFightPlayers.find(p => p.name.toLowerCase() === refNameLower);
      const refPlayer = refFightEntry
        ?? refInfo.players.find((p) => p.name.toLowerCase() === refNameLower);
      if (!refPlayer) throw new Error("비교 대상 플레이어를 찾을 수 없습니다.");

      setLoadingMsg("데이터 수집 + 분석 중...");
      const me = myReport!.players.find((p) => p.id === myPid);
      const result = await runFullAnalysis({
        myReport: myReport!, myFight, myPlayerId: myPid!,
        myClassID: selectedChar.classID, mySpec: me?.spec ?? "",
        myHeroSpec: selectedChar.heroSpec ?? "", myName: selectedChar.name,
        refReportCode: ranking.reportCode, refReport: refInfo, refFight,
        refPlayerId: refPlayer.id, refName: `${ranking.name}-${ranking.server}`,
        refHeroSpec: ranking.spec ?? "",
        isHealer: metric === "hps",
      });
      setAnalysis(result);

      // 스펠 아이콘 해석
      setLoadingMsg("스킬 아이콘 로딩...");
      const resolver = new SpellResolver();
      const ids = new Set<number>();
      for (const e of result.timeline) {
        if (e.my) ids.add(e.my.spellId);
        if (e.ref) ids.add(e.ref.spellId);
      }
      for (const e of result.damageBreakdown) ids.add(e.spellId);
      for (const c of result.cooldowns) ids.add(c.spellId);
      // 오라 spell ID도 해석 (아이콘 표시용)
      for (const a of result.myAuras) ids.add(a.spellId);
      for (const a of result.refAuras) ids.add(a.spellId);
      await resolver.resolveMany([...ids].map((id) => ({ id, localName: "" })));
      setSpellMeta(resolver.getAll());

      setActiveTab("summary");
      setStep("result");
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); setLoadingMsg(""); }
  }

  function goBack() {
    const backMap: Record<string, Step> = { result: "rankings", rankings: "overview", myKills: "overview", overview: "characters" };
    setStep(backMap[step] ?? "characters"); setError(null);
  }

  const cid = selectedChar?.classID ?? 0;
  const cColor = CLASS_COLORS[cid] ?? "#888";
  const cName = CLASS_NAMES_KR[cid] ?? "";
  const cIcon = getClassIconUrl(cid);

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0e0e16" }}>
        <div className="text-center">
          <h1 className="text-4xl font-black text-white mb-2 tracking-tight">WoWTeacher</h1>
          <p className="text-gray-500 mb-10 text-sm">상위권 플레이어와 플레이를 분석하세요</p>
          <button onClick={startAuth} className="px-10 py-3 rounded font-semibold text-white transition-all hover:brightness-110"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}>WarcraftLogs로 로그인</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0e0e16" }}>
      <nav style={{ background: "#131320", borderBottom: "1px solid #1c1c30" }}>
        <div className="max-w-[1200px] mx-auto px-3 sm:px-4 min-h-11 py-1.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <span className="text-sm font-bold text-white cursor-pointer flex-shrink-0" onClick={() => setStep("characters")}>WoWTeacher</span>
            {selectedChar && step !== "characters" && (
              <div className="flex items-center gap-1 text-xs min-w-0">
                <span className="text-gray-600 flex-shrink-0">&rsaquo;</span>
                <img src={cIcon} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                <span className="cursor-pointer hover:underline truncate" style={{ color: cColor }} onClick={() => setStep("overview")}>{selectedChar.name}</span>
                {selectedFight && (step === "rankings" || step === "result") && (
                  <><span className="text-gray-600 mx-1 flex-shrink-0">&rsaquo;</span><span className="text-gray-400 truncate max-w-[140px] sm:max-w-none">{encounterNameKr(selectedFight.name)}</span></>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs flex-shrink-0">
            <RateLimitBadge />
            {step !== "characters" && <button onClick={goBack} className="text-gray-500 hover:text-white">&larr; 뒤로</button>}
            <button onClick={() => { logout(); setAuthed(false); setStep("login"); }} className="text-gray-600 hover:text-gray-400">로그아웃</button>
          </div>
        </div>
      </nav>

      <div className="max-w-[1200px] mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 px-4 py-2.5 rounded text-sm flex items-center gap-2" style={{ background: "#2a1215", border: "1px solid #4a1a1f", color: "#f87171" }}>
            {error}<button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-400 text-xs">x</button>
          </div>
        )}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-5 h-5 border-2 border-gray-700 border-t-purple-500 rounded-full animate-spin" />
            {loadingMsg && <span className="text-xs text-gray-500">{loadingMsg}</span>}
          </div>
        )}

        {/* 1. 캐릭터 선택 */}
        {step === "characters" && !loading && (
          <div>
            <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">내 캐릭터</h2>
            {myChars.length === 0 ? <p className="text-gray-600 text-center py-12">등록된 캐릭터가 없습니다</p> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {myChars.map((c, i) => (
                  <button key={i} onClick={() => selectChar(c)} className="wcl-row flex items-center gap-3 p-3 text-left rounded">
                    <img src={getClassIconUrl(c.classID)} alt="" className="w-8 h-8 rounded border border-gray-700" onError={e => (e.currentTarget.style.display = "none")} />
                    <div>
                      <div className="text-sm font-semibold" style={{ color: CLASS_COLORS[c.classID] ?? "#888" }}>{c.name}</div>
                      <div className="text-[11px] text-gray-600">{c.server} - {CLASS_NAMES_KR[c.classID] ?? ""}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. 캐릭터 오버뷰 */}
        {step === "overview" && !loading && selectedChar && (
          <div>
            <div className="flex items-center gap-4 mb-6 pb-4" style={{ borderBottom: "1px solid #1c1c30" }}>
              <img src={cIcon} alt="" className="w-12 h-12 rounded border-2" style={{ borderColor: cColor }} onError={e => (e.currentTarget.style.display = "none")} />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold" style={{ color: cColor }}>{selectedChar.name}</h1>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ color: cColor, background: cColor + "15" }}>{cName}</span>
                  {selectedChar.heroSpec && (
                    <span className="text-xs px-2 py-0.5 rounded" style={{ color: "#a78bfa", background: "#a78bfa15" }}>{specNameKr(selectedChar.heroSpec)}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{selectedChar.server} - {selectedChar.region?.toUpperCase()}</div>
              </div>
            </div>

            {allZoneRankings.length > 0 && allZoneRankings.map((zr, zi) => (
              <div key={zi} className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-white">{zr.zoneName ? encounterNameKr(zr.zoneName) : "레이드 성적"}</h2>
                    {zr.difficulty > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: DIFFICULTY_COLORS[zr.difficulty] ?? "#888", background: (DIFFICULTY_COLORS[zr.difficulty] ?? "#888") + "15" }}>
                        {DIFFICULTY_NAMES[zr.difficulty] ?? ""}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Best Perf. Avg</div>
                    <div className="text-2xl font-black" style={{ color: getPercentileColor(zr.bestPerfAvg) }}>{zr.bestPerfAvg.toFixed(1)}</div>
                  </div>
                </div>
                <div className="wcl-table rounded">
                  <div className="wcl-table-header grid grid-cols-[1fr_60px_60px_90px_40px_60px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    <div>Boss</div><div className="text-right">Best %</div><div className="text-right">Med %</div><div className="text-right">DPS</div><div className="text-center">Kills</div><div className="text-right">Fastest</div>
                  </div>
                  {zr.bosses.map((b, i) => {
                    return (
                      <div key={i}
                        className="wcl-table-row grid grid-cols-[1fr_60px_60px_90px_40px_60px] px-3 py-2.5 items-center text-sm cursor-pointer"
                        onClick={() => selectBossRanking(b.encounterID, b.encounterName, zr.difficulty)}>
                        <div className="flex items-center gap-2">
                          <EncounterIcon encounterID={b.encounterID} />
                          <span className="text-gray-200 text-xs">{encounterNameKr(b.encounterName)}</span>
                        </div>
                        <div className="text-right"><PctCell value={b.rankPercent} /></div>
                        <div className="text-right"><PctCell value={b.medianPercent} /></div>
                        <div className="text-right text-xs text-gray-400 font-mono">{b.highestDPS > 0 ? fmtDPS(b.highestDPS) : "-"}</div>
                        <div className="text-center text-xs text-gray-500">{b.totalKills}</div>
                        <div className="text-right text-xs text-gray-500 font-mono">{b.fastestKill > 0 ? fmtDur(b.fastestKill) : "-"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

          </div>
        )}

        {/* 3.5 내 킬 기록 선택 */}
        {step === "myKills" && !loading && (
          <div>
            <div className="flex items-center gap-3 mb-1">
              <EncounterIcon encounterID={selectedFight?.encounterID ?? 0} size={32} />
              <h2 className="text-base font-semibold text-white">{selectedFight?.name ? encounterNameKr(selectedFight.name) : ""}</h2>
            </div>
            <p className="text-xs text-gray-500 mb-4">비교에 사용할 내 킬 기록을 선택하세요</p>
            <div className="wcl-table rounded">
              <div className="wcl-table-header grid grid-cols-[1fr_100px_80px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                <div>날짜</div><div className="text-right">DPS</div><div className="text-right">시간</div>
              </div>
              {myKills.map((kill, i) => {
                const date = new Date(kill.startTime);
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                const durSec = kill.duration / 1000;
                const durStr = `${Math.floor(durSec / 60)}:${String(Math.floor(durSec % 60)).padStart(2, "0")}`;
                return (
                  <button key={i} onClick={() => selectMyKill(kill)}
                    className="wcl-table-row w-full grid grid-cols-[1fr_100px_80px] px-3 py-2.5 items-center text-left">
                    <div className="text-xs text-gray-300">{dateStr}</div>
                    <div className="text-right text-xs font-mono text-orange-400">{kill.amount.toFixed(0)}</div>
                    <div className="text-right text-xs text-gray-500 font-mono">{durStr}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. 상위 랭킹 */}
        {step === "rankings" && !loading && (
          <RankingsView
            rankings={rankings}
            selectedFight={selectedFight}
            cName={cName}
            classID={selectedChar?.classID ?? 0}
            className={selectedChar?.className ?? ""}
            metric={metric}
            onMetricChange={async (m) => {
              setMetric(m);
              if (!selectedChar || !selectedFight) return;
              setLoading(true); setError(null);
              try {
                const top = await fetchClassRankings(selectedFight.encounterID, selectedChar.className, selectedFight.difficulty, 30, m);
                setRankings(top);
              } catch (e) { setError(errorMessage(e)); }
              finally { setLoading(false); }
            }}
            onAnalysis={doAnalysis}
          />
        )}

        {/* 5. 분석 결과 */}
        {step === "result" && analysis && (
          <AnalysisView analysis={analysis} spellMeta={spellMeta} cColor={cColor} activeTab={activeTab} setActiveTab={setActiveTab}
            rankings={rankings} refSpec={refSpec} statScan={statScan} setStatScan={setStatScan}
            statScanLoading={statScanLoading} setStatScanLoading={setStatScanLoading}
            statScanProgress={statScanProgress} setStatScanProgress={setStatScanProgress}
            setError={setError} />
        )}
      </div>
    </div>
  );
}

// ============================================
// 분석 결과 뷰
// ============================================

// ============================================
// WCL API 잔여 한도 배지
// ============================================

function RateLimitBadge() {
  const data = useSyncExternalStore(subscribeRateLimit, getRateLimitSnapshot);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;

  const elapsedSec = (now - data.observedAt) / 1000;
  const secondsLeft = Math.max(0, data.pointsResetIn - elapsedSec);
  const minutesLeft = Math.ceil(secondsLeft / 60);
  const used = data.limitPerHour > 0 ? data.pointsSpentThisHour / data.limitPerHour : 0;
  const remainPct = Math.max(0, Math.min(100, Math.round((1 - used) * 100)));

  const color = remainPct < 20 ? "#f87171" : remainPct < 50 ? "#fbbf24" : "#9ca3af";
  const tooltip = `WCL API 한도 ${data.pointsSpentThisHour.toFixed(0)}/${data.limitPerHour} 사용 · ${minutesLeft}분 후 초기화`;

  return (
    <span title={tooltip} className="text-[11px] font-mono tabular-nums select-none" style={{ color }}>
      API {remainPct}% · {minutesLeft}분
    </span>
  );
}

// ============================================
// 랭킹 뷰 (영웅특성 필터)
// ============================================

interface BuffCacheEntry {
  loading: boolean;
  error?: string;
  buffs?: Array<{ cfg: typeof EXTERNAL_BUFFS[number]; count: number; uptimePercent: number }>;
}

function RankingsView({ rankings, selectedFight, cName, classID, className, metric, onMetricChange, onAnalysis }: {
  rankings: WCLRanking[];
  selectedFight: WCLFight | null;
  cName: string;
  classID: number;
  className: string;
  metric: "dps" | "hps";
  onMetricChange: (m: "dps" | "hps") => void;
  onAnalysis: (r: WCLRanking) => void;
}) {
  const [specFilter, setSpecFilter] = useState<string>("all");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [bufCache, setBufCache] = useState<Map<string, BuffCacheEntry>>(new Map());

  // 특성별 수집
  const specCounts = new Map<string, number>();
  for (const r of rankings) {
    const spec = r.spec || "Unknown";
    specCounts.set(spec, (specCounts.get(spec) ?? 0) + 1);
  }
  const specList = [...specCounts.entries()].sort((a, b) => b[1] - a[1]);

  // 필터
  const filtered = specFilter === "all"
    ? rankings
    : rankings.filter(r => r.spec === specFilter);

  const classFallbackIcon = getClassIconUrl(classID);
  const specIconFor = (spec: string) => getSpecIconUrl(className, spec) || classFallbackIcon;

  const rankKey = (r: WCLRanking) => `${r.reportCode}:${r.fightID}:${r.name}`;

  async function loadBuffs(r: WCLRanking) {
    const key = rankKey(r);
    setBufCache(prev => new Map(prev).set(key, { loading: true }));
    try {
      const [fight, report] = await Promise.all([
        getFightTime(r.reportCode, r.fightID),
        getReportInfo(r.reportCode),
      ]);
      if (!fight) throw new Error("전투 시간을 찾을 수 없음");
      const player = report.players.find(p => p.name.toLowerCase() === r.name.toLowerCase());
      if (!player) throw new Error(`${r.name} 플레이어를 리포트에서 찾을 수 없음`);
      const table = await getBuffsTable(r.reportCode, player.id, fight.startTime, fight.endTime);
      const ext = EXTERNAL_BUFFS.map(cfg => {
        const hit = table.find(b => cfg.ids.includes(b.spellId) || cfg.nameRegex.test(b.name));
        return { cfg, count: hit?.totalUses ?? 0, uptimePercent: hit?.uptimePercent ?? 0 };
      });
      setBufCache(prev => new Map(prev).set(key, { loading: false, buffs: ext }));
    } catch (e) {
      setBufCache(prev => new Map(prev).set(key, { loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  function toggleExpand(r: WCLRanking) {
    const key = rankKey(r);
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    const entry = bufCache.get(key);
    if (!entry || (!entry.loading && !entry.buffs && !entry.error)) {
      void loadBuffs(r);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <EncounterIcon encounterID={selectedFight?.encounterID ?? 0} size={32} />
        <h2 className="text-base font-semibold text-white">{selectedFight?.name ? encounterNameKr(selectedFight.name) : ""}</h2>
        {/* DPS/HPS 토글 */}
        <div className="ml-auto flex items-center gap-1 rounded p-1" style={{ background: "#131320", border: "1px solid #1c1c30" }}>
          {(["dps", "hps"] as const).map(m => {
            const active = metric === m;
            return (
              <button key={m} onClick={() => { if (!active) onMetricChange(m); }}
                className="text-[11px] px-3 py-1 rounded font-bold transition-all"
                style={active
                  ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff" }
                  : { background: "transparent", color: "#9ca3af" }}>
                {m.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-gray-600 mb-4">{cName} 상위 플레이어 &mdash; 비교 대상을 선택하세요</p>

      {/* 특성 필터 */}
      <div className="wcl-card p-3 mb-4">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">특성 필터</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setSpecFilter("all")}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold transition-all hover:brightness-110"
            style={specFilter === "all"
              ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff" }
              : { background: "#1c1c30", color: "#9ca3af", border: "1px solid #2a2a40" }}>
            전체 <span className="text-[10px] opacity-70">({rankings.length})</span>
          </button>
          {specList.map(([spec, count]) => {
            const active = specFilter === spec;
            const icon = specIconFor(spec);
            return (
              <button key={spec} onClick={() => setSpecFilter(active ? "all" : spec)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold transition-all hover:brightness-110"
                style={active
                  ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff" }
                  : { background: "#1c1c30", color: "#d1d5db", border: "1px solid #2a2a40" }}>
                {icon && <img src={icon} alt="" className="w-4 h-4 rounded-sm" onError={e => (e.currentTarget.style.display = "none")} />}
                {specNameKr(spec)} <span className="text-[10px] opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 테이블 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-600 text-sm">데이터 없음</div>
      ) : (
        <div className="wcl-table rounded">
          <div className="wcl-table-header grid grid-cols-[30px_1fr_140px_90px_60px_110px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>#</div><div>플레이어</div><div>특성</div><div className="text-right">{metric.toUpperCase()}</div><div className="text-right">시간</div><div className="text-right">외부 버프</div>
          </div>
          {filtered.map((r, i) => {
            const key = rankKey(r);
            const expanded = expandedKeys.has(key);
            const cacheEntry = bufCache.get(key);
            return (
              <Fragment key={`${r.name}-${r.server}-${i}`}>
                <div className="wcl-table-row w-full grid grid-cols-[30px_1fr_140px_90px_60px_110px] px-3 py-2.5 items-center text-left cursor-pointer"
                  onClick={() => onAnalysis(r)}>
                  <div className="text-xs font-bold font-mono" style={{ color: i === 0 ? "#ffd700" : i < 3 ? "#c0c0c0" : "#888" }}>{i + 1}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-white truncate">{r.name}</span>
                    <span className="text-[10px] text-gray-600 truncate">{r.server}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400 min-w-0">
                    {(() => { const ic = specIconFor(r.spec); return ic ? <img src={ic} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" onError={e => (e.currentTarget.style.display = "none")} /> : null; })()}
                    <div className="flex flex-col leading-tight min-w-0">
                      <span className="text-gray-300 truncate">{specNameKr(r.spec)}</span>
                      {r.heroTalent && <span className="text-[9px] truncate" style={{ color: "#a78bfa" }}>{specNameKr(r.heroTalent)}</span>}
                    </div>
                  </div>
                  <div className="text-right text-xs font-mono" style={{ color: "#a78bfa" }}>{fmtDPS(r.amount)}</div>
                  <div className="text-right text-[11px] text-gray-500 font-mono">{fmtDur(r.duration)}</div>
                  <div className="flex justify-end">
                    <button onClick={(e) => { e.stopPropagation(); toggleExpand(r); }}
                      className="text-[11px] px-2.5 py-1 rounded font-semibold transition-all hover:brightness-110 flex items-center gap-1"
                      style={expanded
                        ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff" }
                        : { background: "#1c1c30", color: "#c4b5fd", border: "1px solid #3a2a60" }}>
                      {cacheEntry?.loading ? "..." : expanded ? "▲ 접기" : "버프 ▼"}
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="px-4 py-3" style={{ background: "linear-gradient(90deg, #0d0a1a, #0f0a20)", borderBottom: "1px solid #1c1c30", borderTop: "1px solid #2a1e4a" }}>
                    {cacheEntry?.loading && (
                      <div className="flex items-center gap-2 text-[11px] text-gray-400">
                        <div className="w-3 h-3 border-2 border-gray-700 border-t-purple-500 rounded-full animate-spin" />
                        <span>외부 버프 조회 중...</span>
                      </div>
                    )}
                    {cacheEntry?.error && <div className="text-[11px] text-red-400">조회 실패: {cacheEntry.error}</div>}
                    {cacheEntry?.buffs && (
                      <div className="flex flex-wrap gap-2">
                        {cacheEntry.buffs.map(({ cfg, count, uptimePercent }) => {
                          const received = count > 0;
                          return (
                            <div key={cfg.label} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                              style={received
                                ? { background: cfg.color + "18", border: `1px solid ${cfg.color}66` }
                                : { background: "#131320", border: "1px solid #2a2a40", opacity: 0.55 }}>
                              <span className="text-[11px] font-bold" style={{ color: received ? cfg.color : "#6b7280" }}>{cfg.label}</span>
                              {received ? (
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-base font-black text-white">{count}</span>
                                  <span className="text-[10px] text-gray-400">회</span>
                                  <span className="text-[10px] font-mono" style={{ color: cfg.color }}>· {uptimePercent}%</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-gray-600">미수령</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnalysisView({ analysis, spellMeta, cColor, activeTab, setActiveTab,
  rankings, refSpec, statScan, setStatScan, statScanLoading, setStatScanLoading,
  statScanProgress, setStatScanProgress, setError }: {
  analysis: FullAnalysis;
  spellMeta: Record<number, SpellMeta>;
  cColor: string;
  activeTab: string;
  setActiveTab: (t: string) => void;
  rankings: WCLRanking[];
  refSpec: string;
  statScan: TopStatsScanResult | null;
  setStatScan: (s: TopStatsScanResult | null) => void;
  statScanLoading: boolean;
  setStatScanLoading: (b: boolean) => void;
  statScanProgress: string;
  setStatScanProgress: (s: string) => void;
  setError: (s: string | null) => void;
}) {
  const a = analysis;


  return (
    <div className="space-y-4">
      {/* 헤더: 장비 비교 + DPS 요약 */}
      <div className="wcl-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm">
            <span style={{ color: cColor }}>{a.playerName}</span>
            {a.myHeroSpec && <span className="text-[10px] px-1.5 py-0.5 rounded ml-1" style={{ color: "#a78bfa", background: "#a78bfa15" }}>{a.myHeroSpec}</span>}
            <span className="text-gray-600 mx-2">vs</span>
            <span className="text-gray-300">{a.refName}</span>
            {a.refHeroSpec && <span className="text-[10px] px-1.5 py-0.5 rounded ml-1" style={{ color: "#fbbf24", background: "#fbbf2415" }}>{a.refHeroSpec}</span>}
            <span className="text-gray-600 ml-3 text-xs">{a.encounter}</span>
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>내 전투 {a.fightDuration.my.toFixed(0)}초</span>
            <span>상대 {a.fightDuration.ref.toFixed(0)}초</span>
          </div>
        </div>

        {/* 장비/DPS(HPS) 그리드 — 힐러 모드에선 analysis.healing 기반 */}
        {(() => {
          const metricLabel = a.isHealer ? "HPS" : "DPS";
          const my = a.isHealer ? (a.healing?.myTotalHPS ?? 0) : a.damage.myTotalDPS;
          const ref = a.isHealer ? (a.healing?.refTotalHPS ?? 0) : a.damage.refTotalDPS;
          const gap = a.isHealer ? (a.healing?.hpsGap ?? 0) : a.damage.dpsGap;
          const gapPct = a.isHealer ? (a.healing?.hpsGapPercent ?? 0) : a.damage.dpsGapPercent;
          return (
            <div className="grid grid-cols-4 gap-3" style={{ borderTop: "1px solid #1c1c30", paddingTop: 12 }}>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: "#a78bfa" }}>{fmtDPS(my)}</div>
                <div className="text-[10px] text-gray-600">내 {metricLabel}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: "#fbbf24" }}>{fmtDPS(ref)}</div>
                <div className="text-[10px] text-gray-600">상대 {metricLabel}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: a.gear.myIlvl >= a.gear.refIlvl ? "#4ade80" : "#f59e0b" }}>
                  {a.gear.myIlvl > 0 ? a.gear.myIlvl : "?"} <span className="text-xs text-gray-600">vs</span> {a.gear.refIlvl > 0 ? a.gear.refIlvl : "?"}
                </div>
                <div className="text-[10px] text-gray-600">아이템 레벨</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black" style={{ color: gap > 0 ? "#ef4444" : "#4ade80" }}>
                  {gap > 0 ? "-" : "+"}{fmtDPS(Math.abs(gap))}
                </div>
                <div className="text-[10px] text-gray-600">{metricLabel} 차이 ({Math.abs(gapPct).toFixed(0)}%)</div>
              </div>
            </div>
          );
        })()}

        {/* 스탯 비교 */}
        {(a.gear.myIlvl > 0 || a.gear.refIlvl > 0) && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1c1c30" }}>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px]">
              {["Haste", "CriticalStrike", "Mastery", "Versatility"].map(stat => {
                const myVal = a.gear.myStats[stat] ?? 0;
                const refVal = a.gear.refStats[stat] ?? 0;
                if (myVal === 0 && refVal === 0) return null;
                const label = { Haste: "가속", CriticalStrike: "치명타", Mastery: "특화", Versatility: "유연성" }[stat] ?? stat;
                return (
                  <span key={stat} className="text-gray-500">
                    {label}: <span className="text-gray-300">{myVal}</span> / <span className="text-gray-400">{refVal}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 탭 — 모바일에선 가로 스크롤, sm 이상에선 균등 분할 */}
      <div className="flex gap-1 p-1 rounded overflow-x-auto" style={{ background: "#131320" }}>
        {[
          ["summary", "개선 제안"],
          ["gear", "장비 비교"],
          ["patterns", "습관 분석"],
          ["timeline", "캐스트 타임라인"],
          ["cooldowns", "쿨다운"],
          [analysis.isHealer ? "healing" : "damage", analysis.isHealer ? "힐량 분석" : "피해 분석"],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`flex-shrink-0 sm:flex-1 sm:flex-shrink px-3 sm:px-0 text-xs py-2 rounded font-semibold whitespace-nowrap transition-all ${activeTab === key ? "text-white" : "text-gray-600 hover:text-gray-400"}`}
            style={activeTab === key ? { background: "#1c1c30" } : {}}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && <SuggestionsTab analysis={a} spellMeta={spellMeta} />}
      {activeTab === "gear" && <GearTab analysis={a} rankings={rankings} refSpec={refSpec}
        statScan={statScan} setStatScan={setStatScan}
        statScanLoading={statScanLoading} setStatScanLoading={setStatScanLoading}
        statScanProgress={statScanProgress} setStatScanProgress={setStatScanProgress}
        setError={setError} />}
      {activeTab === "patterns" && <PatternsTab analysis={a} spellMeta={spellMeta} />}
      {activeTab === "timeline" && <TimelineTab analysis={a} spellMeta={spellMeta} />}
      {activeTab === "cooldowns" && <CooldownsTab analysis={a} spellMeta={spellMeta} />}
      {activeTab === "damage" && !analysis.isHealer && <DamageTab analysis={a} spellMeta={spellMeta} />}
      {activeTab === "healing" && analysis.isHealer && <HealingTab analysis={a} spellMeta={spellMeta} />}
    </div>
  );
}

// ============================================
// 탭: 개선 제안
// ============================================

function SuggestionsTab({ analysis, spellMeta }: { analysis: FullAnalysis; spellMeta: Record<number, SpellMeta> }) {
  const categoryColors: Record<string, string> = {
    DPS: "#ef4444", 장비: "#3b82f6", 스탯: "#f59e0b", 가동률: "#22d3ee",
    자원: "#a78bfa", 탈태: "#c084fc", "빈 시간": "#f87171", 오프너: "#4ade80",
  };
  const s = analysis.suggestions;

  // 카테고리별 그룹핑
  const groups = new Map<string, typeof s>();
  for (const sg of s) {
    const arr = groups.get(sg.category);
    if (arr) arr.push(sg); else groups.set(sg.category, [sg]);
  }

  return (
    <div className="space-y-3">
      {/* 카테고리별 정보 */}
      {[...groups.entries()].map(([category, items]) => {
        const color = categoryColors[category] ?? "#888";
        return (
          <div key={category} className="wcl-card overflow-hidden">
            <div className="px-4 py-2 flex items-center gap-2" style={{ background: color + "10", borderBottom: `1px solid ${color}20` }}>
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-[11px] font-bold" style={{ color }}>{category}</span>
            </div>
            {items.map((sg, i) => {
              const meta = sg.spellId ? spellMeta[sg.spellId] : null;
              const iconUrl = meta?.iconUrl || "";
              return (
                <div key={i} className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid #16162a" }}>
                  {iconUrl && <img src={iconUrl} alt="" className="spell-icon flex-shrink-0" style={{ width: 20, height: 20 }} />}
                  <span className="text-sm text-gray-200">{sg.message}</span>
                </div>
              );
            })}
          </div>
        );
      })}

      {s.length === 0 && <div className="wcl-card p-6 text-center text-gray-500 text-sm">데이터 없음</div>}
    </div>
  );
}

// ============================================
// 탭: 장비 비교
// ============================================

const SLOT_NAMES = ["머리", "목", "어깨", "셔츠", "가슴", "허리", "다리", "발", "손목", "장갑", "손가락1", "손가락2", "장신구1", "장신구2", "등", "주무기", "보조무기"];
const QUALITY_COLORS: Record<number, string> = { 1: "#fff", 2: "#1eff00", 3: "#0070dd", 4: "#a335ee", 5: "#ff8000", 6: "#e6cc80" };

// 외부 딜 증가 버프 — 상위권 비교 시 핵심 지표
// WCL 응답 이름은 보통 영문. spell ID로도 매칭.
const EXTERNAL_BUFFS: Array<{ ids: number[]; nameRegex: RegExp; label: string; short: string; color: string }> = [
  { ids: [10060], nameRegex: /^power infusion$|^마력 주입$/i, label: "마력 주입", short: "마주", color: "#ec4899" },
  { ids: [395152], nameRegex: /^ebon might$|^흑요석 위세$/i, label: "흑요석 위세", short: "칠흑", color: "#f59e0b" },
  { ids: [410089], nameRegex: /^prescience$|^예지$/i, label: "예지", short: "예지", color: "#22d3ee" },
];

// 소모품 분류 — CombatantInfo.auras 이름 패턴
const CONSUMABLE_CATEGORIES: Array<{ label: string; test: (name: string) => boolean }> = [
  { label: "음식",       test: (n) => /well fed|식사|진수성찬/i.test(n) },
  { label: "플라스크",   test: (n) => /^phial\b|^flask\b|^영약|^엘릭서/i.test(n) },
  { label: "기름/돌",    test: (n) => /\boil\b|\bstone\b|whetstone|부싯돌|숫돌/i.test(n) },
  { label: "증강 룬",    test: (n) => /augment rune|draconic augment|증강 룬/i.test(n) },
];

function classifyConsumable(name: string): string | null {
  for (const c of CONSUMABLE_CATEGORIES) if (c.test(name)) return c.label;
  return null;
}

function GearTab({ analysis, rankings, refSpec, statScan, setStatScan, statScanLoading, setStatScanLoading, statScanProgress, setStatScanProgress, setError }: {
  analysis: FullAnalysis;
  rankings: WCLRanking[];
  refSpec: string;
  statScan: TopStatsScanResult | null;
  setStatScan: (s: TopStatsScanResult | null) => void;
  statScanLoading: boolean;
  setStatScanLoading: (b: boolean) => void;
  statScanProgress: string;
  setStatScanProgress: (s: string) => void;
  setError: (s: string | null) => void;
}) {
  const g = analysis.gear;
  const tabRef = useRef<HTMLDivElement>(null);

  // Wowhead 툴팁 새로고침 (React 렌더 후)
  useEffect(() => {
    if (tabRef.current && window.$WowheadPower) {
      window.$WowheadPower.refreshLinks();
    }
  });

  // 스탯 키 자동 감지 (WCL 응답 구조에 따라 다를 수 있음)
  const allStatKeys = new Set([...Object.keys(g.myStats), ...Object.keys(g.refStats)]);
  const STAT_LABELS: Record<string, string> = {
    Agility: "민첩", Stamina: "체력", CriticalStrike: "치명타", "Critical Strike": "치명타",
    Haste: "가속", Mastery: "특화", Versatility: "유연성",
    Intellect: "지능", Strength: "힘", Speed: "이속",
    Avoidance: "회피", Leech: "생기흡수",
  };
  // 주요 스탯만 필터
  const mainStats = [...allStatKeys].filter(k => STAT_LABELS[k] && ((g.myStats[k] ?? 0) > 0 || (g.refStats[k] ?? 0) > 0));

  return (
    <div className="space-y-4" ref={tabRef}>
      {/* 상위 10명 스탯 비교 스캔 — 현재 분석 중인 보스 전용 */}
      <div className="rounded-lg p-4" style={{ background: "linear-gradient(135deg, #1e1b3a, #2a1e4a)", border: "1px solid #7c3aed50" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-white">{encounterNameKr(analysis.encounter)} 상위 10명 스탯 비교</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {refSpec ? `${specNameKr(refSpec)} 특성` : "전체 특성"} · 선택한 보스 기준
            </div>
          </div>
          {statScan && (
            <button onClick={() => setStatScan(null)} className="text-[10px] text-gray-500 hover:text-white">다시 스캔</button>
          )}
        </div>
        {!statScan && !statScanLoading && rankings.length > 0 && (
          <button onClick={async () => {
            setStatScanLoading(true); setStatScanProgress("스캔 준비...");
            try {
              // 2차 스탯 가중치는 특성마다 다름 → 선택한 상대와 같은 기본 특성만 비교 대상.
              const sameSpec = refSpec ? rankings.filter(r => r.spec === refSpec) : rankings;
              const sample = sameSpec.slice(0, 10);
              if (sample.length === 0) {
                setError(`'${refSpec || "전체"}' 특성 샘플이 0명입니다.`);
                return;
              }
              const result = await scanTopStats(sample, g.myStats, g.myIlvl, (done, total) => {
                setStatScanProgress(`${done}/${total} 스캔 중...`);
              });
              setStatScan(result);
            } catch (e) { setError(errorMessage(e)); }
            finally { setStatScanLoading(false); setStatScanProgress(""); }
          }}
          className="w-full py-3 rounded text-sm font-bold text-white transition-all hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}>
            스캔 시작
          </button>
        )}
        {statScanLoading && (
          <div className="text-center py-4">
            <div className="w-4 h-4 border-2 border-gray-700 border-t-purple-500 rounded-full animate-spin mx-auto mb-2" />
            <span className="text-xs text-gray-400">{statScanProgress}</span>
          </div>
        )}
        {statScan && <StatScanResult scan={statScan} />}
      </div>

      {/* 영웅특성 */}
      {(g.myHeroTree || g.refHeroTree) && (
        <div className="wcl-card p-4">
          <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">영웅특성</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] text-gray-600 mb-1">나</div>
              {g.myHeroTree
                ? <span className="text-sm text-white font-semibold">{g.myHeroTree}</span>
                : <span className="text-gray-600 text-xs">정보 없음</span>}
            </div>
            <div>
              <div className="text-[10px] text-gray-600 mb-1">상대</div>
              {g.refHeroTree
                ? <span className="text-sm text-white font-semibold">{g.refHeroTree}</span>
                : <span className="text-gray-600 text-xs">정보 없음</span>}
            </div>
          </div>
        </div>
      )}

      {/* 스탯 비교 */}
      {mainStats.length > 0 && (
        <div className="wcl-card p-4">
          <h3 className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wider">스탯 비교</h3>
          <p className="text-[10px] text-gray-600 mb-3">
            * 전투 시작 시점 스냅샷 — 음식/플라스크/웨폰오일 및 pull 직전 걸린 외부 버프(마주·칠흑 등) 포함. 전투 중간에 발동된 본인 쿨기는 미포함.
          </p>
          <div className="wcl-table rounded">
            <div className="wcl-table-header grid grid-cols-[1fr_90px_90px_80px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <div>스탯</div><div className="text-right">나</div><div className="text-right">상대</div><div className="text-right">차이</div>
            </div>
            {mainStats.map(stat => {
              const myVal = g.myStats[stat] ?? 0;
              const refVal = g.refStats[stat] ?? 0;
              const diff = myVal - refVal;
              return (
                <div key={stat} className="grid grid-cols-[1fr_90px_90px_80px] px-3 py-2 text-xs" style={{ borderBottom: "1px solid #16162a" }}>
                  <div className="text-gray-300">{STAT_LABELS[stat] ?? stat}</div>
                  <div className="text-right font-mono text-gray-200">{myVal.toLocaleString()}</div>
                  <div className="text-right font-mono text-gray-400">{refVal.toLocaleString()}</div>
                  <div className="text-right font-mono" style={{ color: diff > 0 ? "#4ade80" : diff < 0 ? "#ef4444" : "#666" }}>
                    {diff > 0 ? "+" : ""}{diff.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 스탯이 비어있을 때 디버깅 */}
      {mainStats.length === 0 && (
        <div className="wcl-card p-4 text-center text-gray-500 text-xs">
          스탯 데이터 없음. 콘솔에서 [getCombatantInfo] stats 로그를 확인하세요.
        </div>
      )}

      {/* 활성 소모품 (전투 시작 시점 활성 오라에서 음식/플라스크/기름/룬 필터) */}
      {(() => {
        const myC = g.myAuras.map(a => ({ ...a, cat: classifyConsumable(a.name) })).filter(a => a.cat);
        const refC = g.refAuras.map(a => ({ ...a, cat: classifyConsumable(a.name) })).filter(a => a.cat);
        if (myC.length === 0 && refC.length === 0) return null;
        const renderList = (items: typeof myC) => (
          <div className="space-y-1">
            {CONSUMABLE_CATEGORIES.map(cat => {
              const entries = items.filter(i => i.cat === cat.label);
              if (entries.length === 0) return (
                <div key={cat.label} className="flex items-center gap-2 text-[10px]">
                  <span className="text-gray-600 w-14">{cat.label}</span>
                  <span className="text-gray-700">미사용</span>
                </div>
              );
              return entries.map((e, i) => (
                <div key={`${cat.label}-${i}`} className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-500 w-14">{cat.label}</span>
                  {e.icon && <img src={`${ICON_BASE}/${e.icon.replace(/\.jpg$/, "")}.jpg`} alt="" className="w-4 h-4 rounded-sm" onError={ev => (ev.currentTarget.style.display = "none")} />}
                  <span className="text-gray-200 truncate">{e.name}</span>
                </div>
              ));
            })}
          </div>
        );
        return (
          <div className="wcl-card p-4">
            <h3 className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wider">활성 소모품</h3>
            <p className="text-[10px] text-gray-600 mb-3">전투 시작 시 활성화된 오라에서 필터 (이름 패턴 기반)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-semibold mb-1" style={{ color: "#a78bfa" }}>나</div>
                {renderList(myC)}
              </div>
              <div>
                <div className="text-[10px] font-semibold mb-1" style={{ color: "#fbbf24" }}>상대</div>
                {renderList(refC)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 외부 버프 Uptime (마주/칠흑/예지 등) */}
      {(() => {
        const findAura = (auras: typeof analysis.myAuras, cfg: typeof EXTERNAL_BUFFS[number]) =>
          auras.find(a => cfg.ids.includes(a.spellId) || cfg.nameRegex.test(a.name));
        const rows = EXTERNAL_BUFFS.map(cfg => ({
          cfg,
          my: findAura(analysis.myAuras, cfg),
          ref: findAura(analysis.refAuras, cfg),
        })).filter(r => r.my || r.ref);
        if (rows.length === 0) return null;
        return (
          <div className="wcl-card p-4">
            <h3 className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wider">외부 버프 가동률</h3>
            <p className="text-[10px] text-gray-600 mb-3">상위권 비교 시 핵심 지표. 전투 전체 기준 uptime.</p>
            <div className="space-y-2">
              {rows.map(({ cfg, my, ref }) => {
                const myUp = my?.uptimePercent ?? 0;
                const refUp = ref?.uptimePercent ?? 0;
                const myCount = my?.windows.length ?? 0;
                const refCount = ref?.windows.length ?? 0;
                return (
                  <div key={cfg.label} className="grid grid-cols-[80px_1fr_1fr] gap-3 items-center">
                    <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                    <div>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="text-gray-400">나</span>
                        <span className="text-white font-mono">{myUp}% <span className="text-gray-500">({myCount}회)</span></span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#0d0d15" }}>
                        <div className="h-full rounded-full" style={{ width: `${myUp}%`, background: cfg.color }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="text-gray-400">상대</span>
                        <span className="text-white font-mono">{refUp}% <span className="text-gray-500">({refCount}회)</span></span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#0d0d15" }}>
                        <div className="h-full rounded-full" style={{ width: `${refUp}%`, background: cfg.color, opacity: 0.6 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 장비 리스트 — Wowhead 툴팁 연동 */}
      <div className="wcl-card p-4">
        <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">
          장비 비교 (템렙 {g.myIlvl} vs {g.refIlvl})
        </h3>
        <div className="wcl-table rounded">
          <div className="wcl-table-header grid grid-cols-[70px_1fr_1fr] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>슬롯</div><div>나</div><div>상대</div>
          </div>
          {SLOT_NAMES.map((slotName, idx) => {
            const myItem = g.myGear[idx];
            const refItem = g.refGear[idx];
            if (!myItem?.id && !refItem?.id) return null;
            const ilvlDiff = (myItem?.itemLevel ?? 0) - (refItem?.itemLevel ?? 0);
            return (
              <div key={idx} className="grid grid-cols-[70px_1fr_1fr] px-3 py-1.5 items-center" style={{ borderBottom: "1px solid #16162a" }}>
                <div className="text-[10px] text-gray-600">{slotName}</div>
                <GearItemCell item={myItem} ilvlDiff={ilvlDiff} />
                <GearItemCell item={refItem} ilvlDiff={-ilvlDiff} />
              </div>
            );
          })}
        </div>
      </div>


    </div>
  );
}

function GearItemCell({ item, ilvlDiff = 0 }: { item: GearItem | undefined; ilvlDiff?: number }) {
  if (!item?.id) return <div className="text-gray-700 text-[10px]">-</div>;
  const qColor = QUALITY_COLORS[item.quality] ?? "#888";
  const hasEnchant = item.permanentEnchant > 0;
  const hasGems = item.gems.length > 0;

  // Wowhead 링크: 호버 시 아이템 상세 툴팁 표시
  // ilvl/gems/enchant 파라미터 전달
  let wowheadParams = `ilvl=${item.itemLevel}`;
  if (item.permanentEnchant) wowheadParams += `&ench=${item.permanentEnchant}`;
  if (item.gems.length > 0) wowheadParams += `&gems=${item.gems.map(g => g.id).join(":")}`;
  const wowheadHref = `https://www.wowhead.com/item=${item.id}&${wowheadParams}`;
  const wowheadAttr = `item=${item.id}&${wowheadParams}`;

  return (
    <div className="flex items-start gap-1.5 min-w-0">
      {/* 아이콘 */}
      {item.icon && (
        <a href={wowheadHref} target="_blank" rel="noopener noreferrer" data-wowhead={wowheadAttr} className="flex-shrink-0">
          <img src={`${ICON_BASE}/${item.icon}.jpg`} alt="" className="w-6 h-6 rounded spell-icon"
            style={{ borderColor: qColor }}
            onError={e => (e.currentTarget.style.display = "none")} />
        </a>
      )}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        {/* 템렙 + 마부/보석/차이 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <a href={wowheadHref} target="_blank" rel="noopener noreferrer" data-wowhead={wowheadAttr}
            className="no-underline" style={{ textDecoration: "none" }}>
            <span className="text-[11px] font-mono font-bold" style={{ color: qColor }}>{item.itemLevel}</span>
          </a>
          {hasEnchant && <span className="text-[8px] px-1 rounded" style={{ color: "#4ade80", background: "#4ade8020" }}>마부</span>}
          {hasGems && (
            <span className="text-[8px] px-1 rounded" style={{ color: "#a78bfa", background: "#a78bfa20" }}>
              보석{item.gems.length > 1 ? `x${item.gems.length}` : ""}
            </span>
          )}
          {ilvlDiff !== 0 && Math.abs(ilvlDiff) >= 3 && (
            <span className="text-[8px] font-mono" style={{ color: ilvlDiff > 0 ? "#4ade80" : "#ef4444" }}>
              {ilvlDiff > 0 ? "+" : ""}{ilvlDiff}
            </span>
          )}
        </div>
        {/* 아이템 이름 — 모바일 호버 불가 대응 */}
        {item.name && (
          <a href={wowheadHref} target="_blank" rel="noopener noreferrer" data-wowhead={wowheadAttr}
            className="text-[9px] truncate no-underline leading-tight"
            style={{ color: qColor, textDecoration: "none", opacity: 0.85 }}
            title={item.name}>
            {item.name}
          </a>
        )}
      </div>
    </div>
  );
}

// ============================================
// 탭: 캐스트 타임라인 (핵심)
// ============================================

function TimelineTab({ analysis, spellMeta }: { analysis: FullAnalysis; spellMeta: Record<number, SpellMeta> }) {
  const [view, setView] = useState<"my" | "ref" | "both">("both");
  const [scrollRange, setScrollRange] = useState({ start: 0, end: 60 });
  const [showAuras, setShowAuras] = useState(true);
  const [auraFilter, setAuraFilter] = useState<Set<number>>(new Set());
  const [auraHideUnselected, setAuraHideUnselected] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const duration = Math.max(analysis.fightDuration.my, analysis.fightDuration.ref);
  const rangeLen = scrollRange.end - scrollRange.start;

  // 마우스 휠 + 터치 스와이프로 시간 스크롤
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const step = rangeLen * 0.15; // 범위의 15%씩 이동
      const delta = e.deltaY > 0 ? step : -step;
      setScrollRange(prev => {
        const newStart = Math.max(0, Math.min(duration - rangeLen, prev.start + delta));
        return { start: newStart, end: newStart + rangeLen };
      });
    };
    let prevX = 0;
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) prevX = e.touches[0].clientX;
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const curX = e.touches[0].clientX;
      const dx = prevX - curX;
      prevX = curX;
      if (Math.abs(dx) < 1) return;
      e.preventDefault();
      const width = el.clientWidth || 1;
      const step = (dx / width) * rangeLen;
      setScrollRange(prev => {
        const newStart = Math.max(0, Math.min(duration - rangeLen, prev.start + step));
        return { start: newStart, end: newStart + rangeLen };
      });
    };
    el.addEventListener("wheel", wheelHandler, { passive: false });
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheelHandler);
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
    };
  }, [rangeLen, duration]);

  // 시간 눈금
  const tickInterval = rangeLen <= 30 ? 5 : rangeLen <= 120 ? 10 : 30;
  const ticks: number[] = [];
  for (let t = Math.ceil(scrollRange.start / tickInterval) * tickInterval; t <= scrollRange.end; t += tickInterval) ticks.push(t);
  const toPercent = (sec: number) => ((sec - scrollRange.start) / rangeLen) * 100;

  // Wowhead 툴팁 새로고침
  useEffect(() => {
    if (window.$WowheadPower) {
      const wh = window.$WowheadPower;
      setTimeout(() => wh.refreshLinks(), 100);
    }
  }, [view, scrollRange]);

  // 데이터 준비
  const players = view === "both" ? ["my", "ref"] as const : [view] as const;

  const getPlayerCasts = (who: "my" | "ref") =>
    analysis.timeline.map(e => who === "my" ? e.my : e.ref).filter((c): c is CastSnapshot => c !== null);
  const getPlayerAuras = (who: "my" | "ref") =>
    who === "my" ? analysis.myAuras : analysis.refAuras;

  // 오라 아이콘 해석
  const auraIcon = (spellId: number) => spellMeta[spellId]?.iconUrl || "";

  return (
    <div>
      {/* 컨트롤 */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex gap-1">
          {([["my", "나"], ["ref", "상대"], ["both", "동시 비교"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setView(key)}
              className={`text-[10px] px-3 py-1 rounded font-semibold ${view === key ? "text-white" : "text-gray-600"}`}
              style={view === key ? { background: "#1c1c30" } : {}}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <button onClick={() => setShowAuras(!showAuras)}
            className="text-[11px] px-3 py-1 rounded font-semibold transition-all hover:brightness-110"
            style={showAuras
              ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff" }
              : { background: "#1c1c30", color: "#9ca3af", border: "1px solid #2a2a40" }}>
            오라 {showAuras ? "ON" : "OFF"}
          </button>
          {auraFilter.size > 0 && (
            <>
              <button onClick={() => setAuraHideUnselected(!auraHideUnselected)}
                className="text-[11px] px-3 py-1 rounded font-semibold transition-all hover:brightness-110"
                style={auraHideUnselected
                  ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff" }
                  : { background: "#1c1c30", color: "#9ca3af", border: "1px solid #2a2a40" }}>
                선택만 보기
              </button>
              <button onClick={() => { setAuraFilter(new Set()); setAuraHideUnselected(false); }}
                className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-white hover:bg-[#1c1c30] transition-colors">
                초기화
              </button>
            </>
          )}
          <span className="font-mono">{Math.round(scrollRange.start)}s ~ {Math.round(scrollRange.end)}s</span>
          <select value={rangeLen} onChange={e => {
            const len = Number(e.target.value);
            setScrollRange(prev => ({ start: prev.start, end: Math.min(prev.start + len, duration) }));
          }} className="text-[10px] bg-transparent text-gray-400 border border-gray-700 rounded px-1 py-0.5">
            <option value={5}>5초</option>
            <option value={10}>10초</option>
            <option value={30}>30초</option>
            <option value={60}>60초</option>
            <option value={120}>2분</option>
            <option value={Math.ceil(duration)}>전체</option>
          </select>
          <span className="text-[9px] text-gray-700">휠/터치 스크롤</span>
        </div>
      </div>

      {/* 타임라인 차트 (휠 스크롤 대상) */}
      <div ref={chartRef} className="space-y-3">
        {players.map(who => {
          const casts = getPlayerCasts(who);
          const auras = getPlayerAuras(who);
          const playerLabel = who === "my" ? "나" : "상대";
          const accentColor = who === "my" ? "#a78bfa" : "#fbbf24";

          // 스킬별 그룹 (이름으로 병합 — 같은 이름 다른 ID 통합)
          const spellGroupsByName = new Map<string, { spellId: number; casts: CastSnapshot[] }>();
          for (const c of casts) {
            const meta = spellMeta[c.spellId];
            const name = meta?.localName || meta?.name || c.spellName || `#${c.spellId}`;
            const existing = spellGroupsByName.get(name);
            if (existing) { existing.casts.push(c); }
            else { spellGroupsByName.set(name, { spellId: c.spellId, casts: [c] }); }
          }
          const sortedSpells = [...spellGroupsByName.entries()]
            .sort((a, b) => b[1].casts.length - a[1].casts.length)
            .map(([name, { spellId, casts: groupCasts }]) => [spellId, groupCasts, name] as [number, CastSnapshot[], string]);

          // 오라: "선택만 보기" ON이면 선택된 것만, 아니면 전부
          const visibleAuras = auras
            .filter(a => a.uptimePercent < 98)
            .filter(a => !auraHideUnselected || auraFilter.size === 0 || auraFilter.has(a.spellId))
            .slice(0, 20);

          return (
            <div key={who} className="wcl-card rounded overflow-hidden">
              {/* 플레이어 라벨 + 시간축 */}
              <div className="relative h-6" style={{ background: "#0d0d15", borderBottom: "1px solid #1c1c30" }}>
                <span className="absolute left-2 top-1 text-[9px] font-bold" style={{ color: accentColor }}>{playerLabel}</span>
                <div style={{ marginLeft: 140 }}>
                  {ticks.map(t => (
                    <span key={t} className="absolute text-[9px] text-gray-600 font-mono" style={{ left: `calc(140px + ${toPercent(t)}% * (100% - 140px) / 100%)`, top: 4 }}>
                      {t}s
                    </span>
                  ))}
                </div>
              </div>

              {/* 오라 바 */}
              {showAuras && visibleAuras.map(aura => {
                const visibleWindows = aura.windows.filter(w => w.end >= scrollRange.start && w.start <= scrollRange.end);
                if (visibleWindows.length === 0) return null;
                const hue = (aura.spellId * 137) % 360;
                const color = `hsl(${hue}, 60%, 55%)`;
                const isSelected = auraFilter.has(aura.spellId);
                const isDimmed = auraFilter.size > 0 && !isSelected;
                const icon = auraIcon(aura.spellId);
                const barH = aura.isStacking ? 16 : 12;

                return (
                  <div key={`aura-${aura.spellId}`} className="flex items-center cursor-pointer"
                    style={{ borderBottom: "1px solid #16162a", minHeight: barH + 8, opacity: isDimmed ? 0.3 : 1 }}
                    onClick={() => {
                      const next = new Set(auraFilter);
                      if (next.has(aura.spellId)) next.delete(aura.spellId); else next.add(aura.spellId);
                      setAuraFilter(next);
                    }}>
                    <div className="flex items-center gap-1 px-2 flex-shrink-0" style={{ width: 140 }}>
                      {icon ? <img src={icon} alt="" style={{ width: 16, height: 16, borderRadius: 2, border: isSelected ? `2px solid ${color}` : `1px solid ${color}60` }} />
                        : <div className="w-3 h-3 rounded flex-shrink-0" style={{ background: color }} />}
                      <span className="text-[9px] truncate" style={{ color: isSelected ? "#fff" : color }}>{aura.name}</span>
                      {aura.isStacking && <span className="text-[8px] text-gray-600">x{aura.maxStacks}</span>}
                      <span className="text-[8px] text-gray-700 ml-auto">{aura.uptimePercent}%</span>
                    </div>
                    <div className="relative flex-1" style={{ height: barH + 4 }}>
                      {visibleWindows.map((w, wi) => {
                        const left = Math.max(0, toPercent(w.start));
                        const right = Math.min(100, toPercent(w.end));
                        const width = right - left;
                        if (width <= 0) return null;
                        // 스택형: 높이를 스택 수에 비례
                        const stackRatio = aura.isStacking && aura.maxStacks > 0 ? w.stacks / aura.maxStacks : 1;
                        const h = Math.max(3, barH * stackRatio);
                        const opacity = 0.3 + stackRatio * 0.7;
                        return (
                          <div key={wi} className="absolute rounded-sm group" style={{
                            left: `${left}%`, width: `${width}%`,
                            height: h, bottom: 2,
                            background: color, opacity,
                          }}>
                            {aura.isStacking && w.stacks > 0 && width > 2 && (
                              <span className="absolute inset-0 flex items-center justify-center text-[7px] text-white font-bold" style={{ textShadow: "0 0 2px #000" }}>
                                {w.stacks}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {showAuras && visibleAuras.length > 0 && <div style={{ height: 2, background: "#1c1c30" }} />}

              {/* 스킬 행 */}
              {sortedSpells.map(([spellId, spellCasts, groupName]) => {
                const meta = spellMeta[spellId];
                const icon = meta?.iconUrl || "";
                const vis = spellCasts.filter(c => c.timestamp >= scrollRange.start && c.timestamp <= scrollRange.end);
                if (vis.length === 0) return null;

                return (
                  <div key={groupName} className="flex items-center" style={{ borderBottom: "1px solid #16162a", minHeight: 28 }}>
                    <div className="flex items-center gap-1.5 px-2 flex-shrink-0" style={{ width: 140 }}>
                      {icon ? <img src={icon} alt="" className="spell-icon" style={{ width: 18, height: 18 }} /> : <div className="w-[18px] h-[18px] rounded bg-gray-800" />}
                      <span className="text-[10px] text-gray-300 truncate">{groupName}</span>
                      <span className="text-[9px] text-gray-600">{spellCasts.length}</span>
                    </div>
                    <div className="relative flex-1 h-7">
                      {vis.map((c, i) => {
                        const pct = toPercent(c.timestamp);
                        if (pct < 0 || pct > 100) return null;
                        return (
                          <a key={i} className="absolute top-0.5 group" style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                            href={`https://www.wowhead.com/spell=${spellId}`}
                            data-wowhead={`spell=${spellId}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.preventDefault()}>
                            {icon ? (
                              <img src={icon} alt="" style={{ width: 20, height: 20, border: `1.5px solid ${accentColor}40`, borderRadius: 3 }} />
                            ) : (
                              <div style={{ width: 20, height: 20, background: "#333", borderRadius: 3 }} />
                            )}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1.5 bg-black/95 text-[9px] text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20" style={{ minWidth: 120 }}>
                              <div className="font-bold">{groupName}</div>
                              <div className="text-gray-400">ID: {spellId} | {c.timestamp.toFixed(1)}s</div>
                              <div className="text-gray-400">자원: {Math.round(c.resource)}{c.soulFragments > 0 ? ` | sf: ${c.soulFragments}` : ""}</div>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// 탭: 쿨다운
// ============================================

function CooldownsTab({ analysis, spellMeta }: { analysis: FullAnalysis; spellMeta: Record<number, SpellMeta> }) {
  const [selectedSpell, setSelectedSpell] = useState<number | null>(null);
  const fightDuration = Math.max(analysis.fightDuration.my, analysis.fightDuration.ref);

  // 모든 스킬 수집: 캐스트 + 오라
  const allSkills: Array<{ spellId: number; type: "cast" | "aura"; myCount: number; refCount: number }> = [];
  const seen = new Set<number>();

  // 캐스트 스킬
  const myCastCounts = new Map<number, number>();
  const refCastCounts = new Map<number, number>();
  for (const e of analysis.timeline) {
    if (e.my) myCastCounts.set(e.my.spellId, (myCastCounts.get(e.my.spellId) ?? 0) + 1);
    if (e.ref) refCastCounts.set(e.ref.spellId, (refCastCounts.get(e.ref.spellId) ?? 0) + 1);
  }
  const allCastIds = new Set([...myCastCounts.keys(), ...refCastCounts.keys()]);
  for (const id of allCastIds) {
    allSkills.push({ spellId: id, type: "cast", myCount: myCastCounts.get(id) ?? 0, refCount: refCastCounts.get(id) ?? 0 });
    seen.add(id);
  }

  // 오라 (캐스트에 없는 것만)
  const allAuraIds = new Set([...analysis.myAuras.map(a => a.spellId), ...analysis.refAuras.map(a => a.spellId)]);
  for (const id of allAuraIds) {
    if (seen.has(id)) continue;
    const myAura = analysis.myAuras.find(a => a.spellId === id);
    const refAura = analysis.refAuras.find(a => a.spellId === id);
    if ((myAura?.uptimePercent ?? 0) >= 98 && (refAura?.uptimePercent ?? 0) >= 98) continue; // 상시 패시브 제외
    allSkills.push({ spellId: id, type: "aura", myCount: myAura?.windows.length ?? 0, refCount: refAura?.windows.length ?? 0 });
  }

  // 사용 횟수 내림차순
  allSkills.sort((a, b) => (b.myCount + b.refCount) - (a.myCount + a.refCount));

  // 선택된 스킬 상세
  const sel = selectedSpell;
  const selMeta = sel ? spellMeta[sel] : null;
  const selName = selMeta?.localName || selMeta?.name || (sel ? `#${sel}` : "");
  const selIcon = selMeta?.iconUrl || "";

  // 선택된 스킬의 캐스트 타이밍
  const myTimings = sel ? analysis.timeline.filter(e => e.my?.spellId === sel).map(e => e.my!.timestamp) : [];
  const refTimings = sel ? analysis.timeline.filter(e => e.ref?.spellId === sel).map(e => e.ref!.timestamp) : [];

  // 선택된 스킬의 오라 정보
  const myAura = sel ? analysis.myAuras.find(a => a.spellId === sel) : null;
  const refAura = sel ? analysis.refAuras.find(a => a.spellId === sel) : null;

  // 쿨타임 추정 (캐스트 간격 평균)
  const estimateCd = (timings: number[]) => {
    if (timings.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < timings.length; i++) total += timings[i] - timings[i - 1];
    return Math.round(total / (timings.length - 1));
  };

  return (
    <div className="flex gap-4" style={{ minHeight: 400 }}>
      {/* 왼쪽: 스킬 목록 (액티브/버프 구분) */}
      <div className="flex-shrink-0 overflow-y-auto" style={{ width: 220, maxHeight: 600 }}>
        {(["cast", "aura"] as const).map(type => {
          const items = allSkills.filter(s => s.type === type);
          if (items.length === 0) return null;
          return (
            <div key={type} className="mb-3">
              <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1 px-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: type === "cast" ? "#4ade80" : "#a78bfa" }} />
                {type === "cast" ? "액티브 스킬" : "버프 / 오라"} ({items.length})
              </div>
              {items.map(s => {
                const meta = spellMeta[s.spellId];
                const icon = meta?.iconUrl || "";
                const name = meta?.localName || meta?.name || `#${s.spellId}`;
                const isActive = selectedSpell === s.spellId;
                return (
                  <button key={s.spellId} onClick={() => setSelectedSpell(s.spellId)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left mb-0.5"
                    style={{ background: isActive ? "#1c1c30" : undefined, border: isActive ? "1px solid #2a2a40" : "1px solid transparent" }}>
                    {icon ? <img src={icon} alt="" className="spell-icon" style={{ width: 18, height: 18 }} /> : <div className="w-[18px] h-[18px] rounded bg-gray-800 flex-shrink-0" />}
                    <span className={`text-[10px] truncate flex-1 ${isActive ? "text-white" : "text-gray-400"}`}>{name}</span>
                    <span className="text-[9px] text-gray-600 flex-shrink-0">{s.myCount}/{s.refCount}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 오른쪽: 상세 */}
      <div className="flex-1">
        {!sel ? (
          <div className="wcl-card p-8 text-center text-gray-500 text-sm">왼쪽에서 스킬을 선택하세요</div>
        ) : (
          <div className="space-y-3">
            {/* 헤더 */}
            <div className="wcl-card p-4 flex items-center gap-3">
              {selIcon ? <img src={selIcon} alt="" className="spell-icon" style={{ width: 32, height: 32 }} /> : <div className="w-8 h-8 rounded bg-gray-800" />}
              <div>
                <div className="text-sm text-white font-semibold">{selName}</div>
                <div className="text-[10px] text-gray-600">ID: {sel}</div>
              </div>
              <div className="ml-auto grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-sm font-bold" style={{ color: "#a78bfa" }}>{myTimings.length}회</div>
                  <div className="text-[9px] text-gray-600">내 사용</div>
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: "#fbbf24" }}>{refTimings.length}회</div>
                  <div className="text-[9px] text-gray-600">상대 사용</div>
                </div>
                {estimateCd(myTimings) > 0 && (
                  <div>
                    <div className="text-sm font-bold text-gray-300">~{estimateCd(myTimings)}초</div>
                    <div className="text-[9px] text-gray-600">추정 쿨타임</div>
                  </div>
                )}
              </div>
            </div>

            {/* 타이밍 비교 바 */}
            {(myTimings.length > 0 || refTimings.length > 0) && (
              <div className="wcl-card p-4">
                <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">사용 타이밍</h4>
                <div className="space-y-1">
                  {[{ label: "나", timings: myTimings, color: "#a78bfa" },
                    { label: "상대", timings: refTimings, color: "#fbbf24" }].map(({ label, timings, color }) => (
                    <div key={label} className="relative h-5 rounded" style={{ background: "#0d0d15" }}>
                      {timings.map((t, i) => (
                        <div key={i} className="absolute top-0 h-5 w-1.5 rounded-sm group" style={{ left: `${(t / fightDuration) * 100}%`, background: color }}>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1 py-0.5 bg-black text-[8px] text-white rounded opacity-0 group-hover:opacity-100 pointer-events-none z-10 whitespace-nowrap">
                            {t.toFixed(1)}s
                          </div>
                        </div>
                      ))}
                      <span className="absolute right-1 top-0 text-[8px] text-gray-600 leading-5">{label}</span>
                    </div>
                  ))}
                  <div className="relative h-3">
                    {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                      <span key={pct} className="absolute text-[8px] text-gray-700 font-mono" style={{ left: `${pct * 100}%`, transform: "translateX(-50%)" }}>
                        {Math.round(fightDuration * pct)}s
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 오라 가동률 (버프인 경우) */}
            {(myAura || refAura) && (
              <div className="wcl-card p-4">
                <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">버프 가동률</h4>
                <div className="grid grid-cols-2 gap-3">
                  {[{ label: "나", aura: myAura, color: "#a78bfa" },
                    { label: "상대", aura: refAura, color: "#fbbf24" }].map(({ label, aura, color }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-500">{label}</span>
                        <span className="text-xs font-bold" style={{ color }}>{aura?.uptimePercent ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full" style={{ background: "#1c1c30" }}>
                        <div className="h-2 rounded-full" style={{ width: `${aura?.uptimePercent ?? 0}%`, background: color }} />
                      </div>
                      {aura?.isStacking && (
                        <div className="text-[9px] text-gray-600 mt-1">최대 스택: {aura.maxStacks}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 사용 시점 목록 */}
            {myTimings.length > 0 && (
              <div className="wcl-card p-4">
                <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">상세 타이밍</h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  {[{ label: "나", timings: myTimings, color: "#a78bfa" },
                    { label: "상대", timings: refTimings, color: "#fbbf24" }].map(({ label, timings, color }) => (
                    <div key={label}>
                      <div className="text-[10px] font-semibold mb-1" style={{ color }}>{label}</div>
                      {timings.map((t, i) => {
                        const gap = i > 0 ? t - timings[i - 1] : null;
                        return (
                          <div key={i} className="flex items-center gap-2 py-0.5" style={{ borderBottom: "1px solid #16162a" }}>
                            <span className="text-gray-500 w-4 text-right">{i + 1}</span>
                            <span className="text-gray-300 font-mono">{t.toFixed(1)}s</span>
                            {gap !== null && <span className="text-gray-600 font-mono">(+{gap.toFixed(0)}s)</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// 탭: 피해 분석
// ============================================

function DamageTab({ analysis, spellMeta }: { analysis: FullAnalysis; spellMeta: Record<number, SpellMeta> }) {
  const tb = analysis.targetBreakdown;

  return (
    <div className="space-y-4">
      {/* 대상별 피해 (보스 vs 쫄) */}
      <div className="wcl-card p-4">
        <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">대상별 피해 (보스 vs 쫄)</h3>

        {/* 보스/쫄 비율 바 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {[
            { label: "나", bossPct: tb.myBossPercent, bossDmg: tb.myBossDmg, addDmg: tb.myAddDmg, color: "#a78bfa" },
            { label: "상대", bossPct: tb.refBossPercent, bossDmg: tb.refBossDmg, addDmg: tb.refAddDmg, color: "#fbbf24" },
          ].map(({ label, bossPct, bossDmg, addDmg, color }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
                <span className="text-[10px] text-gray-500">보스 {bossPct}%</span>
              </div>
              <div className="flex h-4 rounded overflow-hidden" style={{ background: "#0d0d15" }}>
                <div style={{ width: `${bossPct}%`, background: "#ef4444" }} title={`보스: ${fmtDPS(bossDmg)}`} />
                <div style={{ width: `${100 - bossPct}%`, background: "#3b82f6" }} title={`쫄: ${fmtDPS(addDmg)}`} />
              </div>
              <div className="flex justify-between text-[9px] mt-0.5">
                <span className="text-red-400">보스 {fmtDPS(bossDmg)}</span>
                <span className="text-blue-400">쫄 {fmtDPS(addDmg)}</span>
              </div>
            </div>
          ))}
        </div>


        {/* 대상별 테이블 */}
        {tb.targets.length > 0 && (
          <div className="wcl-table rounded">
            <div className="wcl-table-header grid grid-cols-[1fr_90px_90px_60px_60px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <div>대상</div><div className="text-right">나</div><div className="text-right">상대</div><div className="text-right">나 %</div><div className="text-right">상대 %</div>
            </div>
            {tb.targets.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_90px_60px_60px] px-3 py-1.5 text-xs items-center" style={{ borderBottom: "1px solid #16162a" }}>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.isBoss ? "#ef4444" : "#3b82f6" }} />
                  <span className={`${t.isBoss ? "text-white font-semibold" : "text-gray-400"}`}>{t.name}</span>
                  {t.isBoss && <span className="text-[8px] px-1 rounded" style={{ color: "#ef4444", background: "#ef444420" }}>보스</span>}
                </div>
                <div className="text-right font-mono text-gray-300">{fmtDPS(t.myDamage)}</div>
                <div className="text-right font-mono text-gray-500">{fmtDPS(t.refDamage)}</div>
                <div className="text-right font-mono" style={{ color: "#a78bfa" }}>{t.myPercent}%</div>
                <div className="text-right font-mono text-gray-500">{t.refPercent}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 피해 비중 테이블 */}
      <div className="wcl-table rounded">
        <div className="wcl-table-header grid grid-cols-[1fr_100px_100px_70px_70px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>스킬</div><div className="text-right">나 (피해)</div><div className="text-right">상대 (피해)</div><div className="text-right">나 %</div><div className="text-right">상대 %</div>
        </div>
        {analysis.damageBreakdown.slice(0, 20).map((s, i) => {
          const meta = spellMeta[s.spellId];
          const iconUrl = meta?.iconUrl || (s.icon ? `${ICON_BASE}/${s.icon}.jpg` : "");
          const name = meta?.localName || meta?.name || s.spellName;
          return (
            <div key={i} className="grid grid-cols-[1fr_100px_100px_70px_70px] px-3 py-2 items-center" style={{ borderBottom: "1px solid #16162a" }}>
              <div className="flex items-center gap-2">
                {iconUrl ? <img src={iconUrl} alt="" className="spell-icon" style={{ width: 20, height: 20 }} loading="lazy" /> : <div className="w-5 h-5 rounded bg-gray-800" />}
                <span className="text-xs text-gray-200">{name}</span>
              </div>
              <div className="text-right text-xs font-mono text-gray-300">{fmtDPS(s.myDamage)}</div>
              <div className="text-right text-xs font-mono text-gray-500">{fmtDPS(s.refDamage)}</div>
              <div className="text-right text-xs font-bold" style={{ color: "#a78bfa" }}>{s.myPercent.toFixed(1)}%</div>
              <div className="text-right text-xs font-mono text-gray-500">{s.refPercent.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {/* DPS 추이 — 캐스트 타임라인과 동일한 UI */}
      <DpsTimeline analysis={analysis} />
    </div>
  );
}

// ============================================
// 탭: 힐량 분석 (DamageTab 미러, targetBreakdown 섹션 제거)
// ============================================

function HealingTab({ analysis, spellMeta }: { analysis: FullAnalysis; spellMeta: Record<number, SpellMeta> }) {
  const heal = analysis.healing;
  const breakdown = analysis.healingBreakdown ?? [];

  if (!heal) {
    return (
      <div className="wcl-card p-6 text-center text-gray-500 text-xs">
        힐량 데이터를 불러오지 못했습니다. WCL 응답 확인이 필요합니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 요약 카드 — 총 HPS */}
      <div className="wcl-card p-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="내 HPS" value={fmtDPS(heal.myTotalHPS)} color="#a78bfa" />
          <StatCard label="상대 HPS" value={fmtDPS(heal.refTotalHPS)} color="#fbbf24" />
          <StatCard label="HPS 차이" value={`${heal.hpsGap > 0 ? "-" : "+"}${fmtDPS(Math.abs(heal.hpsGap))}`}
            color={heal.hpsGap > 0 ? "#ef4444" : "#4ade80"} />
        </div>
      </div>

      {/* 힐량 비중 테이블 */}
      <div className="wcl-table rounded">
        <div className="wcl-table-header grid grid-cols-[1fr_100px_100px_70px_70px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>스킬</div><div className="text-right">나 (힐량)</div><div className="text-right">상대 (힐량)</div><div className="text-right">나 %</div><div className="text-right">상대 %</div>
        </div>
        {breakdown.slice(0, 20).map((s, i) => {
          const meta = spellMeta[s.spellId];
          const iconUrl = meta?.iconUrl || (s.icon ? `${ICON_BASE}/${s.icon}.jpg` : "");
          const name = meta?.localName || meta?.name || s.spellName;
          return (
            <div key={i} className="grid grid-cols-[1fr_100px_100px_70px_70px] px-3 py-2 items-center" style={{ borderBottom: "1px solid #16162a" }}>
              <div className="flex items-center gap-2">
                {iconUrl ? <img src={iconUrl} alt="" className="spell-icon" style={{ width: 20, height: 20 }} loading="lazy" /> : <div className="w-5 h-5 rounded bg-gray-800" />}
                <span className="text-xs text-gray-200">{name}</span>
              </div>
              <div className="text-right text-xs font-mono text-gray-300">{fmtDPS(s.myDamage)}</div>
              <div className="text-right text-xs font-mono text-gray-500">{fmtDPS(s.refDamage)}</div>
              <div className="text-right text-xs font-bold" style={{ color: "#a78bfa" }}>{s.myPercent.toFixed(1)}%</div>
              <div className="text-right text-xs font-mono text-gray-500">{s.refPercent.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {/* HPS 추이 */}
      <HpsTimeline analysis={analysis} />
    </div>
  );
}

function HpsTimeline({ analysis }: { analysis: FullAnalysis }) {
  const h = analysis.healing;
  const duration = Math.max(analysis.fightDuration.my, analysis.fightDuration.ref);
  const myDuration = analysis.fightDuration.my;
  const refDuration = analysis.fightDuration.ref;
  const [scrollRange, setScrollRange] = useState({ start: 0, end: duration });
  const [showMy, setShowMy] = useState(true);
  const [showRef, setShowRef] = useState(true);
  const chartRef = useRef<HTMLDivElement>(null);
  const rangeLen = scrollRange.end - scrollRange.start;
  const maxHPS = h ? Math.max(...h.timeline.map(t => Math.max(
    showMy ? t.myHPS : 0,
    showRef ? t.refHPS : 0,
  )), 1) : 1;
  const CHART_H = 300;

  const toggleMy = () => { if (showMy && !showRef) return; setShowMy(v => !v); };
  const toggleRef = () => { if (showRef && !showMy) return; setShowRef(v => !v); };

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const step = rangeLen * 0.15;
      const delta = e.deltaY > 0 ? step : -step;
      setScrollRange(prev => {
        const s = Math.max(0, Math.min(duration - rangeLen, prev.start + delta));
        return { start: s, end: s + rangeLen };
      });
    };
    let prevX = 0;
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) prevX = e.touches[0].clientX;
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const curX = e.touches[0].clientX;
      const dx = prevX - curX;
      prevX = curX;
      if (Math.abs(dx) < 1) return;
      e.preventDefault();
      const width = el.clientWidth || 1;
      const step = (dx / width) * rangeLen;
      setScrollRange(prev => {
        const s = Math.max(0, Math.min(duration - rangeLen, prev.start + step));
        return { start: s, end: s + rangeLen };
      });
    };
    el.addEventListener("wheel", wheelHandler, { passive: false });
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheelHandler);
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
    };
  }, [rangeLen, duration]);

  if (!h) return null;

  const toX = (sec: number) => ((sec - scrollRange.start) / rangeLen) * 100;

  const tickInterval = rangeLen <= 30 ? 5 : rangeLen <= 120 ? 10 : 30;
  const ticks: number[] = [];
  for (let t = Math.ceil(scrollRange.start / tickInterval) * tickInterval; t <= scrollRange.end; t += tickInterval) ticks.push(t);

  const visible = h.timeline.filter(t => t.endSec >= scrollRange.start && t.startSec <= scrollRange.end);

  return (
    <div className="wcl-card rounded" ref={chartRef}>
      <div className="flex items-center justify-between px-4 py-2" style={{ background: "#0f0f1a", borderBottom: "1px solid #1c1c30" }}>
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-gray-400">HPS 추이</span>
          <div className="flex gap-3 text-[10px]">
            <button onClick={toggleMy}
              className="flex items-center gap-1 transition-opacity hover:brightness-110"
              style={{ opacity: showMy ? 1 : 0.35, textDecoration: showMy ? "none" : "line-through" }}>
              <span className="w-3 h-2 rounded-sm" style={{ background: "#a78bfa" }} /> 나 {fmtDPS(h.myTotalHPS)} ({myDuration.toFixed(0)}s)
            </button>
            <button onClick={toggleRef}
              className="flex items-center gap-1 transition-opacity hover:brightness-110"
              style={{ opacity: showRef ? 1 : 0.35, textDecoration: showRef ? "none" : "line-through" }}>
              <span className="w-3 h-2 rounded-sm" style={{ background: "#fbbf24" }} /> 상대 {fmtDPS(h.refTotalHPS)} ({refDuration.toFixed(0)}s)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span className="font-mono">{Math.round(scrollRange.start)}s ~ {Math.round(scrollRange.end)}s</span>
          <select value={Math.round(rangeLen)} onChange={e => {
            const len = Number(e.target.value);
            setScrollRange(prev => ({ start: prev.start, end: Math.min(prev.start + len, duration) }));
          }} className="text-[10px] bg-transparent text-gray-400 border border-gray-700 rounded px-1 py-0.5">
            <option value={5}>5초</option>
            <option value={10}>10초</option>
            <option value={30}>30초</option>
            <option value={60}>60초</option>
            <option value={120}>2분</option>
            <option value={Math.ceil(duration)}>전체</option>
          </select>
          <span className="text-[9px] text-gray-700">휠/터치 스크롤</span>
        </div>
      </div>

      <div className="flex">
        <div className="flex flex-col justify-between py-1 pr-1 flex-shrink-0" style={{ width: 50, height: CHART_H }}>
          {[1, 0.75, 0.5, 0.25, 0].map(p => (
            <span key={p} className="text-[8px] text-gray-700 font-mono text-right">{fmtDPS(maxHPS * p)}</span>
          ))}
        </div>

        <div className="relative flex-1" style={{ height: CHART_H, background: "#0a0a12" }}>
          {[0.25, 0.5, 0.75].map(p => (
            <div key={p} className="absolute w-full" style={{ top: `${(1 - p) * 100}%`, borderTop: "1px solid #151520" }} />
          ))}

          {showMy && visible.filter(t => t.startSec <= myDuration).map((t, i) => {
            const left = Math.max(0, toX(t.startSec));
            const right = Math.min(100, toX(t.endSec));
            const w = right - left;
            if (w <= 0) return null;
            const hh = maxHPS > 0 ? (t.myHPS / maxHPS) * 100 : 0;
            return <div key={`my-${i}`} className="absolute bottom-0" style={{ left: `${left}%`, width: `${w}%`, height: `${hh}%`, background: "#a78bfa25", borderTop: "2px solid #a78bfa" }} />;
          })}

          {showRef && visible.filter(t => t.startSec <= refDuration).map((t, i) => {
            const left = Math.max(0, toX(t.startSec));
            const right = Math.min(100, toX(t.endSec));
            const w = right - left;
            if (w <= 0) return null;
            const hh = maxHPS > 0 ? (t.refHPS / maxHPS) * 100 : 0;
            return <div key={`ref-${i}`} className="absolute bottom-0" style={{ left: `${left}%`, width: `${w}%`, height: `${hh}%`, background: "#fbbf2420", borderTop: "2px solid #fbbf24" }} />;
          })}

          {visible.map((t, i) => {
            const left = Math.max(0, toX(t.startSec));
            const right = Math.min(100, toX(t.endSec));
            const w = right - left;
            if (w <= 0) return null;
            return (
              <div key={`h-${i}`} className="absolute top-0 h-full group" style={{ left: `${left}%`, width: `${w}%`, zIndex: 5 }}>
                <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-1.5 bg-black/95 text-[9px] text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10" style={{ minWidth: 120 }}>
                  <div className="font-bold">{t.startSec}~{t.endSec}s</div>
                  {showMy && <div><span style={{ color: "#a78bfa" }}>나: {fmtDPS(t.myHPS)}</span></div>}
                  {showRef && <div><span style={{ color: "#fbbf24" }}>상대: {fmtDPS(t.refHPS)}</span></div>}
                  {showMy && showRef && <div className="text-gray-500">차이: {t.gap > 0 ? "-" : "+"}{fmtDPS(Math.abs(t.gap))}</div>}
                </div>
                <div className="absolute top-0 h-full w-px bg-white/10 left-1/2 opacity-0 group-hover:opacity-100" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex">
        <div style={{ width: 50 }} className="flex-shrink-0" />
        <div className="relative flex-1 h-4 mt-1 mb-2">
          {ticks.map(t => (
            <span key={t} className="absolute text-[8px] text-gray-600 font-mono" style={{ left: `${toX(t)}%`, transform: "translateX(-50%)" }}>{t}s</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function DpsTimeline({ analysis }: { analysis: FullAnalysis }) {
  const d = analysis.damage;
  const duration = Math.max(analysis.fightDuration.my, analysis.fightDuration.ref);
  const myDuration = analysis.fightDuration.my;
  const refDuration = analysis.fightDuration.ref;
  const [scrollRange, setScrollRange] = useState({ start: 0, end: duration });
  const [showMy, setShowMy] = useState(true);
  const [showRef, setShowRef] = useState(true);
  const chartRef = useRef<HTMLDivElement>(null);
  const rangeLen = scrollRange.end - scrollRange.start;
  // 활성 시리즈 기준으로 Y축 최대값 재계산 — 한쪽만 볼 때 그 값으로 확대
  const maxDPS = Math.max(...d.timeline.map(t => Math.max(
    showMy ? t.myDPS : 0,
    showRef ? t.refDPS : 0,
  )), 1);
  const CHART_H = 300;

  // 범례 토글 — 둘 다 끄는 상태는 방지 (빈 차트 무의미)
  const toggleMy = () => { if (showMy && !showRef) return; setShowMy(v => !v); };
  const toggleRef = () => { if (showRef && !showMy) return; setShowRef(v => !v); };

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const step = rangeLen * 0.15;
      const delta = e.deltaY > 0 ? step : -step;
      setScrollRange(prev => {
        const s = Math.max(0, Math.min(duration - rangeLen, prev.start + delta));
        return { start: s, end: s + rangeLen };
      });
    };
    let prevX = 0;
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) prevX = e.touches[0].clientX;
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const curX = e.touches[0].clientX;
      const dx = prevX - curX;
      prevX = curX;
      if (Math.abs(dx) < 1) return;
      e.preventDefault();
      const width = el.clientWidth || 1;
      const step = (dx / width) * rangeLen;
      setScrollRange(prev => {
        const s = Math.max(0, Math.min(duration - rangeLen, prev.start + step));
        return { start: s, end: s + rangeLen };
      });
    };
    el.addEventListener("wheel", wheelHandler, { passive: false });
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheelHandler);
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
    };
  }, [rangeLen, duration]);

  const toX = (sec: number) => ((sec - scrollRange.start) / rangeLen) * 100;

  const tickInterval = rangeLen <= 30 ? 5 : rangeLen <= 120 ? 10 : 30;
  const ticks: number[] = [];
  for (let t = Math.ceil(scrollRange.start / tickInterval) * tickInterval; t <= scrollRange.end; t += tickInterval) ticks.push(t);

  const visible = d.timeline.filter(t => t.endSec >= scrollRange.start && t.startSec <= scrollRange.end);

  return (
    <div className="wcl-card rounded overflow-hidden" ref={chartRef}>
      {/* 컨트롤 */}
      <div className="flex items-center justify-between px-4 py-2" style={{ background: "#0f0f1a", borderBottom: "1px solid #1c1c30" }}>
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-gray-400">DPS 추이</span>
          <div className="flex gap-3 text-[10px]">
            <button onClick={toggleMy}
              className="flex items-center gap-1 transition-opacity hover:brightness-110"
              style={{ opacity: showMy ? 1 : 0.35, textDecoration: showMy ? "none" : "line-through" }}
              title={showMy ? "나 숨기기" : "나 표시"}>
              <span className="w-3 h-2 rounded-sm" style={{ background: "#a78bfa" }} /> 나 {fmtDPS(d.myTotalDPS)} ({myDuration.toFixed(0)}s)
            </button>
            <button onClick={toggleRef}
              className="flex items-center gap-1 transition-opacity hover:brightness-110"
              style={{ opacity: showRef ? 1 : 0.35, textDecoration: showRef ? "none" : "line-through" }}
              title={showRef ? "상대 숨기기" : "상대 표시"}>
              <span className="w-3 h-2 rounded-sm" style={{ background: "#fbbf24" }} /> 상대 {fmtDPS(d.refTotalDPS)} ({refDuration.toFixed(0)}s)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span className="font-mono">{Math.round(scrollRange.start)}s ~ {Math.round(scrollRange.end)}s</span>
          <select value={Math.round(rangeLen)} onChange={e => {
            const len = Number(e.target.value);
            setScrollRange(prev => ({ start: prev.start, end: Math.min(prev.start + len, duration) }));
          }} className="text-[10px] bg-transparent text-gray-400 border border-gray-700 rounded px-1 py-0.5">
            <option value={5}>5초</option>
            <option value={10}>10초</option>
            <option value={30}>30초</option>
            <option value={60}>60초</option>
            <option value={120}>2분</option>
            <option value={Math.ceil(duration)}>전체</option>
          </select>
          <span className="text-[9px] text-gray-700">휠/터치 스크롤</span>
        </div>
      </div>

      {/* 차트 */}
      <div className="flex">
        {/* Y축 */}
        <div className="flex flex-col justify-between py-1 pr-1 flex-shrink-0" style={{ width: 50, height: CHART_H }}>
          {[1, 0.75, 0.5, 0.25, 0].map(p => (
            <span key={p} className="text-[8px] text-gray-700 font-mono text-right">{fmtDPS(maxDPS * p)}</span>
          ))}
        </div>

        {/* 차트 영역 */}
        <div className="relative flex-1" style={{ height: CHART_H, background: "#0a0a12" }}>
          {/* 그리드 */}
          {[0.25, 0.5, 0.75].map(p => (
            <div key={p} className="absolute w-full" style={{ top: `${(1 - p) * 100}%`, borderTop: "1px solid #151520" }} />
          ))}

          {/* 전투 종료 마커 */}
          {refDuration < myDuration && toX(refDuration) > 0 && toX(refDuration) < 100 && (
            <div className="absolute top-0 h-full" style={{ left: `${toX(refDuration)}%`, borderLeft: "1px dashed #fbbf2440" }}>
              <span className="absolute top-1 left-1 text-[7px] text-yellow-600">상대 종료</span>
            </div>
          )}
          {myDuration < refDuration && toX(myDuration) > 0 && toX(myDuration) < 100 && (
            <div className="absolute top-0 h-full" style={{ left: `${toX(myDuration)}%`, borderLeft: "1px dashed #a78bfa40" }}>
              <span className="absolute top-1 left-1 text-[7px] text-purple-600">내 종료</span>
            </div>
          )}

          {/* 나 — 면적 바 */}
          {showMy && visible.filter(t => t.startSec <= myDuration).map((t, i) => {
            const left = Math.max(0, toX(t.startSec));
            const right = Math.min(100, toX(t.endSec));
            const w = right - left;
            if (w <= 0) return null;
            const h = maxDPS > 0 ? (t.myDPS / maxDPS) * 100 : 0;
            return <div key={`my-${i}`} className="absolute bottom-0" style={{ left: `${left}%`, width: `${w}%`, height: `${h}%`, background: "#a78bfa25", borderTop: "2px solid #a78bfa" }} />;
          })}

          {/* 상대 — 면적 바 */}
          {showRef && visible.filter(t => t.startSec <= refDuration).map((t, i) => {
            const left = Math.max(0, toX(t.startSec));
            const right = Math.min(100, toX(t.endSec));
            const w = right - left;
            if (w <= 0) return null;
            const h = maxDPS > 0 ? (t.refDPS / maxDPS) * 100 : 0;
            return <div key={`ref-${i}`} className="absolute bottom-0" style={{ left: `${left}%`, width: `${w}%`, height: `${h}%`, background: "#fbbf2420", borderTop: "2px solid #fbbf24" }} />;
          })}

          {/* 호버 영역 */}
          {visible.map((t, i) => {
            const left = Math.max(0, toX(t.startSec));
            const right = Math.min(100, toX(t.endSec));
            const w = right - left;
            if (w <= 0) return null;
            return (
              <div key={`h-${i}`} className="absolute top-0 h-full group" style={{ left: `${left}%`, width: `${w}%`, zIndex: 5 }}>
                <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-1.5 bg-black/95 text-[9px] text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10" style={{ minWidth: 120 }}>
                  <div className="font-bold">{t.startSec}~{t.endSec}s</div>
                  {showMy && <div><span style={{ color: "#a78bfa" }}>나: {fmtDPS(t.myDPS)}</span></div>}
                  {showRef && <div><span style={{ color: "#fbbf24" }}>상대: {fmtDPS(t.refDPS)}</span></div>}
                  {showMy && showRef && <div className="text-gray-500">차이: {t.gap > 0 ? "-" : "+"}{fmtDPS(Math.abs(t.gap))}</div>}
                </div>
                <div className="absolute top-0 h-full w-px bg-white/10 left-1/2 opacity-0 group-hover:opacity-100" />
              </div>
            );
          })}
        </div>
      </div>

      {/* X축 */}
      <div className="flex">
        <div style={{ width: 50 }} className="flex-shrink-0" />
        <div className="relative flex-1 h-4 mt-1 mb-2">
          {ticks.map(t => (
            <span key={t} className="absolute text-[8px] text-gray-600 font-mono" style={{ left: `${toX(t)}%`, transform: "translateX(-50%)" }}>{t}s</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// 탭: 습관 분석
// ============================================

function PatternsTab({ analysis, spellMeta }: { analysis: FullAnalysis; spellMeta: Record<number, SpellMeta> }) {
  const p = analysis.patterns;
  if (!p) return <div className="wcl-card p-6 text-center text-gray-500 text-sm">패턴 분석 데이터 없음</div>;

  const spell = (id: number) => {
    const m = spellMeta[id];
    return { name: m?.localName || m?.name || `#${id}`, icon: m?.iconUrl || "" };
  };

  return (
    <div className="space-y-5">
      {/* 탈태 사용 비교 — 데이터 있을 때만 */}
      {(p.metaUsage.myCount > 0 || p.metaUsage.refCount > 0) && (
        <div className="wcl-card p-4">
          <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">탈태(변신) 사용</h3>
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="내 탈태 횟수" value={`${p.metaUsage.myCount}회`} color="#a78bfa" />
            <StatCard label="상대 탈태 횟수" value={`${p.metaUsage.refCount}회`} color="#fbbf24" />
            <StatCard label="내 탈태당 캐스트" value={`${p.metaUsage.myAvgCasts}`} color={p.metaUsage.myAvgCasts < p.metaUsage.refAvgCasts ? "#ef4444" : "#4ade80"} />
            <StatCard label="상대 탈태당 캐스트" value={`${p.metaUsage.refAvgCasts}`} color="#fbbf24" />
          </div>
        </div>
      )}

      {/* 오프너 비교 */}
      <div className="wcl-card p-4">
        <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">오프너 (첫 {p.opener.my.length} GCD)</h3>
        <div className="grid grid-cols-2 gap-3">
          {[{ label: "나", data: p.opener.my, other: p.opener.ref, borderColor: "#f59e0b" },
            { label: "상대", data: p.opener.ref, other: p.opener.my, borderColor: "#3b82f6" }].map(({ label, data, other, borderColor }) => (
            <div key={label}>
              <div className="text-[10px] text-gray-600 mb-1">{label}</div>
              <div className="flex flex-wrap gap-1">
                {data.map((c, i) => {
                  const s = spell(c.spellId);
                  const diff = i < other.length && c.spellId !== other[i].spellId;
                  return (
                    <div key={i} className="group relative">
                      <div className="flex flex-col items-center" style={{ opacity: diff ? 1 : 0.6 }}>
                        <span className="text-[8px] text-gray-700 mb-0.5">{i + 1}</span>
                        {s.icon ? <img src={s.icon} alt="" className="spell-icon" style={{ width: 26, height: 26, border: diff ? `2px solid ${borderColor}` : undefined }} /> : <div className="w-[26px] h-[26px] rounded bg-gray-800" />}
                        <span className="text-[8px] text-gray-600 mt-0.5">{Math.round(c.resource)}</span>
                        {c.isDuringMeta && <span className="text-[6px] text-purple-400">M</span>}
                      </div>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black/95 text-[9px] text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">{s.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 상태별(일반/탈태) 분석 */}
      {p.byState.map((state, si) => (
        (state.myCasts > 3 || state.refCasts > 3) && (
          <div key={si} className="wcl-card p-4">
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wider flex items-center gap-2">
              <span style={{ color: state.isMeta ? "#a78bfa" : "#gray-400" }}>
                {state.label} 상태
              </span>
              <span className="text-[10px] text-gray-600 font-normal">나 {state.myCasts}캐 / 상대 {state.refCasts}캐</span>
            </h3>

            {/* 스킬 사용 빈도 Top */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[{ label: "나", ranking: state.mySpellRanking, color: "#a78bfa" },
                { label: "상대", ranking: state.refSpellRanking, color: "#fbbf24" }].map(({ label, ranking, color }) => (
                <div key={label}>
                  <div className="text-[10px] text-gray-600 mb-1">{label} 스킬 사용 비중</div>
                  {ranking.slice(0, 6).map((s, j) => {
                    const sp = spell(s.spellId);
                    return (
                      <div key={j} className="flex items-center gap-1.5 mb-0.5">
                        {sp.icon ? <img src={sp.icon} alt="" className="spell-icon" style={{ width: 16, height: 16 }} title={sp.name} /> : <div className="w-4 h-4 rounded bg-gray-800" />}
                        <div className="flex-1 h-2 rounded-full" style={{ background: "#1c1c30" }}>
                          <div className="h-2 rounded-full" style={{ width: `${s.pct}%`, background: color }} />
                        </div>
                        <span className="text-[10px] text-gray-400 w-12 text-right">{s.pct}%</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* 2연속 시퀀스 */}
            <div className="grid grid-cols-2 gap-4">
              {[{ label: "나", top: state.bigrams.myTop },
                { label: "상대", top: state.bigrams.refTop }].map(({ label, top }) => (
                <div key={label}>
                  <div className="text-[10px] text-gray-600 mb-1">{label} 자주 쓰는 조합</div>
                  {top.slice(0, 5).map((s, i) => (
                    <div key={i} className="flex items-center gap-1 mb-0.5">
                      <SeqIcons seq={s.seq} spellMeta={spellMeta} />
                      <span className="text-[10px] text-gray-400 ml-auto">{s.pct}%</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* 시퀀스 차이 */}
            {(state.bigrams.missingFromMe.length > 0 || state.bigrams.onlyMe.length > 0) && (
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1c1c30" }}>
                {state.bigrams.missingFromMe.map((s, i) => (
                  <div key={`m${i}`} className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: "#ef4444", background: "#ef444420" }}>부족</span>
                    <SeqIcons seq={s.seq} spellMeta={spellMeta} />
                    <span className="text-[10px] text-gray-500">상대 {s.refPct}% / 나 {s.myPct}%</span>
                  </div>
                ))}
                {state.bigrams.onlyMe.map((s, i) => (
                  <div key={`o${i}`} className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: "#f59e0b", background: "#f59e0b20" }}>과다</span>
                    <SeqIcons seq={s.seq} spellMeta={spellMeta} />
                    <span className="text-[10px] text-gray-500">나 {s.myPct}% / 상대 {s.refPct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ))}

      {/* 빈 시간 패턴 */}
      {p.preGapPatterns.length > 0 && (
        <div className="wcl-card p-4">
          <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">빈 GCD 직전 패턴 ({p.preGapPatterns.length}회)</h3>
          <div className="space-y-2">
            {p.preGapPatterns.slice(0, 8).map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600 font-mono w-14">{g.gapStart.toFixed(1)}s</span>
                <div className="flex gap-0.5">
                  {g.lastCasts.map((c, j) => {
                    const s = spell(c.spellId);
                    return s.icon ? <img key={j} src={s.icon} alt="" className="spell-icon" style={{ width: 18, height: 18 }} title={s.name} /> : <div key={j} className="w-[18px] h-[18px] rounded bg-gray-800" />;
                  })}
                </div>
                <span className="text-[10px] font-mono" style={{ color: "#ef4444" }}>{g.gapDuration.toFixed(1)}s 빈 시간</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SeqIcons({ seq, spellMeta }: { seq: number[]; spellMeta: Record<number, SpellMeta> }) {
  return (
    <div className="flex items-center gap-0.5">
      {seq.map((id, i) => {
        const m = spellMeta[id];
        const icon = m?.iconUrl || "";
        return (
          <div key={i} className="flex items-center">
            {icon ? <img src={icon} alt="" className="spell-icon" style={{ width: 18, height: 18 }} title={m?.localName || m?.name || ""} /> : <div className="w-[18px] h-[18px] rounded bg-gray-800" />}
            {i < seq.length - 1 && <span className="text-[8px] text-gray-700 mx-0.5">&rarr;</span>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// 공용 컴포넌트
// ============================================

function StatScanResult({ scan }: { scan: TopStatsScanResult }) {
  const verdictColors = { high: "#f59e0b", low: "#ef4444", ok: "#4ade80" };
  const verdictLabels = { high: "과다", low: "부족", ok: "적정" };

  return (
    <div className="wcl-card p-4 mt-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Top {scan.scanned} 스탯 비교
        </h3>
        <span className="text-[10px] text-gray-600">
          성공 {scan.scanned} / 실패 {scan.failed}
        </span>
      </div>

      <div className="wcl-table rounded">
        <div className="wcl-table-header grid grid-cols-[1fr_70px_70px_70px_70px_60px_60px] px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>스탯</div><div className="text-right">나</div><div className="text-right">평균</div>
          <div className="text-right">최소</div><div className="text-right">최대</div>
          <div className="text-right">차이</div><div className="text-center">판정</div>
        </div>
        {scan.distributions.map((d, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_70px_70px_70px_60px_60px] px-3 py-2 text-xs items-center"
            style={{ borderBottom: "1px solid #16162a" }}>
            <div className="text-gray-300 font-semibold">{d.label}</div>
            <div className="text-right font-mono text-white">{d.myValue.toLocaleString()}</div>
            <div className="text-right font-mono text-gray-400">{d.avg.toLocaleString()}</div>
            <div className="text-right font-mono text-gray-600">{d.min.toLocaleString()}</div>
            <div className="text-right font-mono text-gray-600">{d.max.toLocaleString()}</div>
            <div className="text-right font-mono" style={{ color: verdictColors[d.verdict] }}>
              {d.diff > 0 ? "+" : ""}{d.diff.toLocaleString()}
            </div>
            <div className="text-center">
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ color: verdictColors[d.verdict], background: verdictColors[d.verdict] + "20" }}>
                {verdictLabels[d.verdict]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 요약 */}
      {scan.distributions.filter(d => d.verdict !== "ok").length > 0 && (
        <div className="mt-3 space-y-1">
          {scan.distributions.filter(d => d.verdict !== "ok").map((d, i) => (
            <div key={i} className="text-xs text-gray-400">
              <span style={{ color: verdictColors[d.verdict] }}>{d.label}</span>
              {d.verdict === "high"
                ? ` 상위권 대비 ${Math.abs(d.diffPercent)}% 과다`
                : ` 상위권 대비 ${Math.abs(d.diffPercent)}% 부족`}
            </div>
          ))}
        </div>
      )}

      {/* 개별 프로필 */}
      {scan.profiles.length > 0 && (
        <details className="mt-3">
          <summary className="text-[10px] text-gray-600 cursor-pointer hover:text-gray-400">개별 플레이어 스탯 ({scan.profiles.length}명)</summary>
          <div className="mt-2 max-h-40 overflow-y-auto">
            {scan.profiles.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-0.5" style={{ borderBottom: "1px solid #16162a" }}>
                <span className="text-gray-400 w-24 truncate">{p.name}</span>
                <span className="text-gray-600 w-8">i{p.ilvl}</span>
                {["CriticalStrike", "Haste", "Mastery", "Versatility"].map(stat => (
                  <span key={stat} className="text-gray-500 font-mono w-12 text-right">{(p.stats[stat] ?? 0).toLocaleString()}</span>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="wcl-card p-3 text-center">
      <div className="text-lg font-black" style={{ color }}>{value}</div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  );
}

function EncounterIcon({ encounterID, size = 24 }: { encounterID: number; size?: number }) {
  if (!encounterID) return <div style={{ width: size, height: size }} className="rounded bg-gray-800 flex-shrink-0" />;
  return <img src={`https://assets.rpglogs.com/img/warcraft/bosses/${encounterID}-icon.jpg`} alt="" className="rounded flex-shrink-0"
    style={{ width: size, height: size }} onError={e => { e.currentTarget.style.display = "none"; }} />;
}

function PctCell({ value }: { value: number }) {
  if (value <= 0) return <span className="text-xs text-gray-700">-</span>;
  return <span className="text-xs font-bold" style={{ color: getPercentileColor(Math.round(value)) }}>{Math.round(value)}</span>;
}

function fmtDPS(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default App;
