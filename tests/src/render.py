"""Test edit: Mona Lisa theft, styled after the reference (2.5D parallax, push-ins,
zoom-blur transitions, word-by-word serif text, stickers, plates)."""
import math, os, sys, subprocess
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool

SP = '/tmp/claude-0/-home-user--/187b4d09-cffe-5712-905c-ec1c06a7518e/scratchpad'
A, FD = f'{SP}/assets', f'{SP}/fonts'
W, H, FPS, DUR = 1080, 1920, 30, 9.0
NF = int(DUR * FPS)
SUB = 4                      # motion-blur subframes
T1, T2 = 3.4, 6.0            # scene cut points (centre of transitions)
TR = 0.22                    # half-length of zoom-blur transitions

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

# ---------- assets ----------
def load():
    L = {}
    # original painting as the back plate: the fg cut-out grows faster and always covers her ghost
    bg = cv2.cvtColor(cv2.imread(f'{A}/s9.jpg'), cv2.COLOR_BGR2RGB)
    bg = cv2.GaussianBlur(cv2.resize(bg, (W, H), interpolation=cv2.INTER_LANCZOS4), (0, 0), 3.5)
    L['mbg'] = np.dstack([bg.astype(np.float32) / 255., np.ones((H, W), np.float32)])
    fg = Image.open(f'{A}/mona_fg.png').resize((W, H), Image.LANCZOS)
    L['mfg'] = rgba(fg)
    # blue grid background
    g = np.zeros((H + 200, W + 200, 3), np.float32)
    gy = np.linspace(0, 1, H + 200)[:, None, None]
    g[:] = np.array([.03, .13, .32]) * (1 - gy) + np.array([.06, .22, .48]) * gy
    for x in range(0, W + 200, 46): g[:, x:x + 2] *= 1.18
    for y in range(0, H + 200, 46): g[y:y + 2] *= 1.18
    for x in range(23, W + 200, 230): g[:, x:x + 2] += np.array([.12, .02, .06])
    for y in range(23, H + 200, 230): g[y:y + 2] += np.array([.12, .02, .06])
    rng = np.random.default_rng(3)
    g *= 1 + cv2.GaussianBlur(rng.normal(0, .25, g.shape[:2]).astype(np.float32), (0, 0), 30)[..., None]
    L['grid'] = np.dstack([g.clip(0, 1), np.ones(g.shape[:2], np.float32)])
    # museum wall + empty frame
    wall = np.zeros((H + 300, W + 300, 3), np.float32)
    wy, wx = np.mgrid[0:H + 300, 0:W + 300].astype(np.float32)
    spot = np.exp(-(((wx - (W + 300) / 2) / 520) ** 2 + ((wy - 820) / 900) ** 2))
    wall[:] = np.array([.11, .085, .07])
    wall *= (0.35 + 1.25 * spot)[..., None]
    tex = cv2.GaussianBlur(rng.normal(0, 1, wall.shape[:2]).astype(np.float32), (0, 0), 2)
    wall *= (1 + .06 * tex)[..., None]
    L['wall'] = np.dstack([wall.clip(0, 1), np.ones(wall.shape[:2], np.float32)])
    fw, fh, b = 560, 800, 64
    fr = Image.new('RGBA', (fw + 2 * b, fh + 2 * b), (0, 0, 0, 0))
    d = ImageDraw.Draw(fr)
    for i in range(b):                    # bevelled gilt frame
        k = i / b; v = .55 + .45 * math.sin(k * math.pi)
        col = (int(205 * v), int(160 * v), int(75 * v), 255)
        d.rectangle([i, i, fw + 2 * b - i - 1, fh + 2 * b - i - 1], outline=col)
    d.rectangle([b, b, b + fw, b + fh], fill=(40, 32, 26, 255))
    d.rectangle([b + 40, b + 40, b + fw - 40, b + fh - 40], fill=(52, 43, 35, 255))   # dust mark
    for hx, hy in [(b + 60, b + 60), (b + fw - 60, b + 60), (b + 60, b + fh - 60), (b + fw - 60, b + fh - 60)]:
        d.ellipse([hx - 9, hy - 9, hx + 9, hy + 9], fill=(150, 140, 125, 255))
    L['frame'] = rgba(shadowed(fr, (0, 30), 40, .75, 80))
    # type
    L['plate1'] = rgba(plate('МОНА ЛИЗА', font('montserrat-900-normal', 64), (226, 34, 44), (255, 255, 255)))
    L['plate2'] = rgba(plate('Леонардо да Винчи · 1503', font('montserrat-600-normal', 36), (255, 255, 255), (20, 20, 20)))
    L['stk1'] = rgba(torn_sticker('БЕСЦЕННА', font('montserrat-900-normal', 70), (247, 214, 64), (15, 15, 15), 5))
    L['stk2'] = rgba(torn_sticker('УКРАДЕНА', font('montserrat-900-normal', 92), (226, 34, 44), (255, 255, 255), 9))
    sf = font('playfair-display-400-normal', 74)
    L['words'] = [rgba(text_img(w, sf)) for w in ['Но', 'дальше', '—', 'только']]
    L['big'] = rgba(text_img('БЕЗУМНЕЕ', font('playfair-display-900-normal', 150)))
    L['date'] = '21 АВГУСТА 1911'
    L['datef'] = font('montserrat-600-normal', 50)
    L['louvre'] = rgba(text_img('Лувр, Париж', font('playfair-display-400-italic', 64)))
    return L

