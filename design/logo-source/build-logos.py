"""main_logo_tra.png 원본 하나에서 앱이 쓰는 로고 에셋을 전부 생성한다.

원본은 1536x1024 캔버스에 실제 그림이 839x415밖에 없고(70%가 빈 여백),
워드마크 'Inter'가 #04163B 짙은 남색이라 어두운 배경에서 통째로 사라진다.
이 스크립트가 그 두 가지를 잡는다.

    python design/logo-source/build-logos.py
"""
from PIL import Image
import numpy as np
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")   # 윈도우 기본 cp949는 em dash를 못 찍는다

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "design", "logo-source", "main_logo_tra.png")
PUB = os.path.join(ROOT, "apps", "web", "public")
APP = os.path.join(ROOT, "apps", "web", "src", "app")

TEXT_ON_DARK = np.array([234, 236, 247], np.float32)   # --text (dark)  #EAECF7
BRAND_NAVY = (11, 14, 35, 255)                          # --caption-bg   #0B0E23


def tight(block):
    """투명 여백을 잘라낸다."""
    y, x = np.where(block[:, :, 3] > 8)
    return block[y.min():y.max() + 1, x.min():x.max() + 1]


def for_dark_bg(block):
    """남색 글자만 밝게 바꾼다. 아이콘의 파랑·보라(휘도 90+)는 건드리지 않는다.
    경계를 딱 자르면 글자 이음새에 얼룩이 생기므로 휘도 40~90 구간은 섞는다."""
    rgb = block[:, :, :3].astype(np.float32)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    t = np.clip((lum - 40.0) / 50.0, 0.0, 1.0)[:, :, None]
    out = block.copy()
    out[:, :, :3] = np.round(rgb * t + TEXT_ON_DARK * (1 - t)).astype(np.uint8)
    return out


def fit(arr, w=None, h=None):
    im = Image.fromarray(arr) if isinstance(arr, np.ndarray) else arr
    if w is None:
        w = round(im.width * h / im.height)
    if h is None:
        h = round(im.height * w / im.width)
    return im.resize((w, h), Image.LANCZOS)


def save(im, path):
    im.save(path, optimize=True)
    print(f"  {os.path.relpath(path, ROOT):<52} {im.size[0]}x{im.size[1]}  {os.path.getsize(path)/1024:>5.0f} KB")


# ── 원본에서 아이콘(말풍선+파형)과 워드마크(InterLive)를 분리 ──
full = tight(np.array(Image.open(SRC).convert("RGBA")))
rows = (full[:, :, 3] > 8).any(axis=1)
runs, start = [], None
for i, filled in enumerate(rows):
    if not filled and start is None:
        start = i
    elif filled and start is not None:
        runs.append((start, i)); start = None
gap = max(runs, key=lambda r: r[1] - r[0])          # 아이콘과 글자 사이 최대 공백
icon, word = tight(full[:gap[0]]), tight(full[gap[1]:])
print(f"원본 {Image.open(SRC).size} -> 아이콘 {icon.shape[1]}x{icon.shape[0]}, 워드마크 {word.shape[1]}x{word.shape[0]}\n")

# 아이콘 안에서 말풍선만(파형 막대 제외) — 파비콘용. 가로로 긴 아이콘 전체는 16px에서 뭉갠다
cols = (icon[:, :, 3] > 8).any(axis=0)
groups, start = [], None
for i, filled in enumerate(cols):
    if filled and start is None:
        start = i
    elif not filled and start is not None:
        groups.append((start, i)); start = None
if start is not None:
    groups.append((start, len(cols)))
wide = sorted(sorted(groups, key=lambda g: g[1] - g[0])[-2:])   # 말풍선 2개가 제일 넓다
bubble = tight(icon[:, wide[0][0]:wide[0][1]])


def lockup(ic, wd, H=200):
    """가로 락업 — 아이콘 왼쪽, 워드마크 오른쪽. 헤더·히어로처럼 가로 여유가 있을 때."""
    iw, wh = round(ic.shape[1] * H / ic.shape[0]), round(H * 0.62)
    ww, g = round(wd.shape[1] * wh / wd.shape[0]), round(H * 0.16)
    cv = Image.new("RGBA", (iw + g + ww, H), (0, 0, 0, 0))
    cv.paste(fit(ic, h=H), (0, 0)); cv.paste(fit(wd, h=wh), (iw + g, (H - wh) // 2))
    return cv


print("가로 락업 (헤더·랜딩 히어로)")
save(lockup(icon, word), os.path.join(PUB, "logo-interlive-h-light.png"))
save(lockup(for_dark_bg(icon), for_dark_bg(word)), os.path.join(PUB, "logo-interlive-h-dark.png"))

# 사이드바(가용폭 200px)에서는 아이콘이 가로폭을 42% 먹어 글자가 19px까지 줄어든다.
# 워드마크만 쓰면 같은 폭에서 34px — 아이콘은 파비콘·OG가 담당한다.
print("\n워드마크 (사이드바 — 폭이 좁아 글자를 최대로)")
save(fit(word, w=560), os.path.join(PUB, "wordmark-interlive-light.png"))
save(fit(for_dark_bg(word), w=560), os.path.join(PUB, "wordmark-interlive-dark.png"))

print("\n파비콘 (말풍선 1개 — 16px에서도 읽힌다)")
fav = Image.new("RGBA", (512, 512), BRAND_NAVY)
b = fit(bubble, w=round(512 * 0.68))
fav.paste(b, ((512 - b.width) // 2, (512 - b.height) // 2), b)
save(fav, os.path.join(APP, "icon.png"))
save(fav.resize((180, 180), Image.LANCZOS), os.path.join(APP, "apple-icon.png"))

print("\nOG 이미지")
og = Image.new("RGB", (1200, 630), BRAND_NAVY[:3])
lock = fit(lockup(for_dark_bg(icon), for_dark_bg(word)), w=760)
og.paste(lock, ((1200 - lock.width) // 2, (630 - lock.height) // 2 - 20), lock)
save(og, os.path.join(PUB, "og-interlive.png"))
