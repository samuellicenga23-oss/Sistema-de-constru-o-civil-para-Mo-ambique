from PIL import Image, ImageDraw, ImageFont

BRAND = (67, 56, 202)  # brand-700, mesma cor da marca no login
ACCENT = (165, 180, 252)  # brand-300, o "O" destacado

FONT_PATH = r"C:\Windows\Fonts\segoeuib.ttf"


def rounded_square(size, radius_ratio=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BRAND)
    return img, draw


def draw_mark(size, safe_ratio=1.0):
    img, draw = rounded_square(size)
    # "S" em branco, "O" em accent, tal como a marca "SIGO" no login (SIG + O destacado)
    font_size = int(size * 0.52 * safe_ratio)
    font = ImageFont.truetype(FONT_PATH, font_size)
    text = "S"
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))
    return img


# Ícones normais (any) — a marca preenche quase todo o espaço
for size in (192, 512):
    draw_mark(size).save(f"public/icon-{size}.png")

# Ícone maskable — precisa de "zona segura" (o SO pode recortar em forma de círculo/squircle),
# por isso a marca fica mais pequena e centrada, com mais respiro à volta.
draw_mark(512, safe_ratio=0.65).save("public/icon-maskable-512.png")

print("Ícones gerados em apps/web/public/")
