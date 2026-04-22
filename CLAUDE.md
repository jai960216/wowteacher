# wowteacher

WarcraftLogs v2 GraphQL API를 활용해 WoW 플레이어의 전투 로그를 같은 직업·특성 상위 플레이어와 비교·분석하는 웹 앱.

## 스택
- Vite 8 + React 19 + TypeScript 5.9
- TailwindCSS 4
- Vitest 4 (단위 테스트)
- ESLint 9 + typescript-eslint
- WarcraftLogs v2 GraphQL API (OAuth — public client + user client)

## 명령
- DEV: `npm run dev` (Vite dev server, http://localhost:5173)
- BUILD: `npm run build` (`tsc -b && vite build`)
- TEST_CMD: `npx vitest run`
- LINT_CMD: `npm run lint`

## 디렉토리
- `src/engine/wcl/` — WarcraftLogs API 클라이언트. `api.ts`(GraphQL 쿼리·타입), `auth.ts`(OAuth 토큰)
- `src/engine/analysis/` — 전투 분석 엔진. damage, cooldowns, rotation, patterns, uptime, resources, statScan 등
- `src/engine/specs/` — 직업·특성 정의 (`allSpecs.ts`: 직업→기본특성 리스트, `specNames.ts`, `heroTalents.ts`)
- `src/engine/spell/` — 스펠 메타·아이콘 해석기 (`resolver.ts`, `registry.ts`)
- `src/App.tsx` — 메인 UI. `step` 기반 플로우(login → characters → overview → fights → myKills → rankings → result)

## 관례
- UI는 WCL 스타일 다크 테마. 공용 클래스 `wcl-table`, `wcl-card`, `wcl-table-row` 사용
- 직업 식별은 Blizzard classID(1~13) 기반. 표시용 이름은 `CLASSID_TO_APINAME`("Death Knight" 등 공백 포함), 아이콘 slug는 `CLASSID_TO_ICONSLUG`
- WCL `characterRankings` 쿼리는 다음 규약:
  - `partition` 인자는 현재 시즌 값으로 명시 (현재 `1`로 하드코딩, `src/engine/wcl/api.ts`의 `getEncounterRankings`). 시즌 전환 시 업데이트 필요. 값이 맞지 않으면 빈 결과가 관찰됨
  - `className`/`specName`은 공백 없는 CamelCase("DeathKnight", "BeastMastery")로 전달 — 공백 포함("Death Knight")은 서버 매칭 실패
  - 응답 class 필드도 공백 없는 CamelCase → 클라이언트 필터는 `normalize()`(공백·하이픈·언더스코어 제거 + 소문자) 비교
- `characterRankings` 응답의 `spec` 필드는 기본 특성(Havoc, Frost, **Devourer** 등). zoneRankings/encounterRankings 응답은 영웅특성(Annihilator, Deathbringer 등)을 담을 수 있으므로 용도 구분 필수
- 스탯 비교 스캔(`scanTopStats`)은 선택한 비교 대상과 **같은 기본 특성만** 사용. 2차 스탯(치/가/특/유) 가중치가 스펙마다 달라서 혼합 비교는 무의미
- **Midnight(12.0, 2026.02 출시) 기준 변경사항**: DH에 3번째 기본 스펙 `Devourer`(공허 기반, 한글 "포식") 추가 — `allSpecs.ts` DH 엔트리는 `[Havoc, Vengeance, Devourer]`. DH 영웅특성도 재편: Aldrachi Reaver는 Havoc 전용, Fel-Scarred는 Havoc 전용으로 잔존, Void-Scarred는 Devourer 전용 신규, Annihilator는 Devourer와 Vengeance 양쪽에서 사용 (`heroTalents.ts`에서 (tree, spec) 조합마다 별도 엔트리). 확장 전환 시 `classifySpec()` 분류가 바뀌므로 `BASE_SPEC_NAMES`에 신규 기본 스펙 반드시 반영