L = None
def init():
    global L
    L = load()

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

# ---------- scenes ----------
def scene1(t):
    intro = out_expo(prog(t, 0, .7))
    e = in_out_cubic(prog(t, 0, T1 + TR))
    camera = (1.45 - .45 * intro + .05 * e, 0, -60 * (1 - intro), 0)
    c = canvas(camera)
    # both layers scale about the face, the cut-out faster -> parallax without exposing the back plate
    over(c, L['mbg'], cam(mat(W / 2, H * .3, 1.06 + .03 * e, 0, W / 2, H * .3), *camera))
    over(c, L['mfg'], cam(mat(W / 2, H * .3 + 12 * e, 1.07 + .13 * e, 0, W / 2, H * .3), *camera))
    c[:] = grade(c)
    # plates slide in from the left
    for lay, y, t0 in [(L['plate1'], 1330, .55), (L['plate2'], 1430, .72)]:
        p = out_quint(prog(t, t0, .55))
        if p > 0:
            b = blur_layer(lay, 10 * (1 - p)); lay2 = b[0] if isinstance(b, tuple) else lay
            over(c, lay2, mat(90 - 700 * (1 - p), y, 1, -2, 0, lay2.shape[0] / 2), min(1, p * 2))
    p = prog(t, 1.55, .5)
    if p > 0:
        s = out_back(p)
        over(c, L['stk1'], mat(770, 250,max(.01, s), -7 + 4 * (1 - p), L['stk1'].shape[1] / 2, L['stk1'].shape[0] / 2), min(1, p * 4))
    return c

def scene2(t):
    lt = t - (T1 - TR)
    e = out_cubic(prog(lt, 0, 3.))
    camera = (1.0 + .08 * e, 0, 0, 0)
    c = canvas(camera)
    over(c, L['grid'], cam(mat(W / 2, H / 2, 1.0, 0, L['grid'].shape[1] / 2, L['grid'].shape[0] / 2), *camera))
    c[:] = grade(c, (0, 0, 0), (1, 1, 1), 1.05)
    ws = L['words']; f = font('playfair-display-400-normal', 74)
    widths = [w.shape[1] - 20 for w in ws]; gap = 22
    x = W / 2 - (sum(widths) + gap * 3) / 2
    for i, (lay, wd) in enumerate(zip(ws, widths)):
        place_word(c, lay, x + wd / 2, 860, lt, .45 + i * .28)
        x += wd + gap
    place_word(c, L['big'], W / 2, 1000, lt, 1.75, .5, 0, 1.6)
    return c

