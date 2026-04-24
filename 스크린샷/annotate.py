# -*- coding: utf-8 -*-
"""스크린샷에 주석(박스, 화살표, 텍스트) 추가해서 기능 설명 이미지 생성."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

SRC = Path(__file__).parent
OUT = SRC / "annotated"
OUT.mkdir(exist_ok=True)

FONT_REG = "C:/Windows/Fonts/malgun.ttf"
FONT_BOLD = "C:/Windows/Fonts/malgunbd.ttf"


def load_font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def draw_box(draw, xy, color="#fbbf24", width=3):
    """둥근 박스."""
    draw.rounded_rectangle(xy, radius=6, outline=color, width=width)


def draw_label(draw, xy, text, color="#fbbf24", font_size=16, bold=True, pad=8):
    """텍스트 라벨 (둥근 배경 + 보더)."""
    font = load_font(font_size, bold=bold)
    lines = text.split("\n")
    line_h = font_size + 4
    text_w = max(draw.textlength(l, font=font) for l in lines)
    x, y = xy
    w = int(text_w + pad * 2)
    h = int(line_h * len(lines) + pad)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill="#0d0d15", outline=color, width=2)
    for i, line in enumerate(lines):
        draw.text((x + pad, y + pad // 2 + i * line_h), line, fill="#ffffff", font=font)
    return (x, y, x + w, y + h)


def draw_arrow(draw, start, end, color="#fbbf24", width=3):
    """선 + 화살촉."""
    draw.line([start, end], fill=color, width=width)
    # 화살촉
    ang = math.atan2(end[1] - start[1], end[0] - start[0])
    size = 12
    p1 = (end[0] - size * math.cos(ang - math.pi / 6), end[1] - size * math.sin(ang - math.pi / 6))
    p2 = (end[0] - size * math.cos(ang + math.pi / 6), end[1] - size * math.sin(ang + math.pi / 6))
    draw.polygon([end, p1, p2], fill=color)


def open_img(name):
    return Image.open(SRC / name).convert("RGB")


def save(img, name):
    img.save(OUT / name, quality=92)
    print(f"  saved: {name}")


COLOR_Y = "#fbbf24"  # 노랑 — 주요 기능
COLOR_P = "#a855f7"  # 보라 — 보조 설명
COLOR_R = "#ef4444"  # 빨강 — 경고/핵심
COLOR_G = "#22c55e"  # 초록 — 긍정


# ============================================
# 1. 캐릭터 목록 (113818)
# ============================================
def annotate_characters():
    img = open_img("스크린샷 2026-04-24 113818.png")
    d = ImageDraw.Draw(img)
    # 제목
    draw_label(d, (220, 40), "① 캐릭터 선택\n배넷 계정에 연결된 캐릭터가 자동으로 노출됨", COLOR_Y, 18)
    # 캐릭터 카드 박스
    draw_box(d, (16, 90, 400, 150), COLOR_Y, 3)
    draw_arrow(d, (410, 120), (520, 70), COLOR_Y)
    save(img, "01_character_list.png")


# ============================================
# 2. 보스별 킬 기록 (113828)
# ============================================
def annotate_boss_list():
    img = open_img("스크린샷 2026-04-24 113828.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (16, 24), "② 난이도·보스별 내 기록\nBest% / DPS / 킬타임이 한눈에", COLOR_Y, 18)
    draw_box(d, (12, 140, 1210, 240), COLOR_Y, 3)
    draw_label(d, (1050, 80), "난이도별\nBest Perf. Avg", COLOR_P, 16)
    draw_arrow(d, (1085, 150), (1150, 170), COLOR_P)
    save(img, "02_boss_records.png")


# ============================================
# 3. 킬 선택 (113842)
# ============================================
def annotate_kill_select():
    img = open_img("스크린샷 2026-04-24 113842.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (400, 60), "③ 보스의 내 킬 중 비교에 사용할 로그 선택", COLOR_Y, 18)
    draw_box(d, (10, 155, 1210, 230), COLOR_Y, 3)
    draw_arrow(d, (800, 170), (740, 90), COLOR_Y)
    save(img, "03_kill_select.png")


# ============================================
# 4. 상위 랭킹 (113851)
# ============================================
def annotate_rankings():
    img = open_img("스크린샷 2026-04-24 113851.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (460, 55), "④ 같은 직업·특성 상위 플레이어 랭킹\n비교 대상을 선택하면 분석 시작", COLOR_Y, 18)
    # 특성 필터 박스
    draw_box(d, (24, 160, 400, 205), COLOR_P, 3)
    draw_label(d, (430, 155), "기본 특성 필터\n(내 특성과 같은 풀만)", COLOR_P, 14)
    draw_arrow(d, (445, 180), (405, 182), COLOR_P)
    # 상위 1위 박스
    draw_box(d, (10, 260, 1200, 290), COLOR_Y, 3)
    draw_arrow(d, (1100, 275), (900, 95), COLOR_Y)
    save(img, "04_rankings.png")


# ============================================
# 5. 종합 탭 (113903)
# ============================================
def annotate_summary():
    img = open_img("스크린샷 2026-04-24 113903.png")
    d = ImageDraw.Draw(img)
    # 헤더 DPS
    draw_box(d, (14, 130, 1200, 220), COLOR_Y, 3)
    draw_label(d, (14, 40), "⑤ 비교 대시보드\nDPS · 템렙 · 핵심 스탯 한 줄 요약", COLOR_Y, 18)
    # 탭 강조
    draw_box(d, (10, 255, 220, 295), COLOR_P, 3)
    draw_label(d, (230, 250), "6개 분석 탭\n(종합·장비·습관·타임라인·쿨다운·피해)", COLOR_P, 14)
    # 제안 리스트
    draw_box(d, (10, 310, 1200, 835), COLOR_R, 3)
    draw_label(d, (820, 310), "카테고리별 개선 포인트\n(DPS·가동률·탈태·장비·스탯)", COLOR_R, 14)
    draw_arrow(d, (900, 345), (860, 330), COLOR_R)
    save(img, "05_summary.png")


# ============================================
# 6. 장비 비교 (113917)
# ============================================
def annotate_gear():
    img = open_img("스크린샷 2026-04-24 113917.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (14, 20), "⑥ 장비 비교 탭\n스탯·특성빌드·소모품까지 전부", COLOR_Y, 18)
    # 스캔 버튼
    draw_box(d, (16, 310, 1180, 420), COLOR_P, 3)
    draw_label(d, (820, 280), "상위 10명 스탯 평균과 비교 스캔", COLOR_P, 14)
    draw_arrow(d, (900, 315), (600, 395), COLOR_P)
    # 특성 빌드
    draw_box(d, (16, 465, 1180, 565), COLOR_Y, 3)
    draw_label(d, (600, 455), "WoW 공식 사이트로 바로 이동", COLOR_Y, 14)
    # 스탯 테이블
    draw_box(d, (16, 605, 1180, 975), COLOR_R, 3)
    draw_label(d, (820, 595), "초 단위 스탯 비교 (가속/특화/치명타/유연성)", COLOR_R, 14)
    # 소모품
    draw_box(d, (16, 1025, 1180, 1195), COLOR_G, 3)
    draw_label(d, (820, 1015), "음식·플라스크·증강·무기 강화 체크", COLOR_G, 14)
    save(img, "06_gear.png")


# ============================================
# 7. 스탯 스캔 결과 (113930)
# ============================================
def annotate_stat_scan():
    img = open_img("스크린샷 2026-04-24 113930.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (14, 270), "⑦ 상위 10명 스탯 범위 스캔\n각 스탯이 '부족/적정/과다'인지 즉시 판정", COLOR_Y, 18)
    draw_box(d, (30, 390, 1170, 620), COLOR_Y, 3)
    # 판정 컬럼
    draw_label(d, (1100, 410), "부족\n적정\n과다", COLOR_R, 14)
    draw_arrow(d, (1100, 470), (1130, 470), COLOR_R)
    # 요약 메시지
    draw_box(d, (30, 625, 400, 710), COLOR_P, 3)
    draw_label(d, (410, 640), "%로 환산한 진단 메시지", COLOR_P, 14)
    draw_arrow(d, (420, 665), (380, 655), COLOR_P)
    save(img, "07_stat_scan.png")


# ============================================
# 8. 습관 분석 (113942)
# ============================================
def annotate_patterns():
    img = open_img("스크린샷 2026-04-24 113942.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (14, 20), "⑧ 습관 분석 탭 — 로테이션·오프너 차이 파악", COLOR_Y, 18)
    # 리플레이
    draw_box(d, (16, 310, 1200, 425), COLOR_P, 3)
    draw_label(d, (820, 295), "WCL 2D 리플레이로 위치·타이밍 재생", COLOR_P, 14)
    # 탈태 사용
    draw_box(d, (16, 450, 1200, 570), COLOR_Y, 3)
    draw_label(d, (820, 440), "탈태 횟수 vs 상대 + 탈태당 캐스트 수", COLOR_Y, 14)
    # 오프너
    draw_box(d, (16, 605, 1200, 740), COLOR_R, 3)
    draw_label(d, (820, 595), "첫 15 GCD의 스킬 순서 비교 (오프너)", COLOR_R, 14)
    # 스킬 비중
    draw_box(d, (16, 780, 1200, 955), COLOR_G, 3)
    draw_label(d, (820, 770), "탈태 ON/OFF 분리한 스킬 사용 비중", COLOR_G, 14)
    save(img, "08_patterns.png")


# ============================================
# 9. 캐스트 타임라인 (115103)
# ============================================
def annotate_timeline():
    img = open_img("스크린샷 2026-04-24 115103.png")
    d = ImageDraw.Draw(img)
    # 타이틀만 하나
    draw_label(d, (14, 215), "⑨ 캐스트 타임라인", COLOR_Y, 20)
    # 오라 바 — 화살표로 가리키기만
    draw_arrow(d, (860, 235), (860, 365), COLOR_R)
    draw_label(d, (720, 200), "버프 가동 구간 (바)", COLOR_R, 14)
    # 시전 아이콘
    draw_arrow(d, (220, 560), (220, 440), COLOR_P)
    draw_label(d, (130, 568), "시전 시점 (아이콘)", COLOR_P, 14)
    # 컨트롤 힌트 한 줄만
    draw_label(d, (310, 215), "드래그·휠로 시간 이동", COLOR_G, 14)
    save(img, "09_timeline.png")


# ============================================
# 10. 쿨다운 (115323)
# ============================================
def annotate_cooldowns():
    img = open_img("스크린샷 2026-04-24 115323.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (14, 80), "⑩ 쿨다운 탭 — 스킬 하나를 깊게 분석", COLOR_Y, 18)
    # 왼쪽 리스트
    draw_box(d, (70, 300, 280, 900), COLOR_P, 3)
    draw_label(d, (290, 300), "액티브 스킬(시전 횟수) +\n버프/오라(가동 시간)", COLOR_P, 14)
    # 사용 타이밍 바
    draw_box(d, (305, 395, 1230, 500), COLOR_Y, 3)
    draw_label(d, (820, 395), "전투 시간축에 찍힌 사용 시점 비교", COLOR_Y, 14)
    # 가동률
    draw_box(d, (305, 525, 1230, 600), COLOR_R, 3)
    draw_label(d, (820, 525), "버프라면 내/상대 가동률 바로 표시", COLOR_R, 14)
    save(img, "10_cooldowns.png")


# ============================================
# 11. 피해 분석 (115332)
# ============================================
def annotate_damage():
    img = open_img("스크린샷 2026-04-24 115332.png")
    d = ImageDraw.Draw(img)
    draw_label(d, (14, 20), "⑪ 피해 분석 탭 — 누구에게 얼마나 넣었나", COLOR_Y, 18)
    # 보스 vs 쫄
    draw_box(d, (0, 80, 1160, 160), COLOR_Y, 3)
    draw_label(d, (820, 60), "보스 / 쫄 분배 비율", COLOR_Y, 14)
    # 대상별 테이블
    draw_box(d, (0, 180, 1160, 420), COLOR_P, 3)
    draw_label(d, (820, 180), "NPC 이름 기반 대상별 피해", COLOR_P, 14)
    # 스킬별 테이블
    draw_box(d, (0, 440, 1160, 780), COLOR_R, 3)
    draw_label(d, (820, 440), "스킬별 피해량·비중 비교", COLOR_R, 14)
    # DPS 추이
    draw_box(d, (0, 800, 1160, 1075), COLOR_G, 3)
    draw_label(d, (820, 790), "초 단위 DPS 그래프 (나 vs 상대 동시)", COLOR_G, 14)
    save(img, "11_damage.png")


if __name__ == "__main__":
    print("주석 이미지 생성 시작...")
    annotate_characters()
    annotate_boss_list()
    annotate_kill_select()
    annotate_rankings()
    annotate_summary()
    annotate_gear()
    annotate_stat_scan()
    annotate_patterns()
    annotate_timeline()
    annotate_cooldowns()
    annotate_damage()
    print(f"\n완료 — {OUT}")
