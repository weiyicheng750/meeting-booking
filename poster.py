# -*- coding: utf-8 -*-
"""A4 会议室预约海报（300dpi: 2480x3508）极简顶部 + 规则删除版"""
from PIL import Image, ImageDraw, ImageFilter

W, H = 2480, 3508

# ---------- 颜色 ----------
WHITE = (255, 255, 255, 255)
INK = (26, 26, 46, 255)
SUB = (110, 115, 140, 255)
C1 = (79, 108, 255, 255)
C2 = (150, 84, 255, 255)
GRAD_TOP = (66, 97, 247)
GRAD_BOT = (139, 92, 246)

# ---------- 字体 ----------
FT = "C:/Windows/Fonts/msyh.ttc"
FTB = "C:/Windows/Fonts/msyhbd.ttc"
def font(sz, bold=False):
    from PIL import ImageFont
    return ImageFont.truetype(FTB if bold else FT, sz)

img = Image.new("RGB", (W, H), (248, 249, 253))
d = ImageDraw.Draw(img)

def vgrad(x0, y0, x1, y1, top, bot):
    hh = max(1, y1 - y0)
    for i in range(hh):
        t = i / hh
        c = tuple(int(top[k] + (bot[k] - top[k]) * t) for k in range(3))
        d.rectangle([x0, y0 + i, x1, y0 + i + 1], fill=c)

# ---------- 背景装饰圆（极淡） ----------
for cx, cy, r, col in [(180, 3000, 280, (235, 240, 255)), (2320, 3100, 220, (243, 238, 255))]:
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)

# ---------- 顶部干净渐变区 ----------
HEAD_H = 820
vgrad(0, 0, W, HEAD_H, GRAD_TOP, GRAD_BOT)

# 顶部装饰圆环
d.ellipse([W - 360, -180, W + 80, 260], outline=(255, 255, 255, 80), width=8)
d.ellipse([-220, 400, 160, 780], outline=(255, 255, 255, 55), width=6)

# 主标题：超大 + 投影
d = ImageDraw.Draw(img)
f_title = font(300, True)
t = "会议室预约"
tw = d.textlength(t, font=f_title)
tx, ty = (W - tw) / 2, 220
# 投影
d.text((tx + 8, ty + 10), t, font=f_title, fill=(0, 0, 0))
d.text((tx, ty), t, font=f_title, fill=WHITE)

# 英文装饰：宽度对齐中文主标题「会议室预约」（视觉一致、约一半字号）
t_en = "Meeting Room Booking"
cn_w = d.textlength("会议室预约", font=f_title)
en_sz = 200
while en_sz > 20:
    fe = font(en_sz)
    if d.textlength(t_en, font=fe) <= cn_w:
        break
    en_sz -= 2
en_y = 560 + max(0, (300 - en_sz)) // 2
d.text(((W - d.textlength(t_en, font=fe)) / 2, en_y), t_en, font=fe, fill=(220, 230, 255))

# ---------- 中央白卡片 ----------
CARD_W, CARD_H = 1800, 2250
cx0, cy0 = (W - CARD_W) // 2, 920

# 阴影
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(sh)
sd.rounded_rectangle([cx0 + 14, cy0 + 22, cx0 + CARD_W + 14, cy0 + CARD_H + 22], radius=88, fill=(60, 70, 130, 70))
sh = sh.filter(ImageFilter.GaussianBlur(26))
img = Image.alpha_composite(img.convert("RGBA"), sh).convert("RGB")
d = ImageDraw.Draw(img)

# 卡片本体
card = Image.new("RGBA", (CARD_W * 4, CARD_H * 4), (0, 0, 0, 0))
cd = ImageDraw.Draw(card)
cd.rounded_rectangle([0, 0, CARD_W * 4, CARD_H * 4], radius=44 * 4, fill=WHITE)
card = card.resize((CARD_W, CARD_H), Image.LANCZOS)
img.paste(card, (cx0, cy0), card)
d = ImageDraw.Draw(img)
d.rounded_rectangle([cx0, cy0, cx0 + CARD_W, cy0 + CARD_H], radius=44, outline=(228, 231, 245), width=3)

# 卡片顶部渐变条
bar = Image.new("RGBA", (CARD_W, 18), (0, 0, 0, 0))
bd = ImageDraw.Draw(bar)
for i in range(CARD_W):
    tt = i / CARD_W
    bd.rectangle([i, 0, i + 1, 18], fill=tuple(int(GRAD_TOP[k] + (GRAD_BOT[k] - GRAD_TOP[k]) * tt) for k in range(3)))
mask = Image.new("L", (CARD_W, 44), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, CARD_W, 44], radius=44, fill=255)
img.paste(bar, (cx0, cy0), mask.crop((0, 0, CARD_W, 18)))

# ---------- 二维码 ----------
qr = Image.open("qr_hires.png").convert("RGB")
QR_S = 1240
qr = qr.resize((QR_S, QR_S), Image.LANCZOS)
qx, qy = cx0 + (CARD_W - QR_S) // 2, cy0 + 130
img.paste(qr, (qx, qy))
d = ImageDraw.Draw(img)
d.rounded_rectangle([qx - 10, qy - 10, qx + QR_S + 10, qy + QR_S + 10], radius=28, outline=(232, 235, 248), width=5)

# ---------- 卡片内文案 ----------
y1 = qy + QR_S + 90  # 约 2360
f_tip = font(108, True)
t1 = "微信扫一扫 · 立即预约"
tw1 = d.textlength(t1, font=f_tip)
d.text(((W - tw1) / 2, y1), t1, font=f_tip, fill=INK)

f_subtitle = font(74, True)
t2 = "中关村生命科学园 · 创新大厦"
tw2 = d.textlength(t2, font=f_subtitle)
d.text(((W - tw2) / 2, y1 + 155), t2, font=f_subtitle, fill=(90, 96, 125))

# 高亮提示：请拍照留存（放大 + 删除上一行后上移居中）
f_keep = font(86, True)
t_keep = "请拍照留存 · 方便后续预约"
tw_keep = d.textlength(t_keep, font=f_keep)
d.text(((W - tw_keep) / 2, y1 + 300), t_keep, font=f_keep, fill=C1)

# ---------- 底部 ----------
f_ft = font(50, True)
t4 = "创新大厦 · 智慧园区服务"
tw4 = d.textlength(t4, font=f_ft)
d.line([(W - tw4) / 2 - 60, H - 205, (W + tw4) / 2 + 60, H - 205], fill=(180, 185, 205), width=3)
d.text(((W - tw4) / 2, H - 170), t4, font=f_ft, fill=(110, 115, 140))

img.save("会议室预约码-A4海报.png", "PNG", dpi=(300, 300))
print("OK", img.size)