def scene3(t):
    lt = t - (T2 - TR)
    e = in_out_cubic(prog(lt, 0, 3.2))
    camera = (1.0 + .14 * e, 0, 0, -1.2 * e)
    c = canvas(camera)
    wl = L['wall']
    over(c, wl, cam(mat(W / 2, H / 2 + 20 * e, 1.0, 0, wl.shape[1] / 2, wl.shape[0] / 2 + 100), *camera))
    fr = L['frame']
    over(c, fr, cam(mat(W / 2, 820 - 25 * e, 1.0 + .03 * e, 0, fr.shape[1] / 2, fr.shape[0] / 2), *camera))
    c[:] = grade(c, (0, .005, .02), (1.08, 1., .9), 1.15)
    # typewriter date
    n = int(clamp((lt - .4) / .5) * len(L['date']))
    if n > 0:
        tw = rgba(text_img(L['date'][:n], L['datef'], (240, 230, 215), 6))
        full = text_img(L['date'], L['datef'], tracking=6).width
        over(c, tw, mat(W / 2 - full / 2, 230, 1, 0, 0, tw.shape[0] / 2))
    p = prog(lt, 1.05, .45)
    if p > 0:
        s = out_back(p, 2.6)
        over(c, L['stk2'], cam(mat(W / 2, 830, max(.01, s * 1.0), -6, L['stk2'].shape[1] / 2, L['stk2'].shape[0] / 2), *camera), min(1, p * 4))
    place_word(c, L['louvre'], W / 2, 1560, lt, 1.7, .6)
    return c

def zoom_blur(img, amount, n=10):
    if amount < .004: return img
    acc = np.zeros_like(img)
    for i in range(n):
        s = 1 + amount * i / (n - 1)
        acc += cv2.warpAffine(img, mat(W / 2, H / 2, s, 0, W / 2, H / 2), (W, H), borderMode=cv2.BORDER_REFLECT)
    return acc / n

def frame_at(t):
    for tc, a, b in [(T1, scene1, scene2), (T2, scene2, scene3)]:
        if tc - TR <= t < tc + TR:
            p = (t - (tc - TR)) / (2 * TR)
            if p < .5:
                k = in_expo(p * 2) if p > 0 else 0
                img = a(t); sc = 1 + .5 * k
                img = cv2.warpAffine(np.asarray(img), mat(W / 2, H / 2, sc, 0, W / 2, H / 2), (W, H), borderMode=cv2.BORDER_REFLECT)
                img = zoom_blur(img, .35 * k)
            else:
                k = 1 - out_expo((p - .5) * 2)
                img = b(t); sc = 1 + .4 * k
                img = cv2.warpAffine(np.asarray(img), mat(W / 2, H / 2, sc, 0, W / 2, H / 2), (W, H), borderMode=cv2.BORDER_REFLECT)
                img = zoom_blur(img, .3 * k)
            flash = 1 - abs(p - .5) * 2
            return np.asarray(img) + .35 * flash ** 3
    if t < T1: return np.asarray(scene1(t))
    if t < T2: return np.asarray(scene2(t))
    return np.asarray(scene3(t))

def render(i):
    t = i / FPS
    acc = np.zeros((H, W, 3), np.float32)
    for k in range(SUB):
        acc += frame_at(t + (k / SUB - .5) * .5 / FPS)
    img = grain(acc / SUB, np.random.default_rng(i))
    fade = clamp((DUR - t) / .3)
    img = (img * fade).clip(0, 1)
    out = (img * 255).astype(np.uint8)
    cv2.imwrite(f'{SP}/render/frames/{i:04d}.png', cv2.cvtColor(out, cv2.COLOR_RGB2BGR))
    return i

if __name__ == '__main__':
    os.makedirs(f'{SP}/render/frames', exist_ok=True)
    only = [int(x) for x in sys.argv[1:]] or list(range(NF))
    with Pool(4, initializer=init) as p:
        for i in p.imap_unordered(render, only, chunksize=4):
            if i % 30 == 0: print(i, flush=True)
