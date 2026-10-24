"""Shared toolkit for the «Сторителлинг» style: easing, layer compositing, camera, plates, stickers,
word reveals, zoom blur, grade and grain. Extracted from projects/mona_lisa/render.py."""
import math, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
WORK = os.environ.get('MONTAGE_WORK', f'{ROOT}/work')
A, FD = f'{WORK}/assets', f'{WORK}/fonts'
W, H, FPS = 1080, 1920, 30

def font(name, size): return ImageFont.truetype(f'{FD}/{name}.ttf', size)

# ---------- easing ----------
def clamp(x, a=0., b=1.): return max(a, min(b, x))
def prog(t, t0, d): return clamp((t - t0) / d)
def out_cubic(x): return 1 - (1 - x) ** 3
def in_out_cubic(x): return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2
def out_expo(x): return 1. if x >= 1 else 1 - 2 ** (-10 * x)
def in_expo(x): return 0. if x <= 0 else 2 ** (10 * x - 10)
def out_back(x, s=2.2): x -= 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def out_quint(x): return 1 - (1 - x) ** 5

# ---------- layer helpers ----------
def rgba(pil): a = np.asarray(pil.convert('RGBA')).astype(np.float32) / 255.; return a

def mat(cx, cy, s=1., r=0., ax=0., ay=0.):
    c, sn = math.cos(math.radians(r)) * s, math.sin(math.radians(r)) * s
    return np.array([[c, -sn, cx - c * ax + sn * ay], [sn, c, cy - sn * ax - c * ay]], np.float32)

def cam(M, s, dx=0., dy=0., r=0.):
    """Apply a camera (scale/rotate about canvas centre, then shift) on top of layer matrix M."""
    C = np.vstack([mat(W / 2 + dx, H / 2 + dy, s, r, W / 2, H / 2), [0, 0, 1]])
    return (C @ np.vstack([M, [0, 0, 1]]))[:2]

def over(dst, layer, M, op=1.):
    if op <= 0.002: return
    w = cv2.warpAffine(layer, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    a = w[..., 3:4] * op
    dst[:] = dst * (1 - a) + w[..., :3] * a

def shadowed(pil, off=(10, 14), blur=14, alpha=.55, pad=40):
    w, h = pil.size
    out = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
    a = pil.split()[3].point(lambda v: int(v * alpha))
    sh.paste(Image.new('RGBA', pil.size, (0, 0, 0, 255)), (pad + off[0], pad + off[1]), a)
    out = Image.alpha_composite(out, sh.filter(ImageFilter.GaussianBlur(blur)))
    out.alpha_composite(pil, (pad, pad))
    return out

def text_img(s, f, fill=(255, 255, 255), tracking=0):
    bb = f.getbbox(s)
    w = bb[2] - bb[0] + max(0, tracking * (len(s) - 1)) + 20
    im = Image.new('RGBA', (w, bb[3] - bb[1] + 30), (0, 0, 0, 0))
    d = ImageDraw.Draw(im); x = 10 - bb[0]
    if tracking:
        for ch in s:
            d.text((x, 15 - bb[1]), ch, font=f, fill=fill); x += f.getlength(ch) + tracking
    else:
        d.text((x, 15 - bb[1]), s, font=f, fill=fill)
    return im

def torn_sticker(s, f, bg, fg, rot_seed=1, padx=34, pady=22):
    rng = np.random.default_rng(rot_seed)
    t = text_img(s, f, fg)
    w, h = t.width + padx * 2, t.height + pady * 2
    im = Image.new('RGBA', (w + 20, h + 20), (0, 0, 0, 0))
    pts = []
    for x in np.linspace(10, w + 10, 40): pts.append((x, 10 + rng.uniform(-6, 6)))
    for y in np.linspace(10, h + 10, 12): pts.append((w + 10 + rng.uniform(-6, 6), y))
    for x in np.linspace(w + 10, 10, 40): pts.append((x, h + 10 + rng.uniform(-6, 6)))
    for y in np.linspace(h + 10, 10, 12): pts.append((10 + rng.uniform(-6, 6), y))
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).polygon(pts, fill=255)
    paper = np.ones((im.height, im.width, 3), np.float32) * np.array(bg, np.float32)
    paper *= (1 + rng.normal(0, .035, (im.height, im.width, 1))).astype(np.float32)
    paper = Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8))
    im.paste(paper, (0, 0), m)
    im.alpha_composite(t, (10 + padx, 10 + pady))
    return shadowed(im, (6, 10), 10, .5, 30)

def plate(s, f, bg, fg, padx=26, pady=14):
    t = text_img(s, f, fg)
    im = Image.new('RGBA', (t.width + padx * 2, t.height + pady * 2), bg + (255,))
    im.alpha_composite(t, (padx, pady))
    return shadowed(im, (5, 8), 10, .45, 26)

def grain(img, rng, amt=.045):
    n = rng.normal(0, amt, (H // 2, W // 2, 1)).astype(np.float32)
    n = cv2.resize(n, (W, H), interpolation=cv2.INTER_LINEAR)[..., None]
    return img + n * (0.35 + img.mean(axis=2, keepdims=True))

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.55 * (((xx - W / 2) / (W * .75)) ** 2 + ((yy - H / 2) / (H * .7)) ** 2)).clip(0.25, 1)[..., None]

def grade(img, lift=(0, .01, .03), gain=(1.05, 1., .94), contrast=1.12):
    img = (img - .5) * contrast + .5
    img = img * np.array(gain, np.float32) + np.array(lift, np.float32) * (1 - img)
    return img * VIG

def blur_layer(lay, sigma):
    if sigma < .4: return lay
    pad = int(sigma * 3) + 2
    p = cv2.copyMakeBorder(lay, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0, 0))
    p = cv2.GaussianBlur(p, (0, 0), sigma)
    return p, pad

def place_word(dst, lay, cx, cy, t, t0, d=.45, rise=40, sc0=1.):
    p = out_cubic(prog(t, t0, d))
    if p <= 0: return
    b = blur_layer(lay, 14 * (1 - p))
    if isinstance(b, tuple): lay, pad = b
    else: pad = 0
    s = sc0 + (1 - sc0) * p
    over(dst, lay, cam(mat(cx, cy + rise * (1 - p), s, 0, lay.shape[1] / 2, lay.shape[0] / 2), *dst.camera), p)

class Canvas(np.ndarray):
    pass

def canvas(camera):
    c = np.zeros((H, W, 3), np.float32).view(Canvas); c.camera = camera; return c

def zoom_blur(img, amount, n=10):
    if amount < .004: return img
    acc = np.zeros_like(img)
    for i in range(n):
        s = 1 + amount * i / (n - 1)
        acc += cv2.warpAffine(img, mat(W / 2, H / 2, s, 0, W / 2, H / 2), (W, H), borderMode=cv2.BORDER_REFLECT)
    return acc / n

