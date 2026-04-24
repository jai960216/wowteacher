# WoWTeacher (와선생)

WarcraftLogs v2 GraphQL API를 활용해 WoW 플레이어의 전투 로그를 같은 직업·특성의 상위 플레이어와 비교·분석하는 웹 앱. 한국어 UI.

**배포**: https://wowteacher.co.kr

> ⚠️ 본 프로젝트는 Warcraft Logs의 공식 파트너가 아닙니다. 개인이 운영하는 **비영리 커뮤니티 도구**이며 WCL Inc.의 승인이나 후원을 받지 않았습니다.
>
> This is an unofficial community tool. Not affiliated with or endorsed by Warcraft Logs.

## 주요 기능
- WarcraftLogs OAuth 로그인 (PKCE public client)
- 레이드·보스별 상위권 랭킹 조회 (DPS/HPS 토글)
- 선택한 상대와 본인 로그 1:1 비교 분석:
  - 장비·스탯 비교, 아이템 레벨 평균
  - 같은 특성 Top 10 스탯 분포 스캔
  - 딜/힐 흐름, 쿨다운 타이밍, 습관 패턴, 자원 낭비율
  - 캐스트 타임라인 + 버프/디버프 오라
- 한글 매핑: 기본 스펙·영웅 특성·레이드 보스

## 스택
- Vite 8 + React 19 + TypeScript 5.9
- TailwindCSS 4
- Vitest 4
- WarcraftLogs v2 GraphQL API

## 로컬 실행
```bash
npm install
cp .env.example .env   # VITE_WARCRAFTLOGS_CLIENT_ID 값 채우기
npm run dev            # http://localhost:5173
```

## 빌드 / 린트
```bash
npm run build   # tsc -b && vite build
npm run lint    # eslint .
npx vitest run  # 단위 테스트
```

## 환경변수
- `VITE_WARCRAFTLOGS_CLIENT_ID`: [WarcraftLogs 개발자 포털](https://www.warcraftlogs.com/api/clients)에서 앱 등록 후 발급. redirect_uri는 배포 도메인과 로컬(http://localhost:5173/)을 등록.

## 데이터 취급
- 서버·데이터베이스 **없음**. 모든 분석은 브라우저에서 처리됩니다.
- WCL OAuth 토큰은 **브라우저 localStorage에만** 저장, 서버 전송 없음.
- Google Analytics·Sentry 등 트래킹 도구 **사용 안 함**.

## 라이선스·성격
- **비영리 커뮤니티 도구** (non-commercial). 개인 플레이어가 운영.
- Warcraft Logs의 공식 프로젝트가 **아닙니다**. 데이터 출처는 WarcraftLogs v2 API이며 사용자는 본인의 [WCL 계정 약관](https://www.warcraftlogs.com/help/tos)을 준수해야 합니다.
- 기능 피드백·버그 제보: ducklogtest@gmail.com
