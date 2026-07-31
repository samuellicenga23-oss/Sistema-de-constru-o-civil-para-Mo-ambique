"""Gera os ícones PNG do SIGO (fundo navy + marca S turquesa) com formas vectoriais simples,
sem depender de rasterização de SVG. Correr sempre que a marca mudar; ficheiros em
apps/web/public/.
"""
from PIL import Image, ImageDraw

NAVY = (14, 32, 51, 255)      # #0e2033
TEAL = (26, 173, 180, 255)    # #1aadb4

# Marca definida numa caixa lógica 0-100, ponto-simétrica em torno de (50,50).
TOP = [(30, 10), (90, 10), (50, 50), (10, 50), (10, 30)]
BOTTOM = [(70, 90), (10, 90), (50, 50), (90, 50), (90, 70)]

def draw_mark(draw: ImageDraw.ImageDraw, size: int, scale: float):
    mark_size = size * scale
    pad = (size - mark_size) / 2
    def t(pts):
        return [(pad + x / 100 * mark_size, pad + y / 100 * mark_size) for x, y in pts]
    draw.polygon(t(TOP), fill=TEAL)
    draw.polygon(t(BOTTOM), fill=TEAL)

def make_icon(size: int, path: str, maskable: bool = False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        draw.rectangle([0, 0, size - 1, size - 1], fill=NAVY)
        scale = 0.5
    else:
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=NAVY)
        scale = 0.62
    draw_mark(draw, size, scale)
    img.save(path)
    print("gerado", path)

if __name__ == "__main__":
    make_icon(512, "apps/web/public/icon-512.png")
    make_icon(192, "apps/web/public/icon-192.png")
    make_icon(512, "apps/web/public/icon-maskable-512.png", maskable=True)
