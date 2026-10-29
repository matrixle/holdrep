# Hold Rep 图标：深色底 + 橙色「下巴过杠」—— 一根单杠，杠上是头，杠下是弯曲的双臂（引体到顶的瞬间）
# 与 App 界面同一套配色：深色背景 + 主橙 #ff5e1a。用法：python3 tools/icons.py icons   （需要 Pillow）
from PIL import Image, ImageDraw, ImageChops
import sys
out = sys.argv[1]
TOP, BOTTOM, ACC = (32, 38, 49), (10, 12, 16), (255, 94, 26)

def make(size, pad=0.0, s=1.15):
    N = size * 4
    v = Image.linear_gradient("L").resize((N, N)); g = ImageChops.add(v, v.rotate(90), scale=2)
    im = Image.composite(Image.new("RGB", (N, N), BOTTOM), Image.new("RGB", (N, N), TOP), g)  # 左上 → 右下
    m = Image.new("L", (N, N), 0); d = ImageDraw.Draw(m)
    u, o = N * (1 - 2 * pad), N * pad
    P = lambda x, y: (o + u * x, o + u * y)
    def dot(x, y, r): cx, cy = P(x, y); d.ellipse([cx - u*r, cy - u*r, cx + u*r, cy + u*r], fill=255)
    w = .07 * s; top = .255 * s; bot = .20 * s + w / 2
    cy = .5 + (top - bot) / 2                                           # 图案上下居中
    d.line([P(.5 - .34 * s, cy), P(.5 + .34 * s, cy)], fill=255, width=int(u * w))
    dot(.5 - .34 * s, cy, w / 2); dot(.5 + .34 * s, cy, w / 2)           # 单杠
    dot(.5, cy - .16 * s, .095 * s)                                     # 头
    r = .20 * s; d.arc([*P(.5 - r, cy - r), *P(.5 + r, cy + r)], 0, 180, fill=255, width=int(u * w))  # 双臂
    dot(.5 - r + w / 2, cy, w / 2); dot(.5 + r - w / 2, cy, w / 2)
    im.paste(ACC, mask=m)
    return im.resize((size, size), Image.LANCZOS)

make(192).save(f"{out}/icon-192.png")
make(512).save(f"{out}/icon-512.png")
make(512, 0.1).save(f"{out}/icon-maskable-512.png")
make(180).save(f"{out}/apple-touch-icon.png")
