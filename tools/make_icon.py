# Draws the Ko-Labz app icon (the favicon's star system: a gold sun, a cyan minor ring and a
# violet major ring, each with a planet, on deep space) and writes an .iconset for iconutil.
# Run: python3 -E tools/make_icon.py OUT_DIR.iconset   then   iconutil -c icns OUT_DIR.iconset
import sys, os, math
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
S = 1024; C = S // 2
im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle([40, 40, S - 40, S - 40], radius=220, fill=(2, 6, 12, 255))
# A few fixed stars (no randomness, so the icon is the same every build).
for i in range(70):
    x = 90 + (i * 389) % 844; y = 90 + (i * 571) % 844; r = 2 + (i % 3)
    if abs(x - C) < 150 and abs(y - C) < 150: continue
    d.ellipse([x - r, y - r, x + r, y + r], fill=(234, 246, 255, 90 + (i * 37) % 120))
def glow(box, color, blur):
    g = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse(box, fill=color)
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(blur)))
def ring(r, color, width):
    g = Image.new('RGBA', (S, S), (0, 0, 0, 0)); gd = ImageDraw.Draw(g)
    gd.ellipse([C - r, C - r, C + r, C + r], outline=color, width=width)
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(10)))
    ImageDraw.Draw(im).ellipse([C - r, C - r, C + r, C + r], outline=color, width=width)
glow([C - 230, C - 230, C + 230, C + 230], (255, 181, 46, 90), 70)
ring(270, (0, 212, 255, 255), 22)
ring(410, (176, 107, 255, 210), 22)
glow([C - 130, C - 130, C + 130, C + 130], (255, 211, 107, 200), 30)
d = ImageDraw.Draw(im)
d.ellipse([C - 115, C - 115, C + 115, C + 115], fill=(255, 211, 107, 255))
def planet(r, deg, size, color):
    a = math.radians(deg); x = C + math.cos(a) * r; y = C + math.sin(a) * r
    glow([x - size * 1.8, y - size * 1.8, x + size * 1.8, y + size * 1.8], color[:3] + (150,), 18)
    ImageDraw.Draw(im).ellipse([x - size, y - size, x + size, y + size], fill=color)
planet(270, 0, 55, (0, 212, 255, 255))
planet(410, 215, 62, (176, 107, 255, 255))
for size in [16, 32, 64, 128, 256, 512]:
    im.resize((size, size), Image.LANCZOS).save(f'{out}/icon_{size}x{size}.png')
    im.resize((size * 2, size * 2), Image.LANCZOS).save(f'{out}/icon_{size}x{size}@2x.png')
