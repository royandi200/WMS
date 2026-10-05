"""Genera los íconos del navegador (favicon) del WMS.

Uso: python scripts/make-favicons.py
Escribe en frontend/public: favicon.svg, favicon.ico, apple-touch-icon.png,
icon-192.png e icon-512.png. El SVG es la fuente; los PNG se dibujan con la
misma geometría. Diseño: paquete isométrico blanco sobre degradado naranja.
"""
from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parents[1] / "frontend" / "public"
TOP_LEFT = (255, 168, 82)       # #ffa852
BOTTOM_RIGHT = (234, 88, 36)    # #ea5824
EDGE = (226, 96, 40)            # separación entre caras
FACES = {                       # color de cada cara del cubo
    "top": (255, 255, 255),
    "left": (255, 222, 196),
    "right": (255, 190, 148),
}
SUPER = 4  # supermuestreo para bordes suaves

# Geometría en un lienzo de 64x64.
CENTER = (32.0, 32.5)
RADIUS = 21.0
CUBE = {
    "top": (32, 11.5), "upper_right": (50.2, 22), "lower_right": (50.2, 43),
    "bottom": (32, 53.5), "lower_left": (13.8, 43), "upper_left": (13.8, 22),
    "center": (32, 32.5),
}


def faces():
    c = CUBE
    return {
        "top": [c["top"], c["upper_right"], c["center"], c["upper_left"]],
        "left": [c["upper_left"], c["center"], c["bottom"], c["lower_left"]],
        "right": [c["upper_right"], c["lower_right"], c["bottom"], c["center"]],
    }


def hex_color(rgb):
    return "#%02x%02x%02x" % rgb


def build_svg():
    polygons = "\n".join(
        '    <polygon points="%s" fill="%s"/>' % (
            " ".join("%g,%g" % point for point in points), hex_color(FACES[name]))
        for name, points in faces().items()
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{hex_color(TOP_LEFT)}"/>
      <stop offset="1" stop-color="{hex_color(BOTTOM_RIGHT)}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#bg)"/>
  <g stroke="{hex_color(EDGE)}" stroke-width="1.4" stroke-linejoin="round">
{polygons}
  </g>
</svg>
"""


def gradient(size):
    steps = 128
    small = Image.new("RGB", (steps, steps))
    pixels = small.load()
    for y in range(steps):
        for x in range(steps):
            t = (x + y) / (2 * (steps - 1))
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT))
    return small.resize((size, size), Image.BILINEAR).convert("RGBA")


def draw(size, rounded=True):
    big = size * SUPER
    image = gradient(big)
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 15 / 64), fill=255)
        image.putalpha(mask)
    canvas = ImageDraw.Draw(image)
    scale = big / 64.0
    stroke = max(1, round(1.4 * scale))
    for name, points in faces().items():
        scaled = [(x * scale, y * scale) for x, y in points]
        canvas.polygon(scaled, fill=FACES[name] + (255,))
        canvas.line(scaled + [scaled[0]], fill=EDGE + (255,), width=stroke, joint="curve")
    return image.resize((size, size), Image.LANCZOS)


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "favicon.svg").write_text(build_svg(), encoding="utf-8")
    draw(180, rounded=False).save(PUBLIC / "apple-touch-icon.png")  # iOS aplica su propia máscara
    draw(192).save(PUBLIC / "icon-192.png")
    draw(512).save(PUBLIC / "icon-512.png")
    draw(256).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for path in sorted(PUBLIC.glob("*")):
        if path.name != "warehouse-bg.jpg":
            print(path.name, path.stat().st_size)


if __name__ == "__main__":
    main()
