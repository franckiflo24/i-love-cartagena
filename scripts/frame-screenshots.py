#!/usr/bin/env python3
"""Frame raw iPhone 6.9" simulator screenshots into App Store marketing shots (AMO Life brand).

  python3 scripts/frame-screenshots.py            # store-assets/raw-screenshots/v1.1/*.png
  -> store-assets/app-store/v1.1/{en-US,es-MX}/NN_<slug>.png   (1290x2796, one per caption)

Raw files are named NN_<slug>.png; captions are keyed by <slug> below. Output size is
exactly the raw size (Apple accepts 1290x2796 for the 6.9"/6.7" set).
"""
import glob, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = os.path.join(ROOT, "store-assets/raw-screenshots/v1.1")
OUT = os.path.join(ROOT, "store-assets/app-store/v1.1")
LOGO = os.path.join(ROOT, "frontend/assets/images/amo-life-logo.png")

CAPTIONS = {
    "home":      {"es-MX": ("Cartagena,\ncomo un local", "Tu guía de viaje con concierge de IA"),
                  "en-US": ("Cartagena,\nlike a local", "Your travel guide with an AI concierge")},
    "agenda":    {"es-MX": ("Qué está pasando hoy", "Conciertos, rumba y atardeceres"),
                  "en-US": ("What's on today", "Concerts, nightlife and sunsets")},
    "partners":  {"es-MX": ("850+ lugares\nverificados", "Restaurantes, hoteles, playas y spas"),
                  "en-US": ("850+ verified\nplaces", "Restaurants, hotels, beaches and spas")},
    "mapa":      {"es-MX": ("Mapa y rutas a pie", "Apple Maps o Google Maps, tú eliges"),
                  "en-US": ("Map and walking routes", "Apple Maps or Google Maps, your call")},
    "luna":      {"es-MX": ("Luna, tu concierge\ncon IA", "Pregunta y responde con lugares reales"),
                  "en-US": ("Luna, your\nAI concierge", "Ask anything, get real places back")},
    "partner":   {"es-MX": ("Reserva por WhatsApp", "Fecha, hora y personas ya escritos"),
                  "en-US": ("Book over WhatsApp", "Date, time and party size pre-filled")},
    "pasaporte": {"es-MX": ("Tu pasaporte\nde Cartagena", "Sellos que ganas caminando la ciudad"),
                  "en-US": ("Your Cartagena\npassport", "Stamps you earn by walking the city")},
}
W, H = 1290, 2796
RED = (245, 11, 27)


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    cands = glob.glob(os.path.expanduser(f"~/Library/Fonts/SF-Pro-Display-{weight}.otf")) + \
            ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/HelveticaNeue.ttc"]
    for c in cands:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def background() -> Image.Image:
    bg = Image.new("RGB", (W, H), (0, 0, 0))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([W * 0.15, -H * 0.05, W * 0.85, H * 0.28], fill=(70, 4, 10))
    g.ellipse([-W * 0.2, H * 0.72, W * 0.5, H * 1.1], fill=(28, 2, 6))
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    return Image.blend(bg, glow, 1.0)


def device(shot: Image.Image, width: int) -> Image.Image:
    """Rounded screenshot with a hairline bezel + soft shadow, sized to `width`."""
    shot = shot.convert("RGB").resize((width, round(width * H / W)), Image.LANCZOS)
    r = round(width * 0.11)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1], radius=r, fill=255)
    pad = 60
    card = Image.new("RGBA", (shot.width + pad * 2, shot.height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + 18, pad + shot.width, pad + shot.height + 18], radius=r, fill=(0, 0, 0, 200))
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    card.alpha_composite(shadow)
    bezel = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(bezel).rounded_rectangle([pad - 4, pad - 4, pad + shot.width + 3, pad + shot.height + 3], radius=r + 4, fill=(22, 22, 26, 255), outline=(255, 255, 255, 40), width=2)
    card.alpha_composite(bezel)
    card.paste(shot, (pad, pad), mask)
    return card


def frame(raw_path: str, locale: str, out_path: str) -> None:
    slug = os.path.basename(raw_path).split("_", 1)[1].rsplit(".", 1)[0]
    title, sub = CAPTIONS[slug][locale]
    im = background()
    d = ImageDraw.Draw(im)
    # brand lockup, small, top-centre
    logo = Image.open(LOGO).convert("RGBA")
    lw = 300
    logo = logo.resize((lw, round(lw * logo.height / logo.width)), Image.LANCZOS)
    im.paste(logo, ((W - lw) // 2, 120), logo)
    y = 120 + logo.height + 70
    tf = font("Bold", 118)
    for line in title.split("\n"):
        tw = d.textlength(line, font=tf)
        d.text(((W - tw) / 2, y), line, font=tf, fill=(255, 255, 255))
        y += 130
    sf = font("Medium", 52)
    sw = d.textlength(sub, font=sf)
    d.text(((W - sw) / 2, y + 18), sub, font=sf, fill=(255, 255, 255, 170))
    y += 18 + 52 + 90
    dev = device(Image.open(raw_path), 1010)
    # anchor the device so it bleeds off the bottom edge (Apple-style)
    im.paste(dev, ((W - dev.width) // 2, y - 60), dev)
    im = im.crop((0, 0, W, H))
    im.save(out_path, optimize=True)


def main() -> int:
    for locale in ("en-US", "es-MX"):
        # raws are captured per locale (app UI in that language): raw-screenshots/v1.1/<locale>/
        raws = sorted(glob.glob(os.path.join(RAW, locale, "*.png")))
        if not raws:
            print(f"no raw screenshots in {os.path.join(RAW, locale)}", file=sys.stderr)
            return 1
        os.makedirs(os.path.join(OUT, locale), exist_ok=True)
        for r in raws:
            with Image.open(r) as chk:
                if chk.size != (W, H):
                    print(f"skip {r}: {chk.size} != {(W, H)}", file=sys.stderr)
                    continue
            out = os.path.join(OUT, locale, os.path.basename(r))
            frame(r, locale, out)
            print("wrote", os.path.relpath(out, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
