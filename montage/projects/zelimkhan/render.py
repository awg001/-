"""«Зелимхан» — 49.5 s storytelling reel. Scenes are timed to the voiceover (words.json from tools/align.py).
Footage is procedural for now (network to photo archives was closed); each scene is a slot a real photo can replace."""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../lib'))
from storykit import *
from multiprocessing import Pool

OUT = f'{WORK}/zelimkhan'
DUR = 49.5
NF = int(DUR * FPS)
SUB = 4
TR = .22
CUTS = [4.2, 8.3, 15.2, 18.85, 20.95, 26.4, 28.75, 33.85, 43.0]
NO_CAPTION = [(18.85, 20.95), (28.75, 33.85)]      # cards that already show the spoken words

RED, YEL, GOLD = (226, 34, 44), (247, 214, 64), (214, 170, 92)

# ---------- procedural plates ----------
def ridge(width, rough, seed, amp):
    rng = np.random.default_rng(seed)
    n = 1
    h = np.array([0., 0.])
    a = amp
    while n < width:
        mid = (h[:-1] + h[1:]) / 2 + rng.normal(0, a, len(h) - 1)
        nh = np.empty(len(h) * 2 - 1); nh[0::2] = h; nh[1::2] = mid
        h, n, a = nh, n * 2, a * rough
    h = np.interp(np.linspace(0, len(h) - 1, width), np.arange(len(h)), h)
    return cv2.GaussianBlur(h.astype(np.float32)[None, :], (0, 0), 5)[0]

def mountains(seed, sky, ridges, fog, stars=False):
    """sky: (top, bottom) rgb 0..1; ridges: list of (baseline_y, amp, colour). Returns [sky, ridge layers...]."""
    w, h = W + 400, H + 400
    gy = np.linspace(0, 1, h)[:, None, None]
    s = np.array(sky[0]) * (1 - gy) + np.array(sky[1]) * gy
    s = np.repeat(s, w, axis=1).astype(np.float32)
    if stars:
        rng = np.random.default_rng(seed + 9)
        for _ in range(500):
            x, y = rng.integers(0, w), rng.integers(0, int(h * .45))
            s[y, x] = np.clip(s[y, x] + rng.uniform(.3, .9), 0, 1)
        s = cv2.GaussianBlur(s, (0, 0), .7)
    layers = [np.dstack([s, np.ones((h, w), np.float32)])]
    yy_ = np.arange(h)[:, None]
    for k, (base, amp, col) in enumerate(ridges):
        line = base + ridge(w, .48, seed + k, amp)
        a = (yy_ > line[None, :]).astype(np.float32)
        a = cv2.GaussianBlur(a, (0, 0), 1.2)
        depth = np.clip((yy_ - line[None, :]) / 500, 0, 1)
        c = np.array(col, np.float32)[None, None, :] * (1 - .35 * depth[..., None]) + np.array(fog, np.float32) * .25 * (1 - depth[..., None]) ** 3
        c = np.broadcast_to(c, (h, w, 3)).copy()
        layers.append(np.dstack([c, a]).astype(np.float32))
    return layers

def paper(w, h, base=(222, 205, 168), seed=1, stain=.25):
    rng = np.random.default_rng(seed)
    p = np.ones((h, w, 3), np.float32) * np.array(base, np.float32) / 255
    n = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 40)
    p *= (1 + stain * n / max(1e-6, np.abs(n).max()))[..., None]
    p *= (1 + .04 * rng.normal(0, 1, (h, w)).astype(np.float32))[..., None]
    yy_, xx_ = np.mgrid[0:h, 0:w].astype(np.float32)
    v = 1 - .35 * (((xx_ - w / 2) / (w * .6)) ** 2 + ((yy_ - h / 2) / (h * .6)) ** 2)
    return np.clip(p * v[..., None], 0, 1)

def grid_bg(c0, c1, line=(1.18, 1.18, 1.18), accent=(.12, .02, .06), seed=3):
    g = np.zeros((H + 200, W + 200, 3), np.float32)
    gy = np.linspace(0, 1, H + 200)[:, None, None]
    g[:] = np.array(c0) * (1 - gy) + np.array(c1) * gy
    for x in range(0, W + 200, 46): g[:, x:x + 2] *= line
    for y in range(0, H + 200, 46): g[y:y + 2] *= line
    for x in range(23, W + 200, 230): g[:, x:x + 2] += np.array(accent)
    for y in range(23, H + 200, 230): g[y:y + 2] += np.array(accent)
    rng = np.random.default_rng(seed)
    g *= 1 + cv2.GaussianBlur(rng.normal(0, .25, g.shape[:2]).astype(np.float32), (0, 0), 30)[..., None]
    return np.dstack([g.clip(0, 1), np.ones(g.shape[:2], np.float32)])

def opaque(img): return np.dstack([img, np.ones(img.shape[:2], np.float32)]).astype(np.float32)

def pil_from(arr): return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))

def stone_wall():
    w, h = W + 400, H + 400
    rng = np.random.default_rng(11)
    wall = np.ones((h, w, 3), np.float32) * np.array([.16, .155, .15])
    for r, y in enumerate(range(0, h, 120)):
        off = (r % 2) * 110
        for x in range(-off, w, 220):
            wall[y:y + 120, max(0, x):x + 220] *= rng.uniform(.75, 1.15)
            wall[y:y + 6, max(0, x):x + 220] *= .45
            wall[y:y + 120, max(0, x):max(0, x) + 6] *= .45
    wall *= (1 + .1 * cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 3))[..., None]
    yy_, xx_ = np.mgrid[0:h, 0:w].astype(np.float32)
    beam = np.clip(1 - np.abs((xx_ - 380) - (yy_ - 250) * .55) / 260, 0, 1) * np.clip(1 - yy_ / 2000, 0, 1)
    wall = wall * (.45 + 1.6 * beam[..., None] * np.array([1.1, 1., .85]))
    return opaque(np.clip(wall, 0, 1))

def bars():
    w, h = W + 400, H + 400
    im = np.zeros((h, w, 4), np.float32)
    xs = np.arange(-30, 31) / 30.
    prof = np.sqrt(np.clip(1 - xs ** 2, 0, 1))
    for cx in range(80, w, 190):
        for i, p in enumerate(prof):
            x = cx + i - 30
            if 0 <= x < w:
                im[:, x, :3] = np.array([.05, .05, .055]) + .32 * p ** 3 * (1 if i < 30 else .4)
                im[:, x, 3] = 1
    for y in (330, 1650):
        im[y - 26:y + 26, :, :3] = np.array([.07, .07, .075]); im[y - 26:y - 18, :, :3] += .18; im[y - 26:y + 26, :, 3] = 1
    return im

def document():
    w, h = 760, 1000
    p = paper(w, h, (226, 212, 180), 4, .3)
    im = pil_from(p).convert('RGBA')
    d = ImageDraw.Draw(im)
    d.rectangle([28, 28, w - 28, h - 28], outline=(90, 70, 50, 255), width=3)
    d.text((w / 2, 90), 'ТЕРСКАЯ ОБЛАСТЬ', font=font('montserrat-600-normal', 30), fill=(70, 55, 40), anchor='mm')
    d.text((w / 2, 190), 'ДЕЛО', font=font('playfair-display-900-normal', 110), fill=(40, 30, 22), anchor='mm')
    d.text((w / 2, 290), '1901 г.', font=font('playfair-display-400-italic', 46), fill=(60, 45, 32), anchor='mm')
    rng = np.random.default_rng(2)
    for y in range(380, h - 90, 46):
        x = 80
        while x < w - 120:
            ln = int(rng.integers(40, 150))
            d.line([x, y, min(w - 80, x + ln), y], fill=(110, 95, 75, 255), width=6); x += ln + 18
    return rgba(shadowed(im, (14, 22), 22, .6, 50))

def stamp(text, col=RED):
    f = font('montserrat-900-normal', 96)
    t = text_img(text, f, col)
    pad = 26
    im = Image.new('RGBA', (t.width + pad * 2, t.height + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([4, 4, im.width - 5, im.height - 5], 14, outline=col + (255,), width=9)
    im.alpha_composite(t, (pad, pad))
    a = np.asarray(im).astype(np.float32) / 255
    rng = np.random.default_rng(5)
    erode = cv2.GaussianBlur(rng.random(a.shape[:2]).astype(np.float32), (0, 0), 2.2)
    a[..., 3] *= np.clip((erode - .35) * 6, 0, 1) * .92
    return a

def wanted():
    w, h = 820, 1150
    im = pil_from(paper(w, h, (214, 192, 150), 7, .35)).convert('RGBA')
    d = ImageDraw.Draw(im)
    d.rectangle([24, 24, w - 24, h - 24], outline=(60, 40, 25, 255), width=5)
    d.text((w / 2, 120), 'РАЗЫСКИВАЕТСЯ', font=font('playfair-display-900-normal', 70), fill=(40, 25, 15), anchor='mm')
    d.line([90, 190, w - 90, 190], fill=(60, 40, 25), width=3)
    # no photo: an engraved question mark stands in for the portrait
    q = Image.new('L', (w, h), 0)
    ImageDraw.Draw(q).text((w / 2, 500), '?', font=font('playfair-display-900-normal', 520), fill=255, anchor='mm')
    hatch = Image.new('RGBA', (w, h), (0, 0, 0, 0)); hd = ImageDraw.Draw(hatch)
    for x in range(-h, w, 9): hd.line([x, h, x + h, 0], fill=(45, 30, 20, 255), width=4)
    im.paste(hatch, (0, 0), q)
    d.text((w / 2, 840), 'АБРЕК ЗЕЛИМХАН', font=font('playfair-display-900-normal', 70), fill=(40, 25, 15), anchor='mm')
    d.text((w / 2, 930), 'ХАРАЧОЕВСКИЙ', font=font('montserrat-800-normal', 40), fill=(70, 45, 30), anchor='mm')
    d.line([90, 990, w - 90, 990], fill=(60, 40, 25), width=3)
    d.text((w / 2, 1060), 'за поимку — награда', font=font('playfair-display-400-italic', 50), fill=(50, 32, 20), anchor='mm')
    return rgba(shadowed(im, (18, 30), 26, .65, 60))

def wood():
    w, h = W + 400, H + 400
    rng = np.random.default_rng(21)
    n = cv2.resize(rng.normal(0, 1, (h // 8, 24)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    stripes = np.sin(np.linspace(0, 60, w)[None, :] + 3 * n) * .5 + .5
    base = np.array([.24, .14, .08]) * (.75 + .35 * stripes[..., None])
    yy_, xx_ = np.mgrid[0:h, 0:w].astype(np.float32)
    v = np.clip(1.2 - (((xx_ - w / 2) / w) ** 2 + ((yy_ - h / 2) / h) ** 2) * 2.2, .25, 1)
    return opaque(np.clip(base * v[..., None], 0, 1).astype(np.float32))

# --- map (Natural Earth admin-1) ---
MAP_W, MAP_H = 2200, 2600
LON0, LON1, LAT0, LAT1 = 43.4, 48.0, 41.6, 44.9
def proj(lon, lat):
    k = math.cos(math.radians(43.3))
    sx = MAP_W / ((LON1 - LON0) * k)
    x = (lon - LON0) * k * sx
    y = MAP_H / 2 - (lat - (LAT0 + LAT1) / 2) * sx
    return x, y

GROZNY, SHALI = proj(45.694, 43.318), proj(45.899, 43.149)

def caucasus_map():
    g = json.load(open(f'{A}/map/caucasus.geojson'))
    base = paper(MAP_W, MAP_H, (40, 34, 28), 12, .4)
    im = pil_from(base).convert('RGBA')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for x in range(0, MAP_W, 120): d.line([x, 0, x, MAP_H], fill=(255, 230, 190, 14), width=2)
    for y in range(0, MAP_H, 120): d.line([0, y, MAP_W, y], fill=(255, 230, 190, 14), width=2)
    def polys(geom):
        cs = geom['coordinates']
        return cs if geom['type'] == 'MultiPolygon' else [cs]
    for f in g['features']:
        chech = f['properties'].get('name') == 'Chechnya'
        for poly in polys(f['geometry']):
            pts = [proj(*p[:2]) for p in poly[0]]
            if chech: d.polygon(pts, fill=(120, 34, 26, 200))
            d.line(pts + [pts[0]], fill=(214, 170, 92, 255) if chech else (220, 200, 170, 70), width=6 if chech else 3)
    im.alpha_composite(ov)
    d = ImageDraw.Draw(im)
    fl = font('montserrat-800-normal', 46)
    d.ellipse([GROZNY[0] - 14, GROZNY[1] - 14, GROZNY[0] + 14, GROZNY[1] + 14], fill=(240, 230, 215))
    d.text((GROZNY[0] - 30, GROZNY[1] - 20), 'ГРОЗНЫЙ', font=fl, fill=(240, 230, 215), anchor='rb')
    return rgba(im)

def ring_layer(r, width, col, alpha):
    s = int(r + width + 4) * 2
    im = np.zeros((s, s, 4), np.float32)
    cv2.circle(im, (s // 2, s // 2), int(r), (*[c / 255 for c in col], alpha), int(width), lineType=cv2.LINE_AA)
    return im

def name_layer(col=(40, 28, 20), max_w=960):
    size = 200
    while font('playfair-display-900-normal', size).getlength('ЗЕЛИМХАН') > max_w: size -= 4
    return rgba(text_img('ЗЕЛИМХАН', font('playfair-display-900-normal', size), col))

# ---------- captions ----------
def caption_chunks(words):
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        if w['w'][-1] in '.,:—' or len(cur) == 3 or w['w'] == '—':
            chunks.append(cur); cur = []
    if cur: chunks.append(cur)
    return [[w for w in c if w['w'] != '—'] for c in chunks if any(w['w'] != '—' for w in c)]

_cap_cache = {}
def caption_img(ci, active):
    key = (ci, active)
    if key in _cap_cache: return _cap_cache[key]
    ch = L['chunks'][ci]; f = L['capf']
    words = [w['w'].rstrip('.,:') for w in ch]
    sp = f.getlength(' ')
    widths = [f.getlength(w) for w in words]
    tw = sum(widths) + sp * (len(words) - 1)
    im = Image.new('RGBA', (int(tw) + 60, 120), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x = 30
    for i, (w, wd) in enumerate(zip(words, widths)):
        col = YEL if i == active else (255, 255, 255)
        d.text((x, 60), w, font=f, fill=col, anchor='lm', stroke_width=6, stroke_fill=(0, 0, 0))
        x += wd + sp
    a = rgba(shadowed(im, (0, 6), 10, .6, 20))
    if len(_cap_cache) > 64: _cap_cache.clear()
    _cap_cache[key] = a
    return a

def draw_captions(dst, t):
    if any(a - .1 <= t < b + .1 for a, b in NO_CAPTION): return
    chs = L['chunks']
    for ci, ch in enumerate(chs):
        t0 = ch[0]['start'] - .06
        t1 = chs[ci + 1][0]['start'] - .06 if ci + 1 < len(chs) else ch[-1]['end'] + .6
        if t0 <= t < t1:
            active = max(i for i, w in enumerate(ch) if w['start'] - .06 <= t) if t >= ch[0]['start'] - .06 else 0
            img = caption_img(ci, active)
            p = out_back(clamp((t - t0) / .16), 1.8)
            over(dst, img, mat(W / 2, 1530, .85 + .15 * p, 0, img.shape[1] / 2, img.shape[0] / 2), min(1, (t - t0) / .08))
            return

# ---------- assets ----------
L = None
def load():
    D = {}
    D['dawn'] = mountains(1, ((.10, .13, .2), (.78, .52, .34)),
                          [(820, 260, (.36, .38, .44)), (1040, 230, (.22, .23, .27)), (1260, 220, (.12, .12, .14)), (1520, 200, (.05, .05, .06))],
                          (.95, .8, .65))
    D['night'] = mountains(7, ((.01, .03, .08), (.10, .19, .32)),
                           [(860, 280, (.14, .2, .3)), (1080, 240, (.08, .12, .2)), (1300, 220, (.04, .06, .1)), (1560, 200, (.01, .015, .03))],
                           (.4, .55, .8), stars=True)
    D['paper'] = opaque(paper(W + 300, H + 300, (214, 196, 160), 3, .14))
    D['name_dark'] = name_layer()
    D['wall'], D['bars'] = stone_wall(), bars()
    D['doc'], D['stamp'] = document(), stamp('ОСУЖДЁН')
    D['red_grid'] = grid_bg((.20, .02, .03), (.38, .05, .06), accent=(.10, .06, .02))
    D['warm_grid'] = grid_bg((.18, .07, .03), (.42, .17, .06), accent=(.08, .06, .0))
    D['wood'], D['wanted'] = wood(), wanted()
    D['map'] = caucasus_map()
    D['final_bg'] = opaque(paper(W + 300, H + 300, (30, 24, 20), 8, .5))
    D['name_gold'] = name_layer((230, 190, 110))
    mb = font('montserrat-900-normal', 64)
    D['p_kh'] = rgba(plate('ХАРАЧОЙ, ЧЕЧНЯ', mb, RED, (255, 255, 255)))
    D['p_fa'] = rgba(plate('сын Гушмазуко', font('montserrat-600-normal', 44), (255, 255, 255), (20, 20, 20)))
    D['p_both'] = rgba(plate('ВМЕСТЕ С ОТЦОМ', font('montserrat-900-normal', 52), (255, 255, 255), (20, 20, 20)))
    D['p_jail'] = rgba(plate('ГРОЗНЕНСКАЯ ТЮРЬМА', font('montserrat-900-normal', 52), RED, (255, 255, 255)))
    D['p_list'] = [rgba(plate(s, font('montserrat-900-normal', 58), c1, c2)) for s, c1, c2 in
                   [('ЧИНОВНИКИ', (255, 255, 255), (20, 20, 20)), ('ПОЛИЦИЯ', (255, 255, 255), (20, 20, 20)), ('ПОЕЗДА', RED, (255, 255, 255))]]
    D['s_12'] = rgba(torn_sticker('12 ЛЕТ ОХОТЫ', font('montserrat-900-normal', 70), YEL, (15, 15, 15), 3))
    D['s_1901'] = rgba(torn_sticker('1901', font('montserrat-900-normal', 110), YEL, (15, 15, 15), 4))
    D['s_run'] = rgba(torn_sticker('ПОБЕГ', font('montserrat-900-normal', 100), RED, (255, 255, 255), 6))
    D['s_abrek'] = rgba(torn_sticker('АБРЕК', font('montserrat-900-normal', 120), YEL, (15, 15, 15), 8))
    D['s_reward'] = rgba(torn_sticker('НАГРАДА', font('montserrat-900-normal', 96), RED, (255, 255, 255), 10))
    D['s_shali'] = rgba(torn_sticker('ШАЛИ', font('montserrat-900-normal', 84), YEL, (15, 15, 15), 12))
    sf = font('playfair-display-400-normal', 74)
    D['w_begin'] = [rgba(text_img(w, sf)) for w in ['И', 'это', 'было', 'только']]
    D['w_begin_big'] = rgba(text_img('НАЧАЛО', font('playfair-display-900-normal', 170)))
    D['w_aul'] = [rgba(text_img(w, font('playfair-display-400-normal', 62))) for w in ['А', 'в', 'аулах', 'говорили', 'иначе']]
    D['w_quote'] = rgba(text_img('«защитник', font('playfair-display-900-normal', 120), (247, 214, 64)))
    D['w_quote2'] = rgba(text_img('бедных»', font('playfair-display-900-normal', 120), (247, 214, 64)))
    D['w_molva'] = rgba(text_img('— так говорила молва', font('playfair-display-400-italic', 54), (240, 225, 200)))
    D['years'] = rgba(text_img('1872 — 1913', font('montserrat-600-normal', 52), (230, 210, 170), 8))
    D['date'] = '27 СЕНТЯБРЯ 1913'
    D['datef'] = font('montserrat-800-normal', 64)
    D['capf'] = font('montserrat-800-normal', 60)
    D['words'] = json.load(open(f'{OUT}/words.json'))
    D['chunks'] = caption_chunks(D['words'])
    rng = np.random.default_rng(31)
    n = cv2.GaussianBlur(rng.random((900, 1700)).astype(np.float32), (0, 0), 14)
    D['erode'] = (n - n.min()) / (n.max() - n.min())
    return D

def init():
    global L
    L = load()

def C(lay, cx, cy, s=1., r=0.): return mat(cx, cy, s, r, lay.shape[1] / 2, lay.shape[0] / 2)

def pop(dst, lay, cx, cy, t, t0, rot=-6, d=.45, camera=None):
    p = prog(t, t0, d)
    if p <= 0: return
    M = C(lay, cx, cy, max(.01, out_back(p, 2.4)), rot + 5 * (1 - p))
    over(dst, lay, cam(M, *camera) if camera else M, min(1, p * 4))

def slide(dst, lay, x, y, t, t0, d=.55):
    p = out_quint(prog(t, t0, d))
    if p <= 0: return
    b = blur_layer(lay, 10 * (1 - p)); lay2 = b[0] if isinstance(b, tuple) else lay
    over(dst, lay2, mat(x - 760 * (1 - p), y, 1, -2, 0, lay2.shape[0] / 2), min(1, p * 2))

def layers_parallax(c, layers, e, camera, base=1.0, spread=.10, lift=0):
    for k, lay in enumerate(layers):
        depth = k / max(1, len(layers) - 1)
        s = base + (.02 + spread * depth) * e
        over(c, lay, cam(C(lay, W / 2, H / 2 + lift * depth * e, s), *camera))

def intro_cam(lt, extra=0., dy=0.):
    i = out_expo(prog(lt, 0, .7))
    return (1.30 - .30 * i + extra, 0, -50 * (1 - i) + dy, 0)

# ---------- scenes (t is global time; lt is time since scene start incl. transition lead-in) ----------
def sc_hook(t):
    lt = t; e = in_out_cubic(prog(t, 0, 4.5))
    camera = intro_cam(lt, .05 * e)
    c = canvas(camera)
    layers_parallax(c, L['dawn'], e, camera, 1.0, .12, 40)
    c[:] = grade(c)
    pop(c, L['s_12'], W / 2, 420, t, .55)
    return c

def sc_name(t):
    lt = t - (CUTS[0] - TR); e = out_cubic(prog(lt, 0, 4.4))
    camera = (1.0 + .07 * e, 0, 0, 0)
    c = canvas(camera)
    over(c, L['paper'], cam(C(L['paper'], W / 2, H / 2), *camera))
    nm = L['name_dark']
    place_word(c, nm, W / 2, 760, t, 4.35, .55, 0, 1.5)
    c[:] = grade(c, (0, 0, .01), (1.04, 1., .95), 1.08)
    slide(c, L['p_kh'], 110, 1000, t, 4.9)
    slide(c, L['p_fa'], 110, 1110, t, 6.3)
    return c

def sc_prison(t):
    lt = t - (CUTS[1] - TR); e = in_out_cubic(prog(lt, 0, 7.2))
    camera = (1.0 + .10 * e, 0, 0, .6 * e)
    c = canvas(camera)
    over(c, L['wall'], cam(C(L['wall'], W / 2, H / 2, 1.02 + .03 * e), *camera))
    over(c, L['bars'], cam(C(L['bars'], W / 2, H / 2, 1.0 + .16 * e), *camera))
    c[:] = grade(c, (0, .01, .03), (1.0, 1.0, 1.02), 1.15)
    pop(c, L['s_1901'], 300, 290, t, 8.55, -8)
    # dossier drops in, stamp slams on «бросают в тюрьму»
    p = prog(t, 9.7, .6)
    if p > 0:
        q = out_expo(p)
        over(c, L['doc'], C(L['doc'], W / 2 + 20, 880 - 120 * (1 - q), 1.35 - .35 * q, -4 + 6 * (1 - q)), min(1, p * 3))
    slide(c, L['p_both'], 90, 1340, t, 10.3)
    p = prog(t, 11.1, .28)
    if p > 0:
        q = out_expo(p)
        over(c, L['stamp'], C(L['stamp'], W / 2 + 40, 1000, 1.9 - .9 * q, -14), min(1, p * 3))
    return c

def shake(t, t0, amp=18, d=.35):
    k = prog(t, t0, d)
    if k <= 0 or k >= 1: return 0, 0
    f = (1 - k) ** 2 * amp
    return f * math.sin(t * 38), f * math.cos(t * 31)

def sc_escape(t):
    lt = t - (CUTS[2] - TR); e = in_out_cubic(prog(lt, 0, 4.0))
    camera = intro_cam(lt, .08 * e, -30 * e)
    c = canvas(camera)
    layers_parallax(c, L['night'], e, camera, 1.0, .16, 60)
    c[:] = grade(c, (0, .01, .05), (.95, 1., 1.1), 1.1)
    pop(c, L['s_run'], W / 2, 520, t, 15.85, -5)
    slide(c, L['p_jail'], 90, 760, t, 16.5)
    return c

def word_card(t, bg, words, big, t_words, t_big, y=860):
    lt = t
    c = canvas((1.0 + .06 * out_cubic(prog(t, t_words[0] - .3, 2.5)), 0, 0, 0))
    over(c, bg, cam(C(bg, W / 2, H / 2), *c.camera))
    c[:] = grade(c, (0, 0, 0), (1, 1, 1), 1.05)
    widths = [w.shape[1] - 20 for w in words]; gap = 22
    x = W / 2 - (sum(widths) + gap * (len(words) - 1)) / 2
    for lay, wd, tw in zip(words, widths, t_words):
        place_word(c, lay, x + wd / 2, y, t, tw - .05, .4)
        x += wd + gap
    if big is not None: place_word(c, big, W / 2, y + 160, t, t_big - .05, .5, 0, 1.6)
    return c

def sc_begin(t):
    return word_card(t, L['red_grid'], L['w_begin'], L['w_begin_big'], [19.0, 19.1, 19.5, 19.8], 20.1)

def sc_rails(t):
    lt = t - (CUTS[4] - TR)
    sx, sy = shake(t, 25.6, 9)
    camera = (1.04 + .04 * math.sin(lt * .8), sx, sy, .8 * math.sin(lt * 1.3))
    c = canvas(camera)
    # dusk sky + ground
    gy = np.linspace(0, 1, H)[:, None, None]
    sky = np.array([.08, .07, .1]) * (1 - gy) + np.array([.62, .34, .2]) * gy
    img = np.repeat(sky, W, axis=1).astype(np.float32)
    vy = 760
    img[vy:] = np.array([.07, .055, .05]) * (1 + .6 * np.linspace(0, 1, H - vy)[:, None, None])
    lay = np.zeros((H, W, 4), np.float32)
    speed = 9.0
    for k in range(60):
        z = ((k * .55 - lt * speed) % 33) + .6
        y = vy + 900 / z
        hw = 900 / z * 1.05
        th = max(1, 90 / z)
        if y > H + 200: continue
        pts = np.array([[W / 2 - hw, y], [W / 2 + hw, y], [W / 2 + hw * 1.02, y + th], [W / 2 - hw * 1.02, y + th]], np.int32)
        cv2.fillPoly(lay, [pts], (.16, .11, .08, 1), lineType=cv2.LINE_AA)
    for side in (-1, 1):
        for off, col in ((0, (.55, .5, .48, 1)), (8, (.2, .18, .17, 1))):
            p0 = (int(W / 2 + side * (W * 1.35 + off)), H + 400); p1 = (int(W / 2 + side * 3), vy)
            cv2.line(lay, p0, p1, col, 22 if off == 0 else 10, lineType=cv2.LINE_AA)
    base = opaque(img)
    over(c, base, cam(mat(0, 0), *camera))
    over(c, lay, cam(mat(0, 0), *camera))
    # drifting steam
    for k in range(5):
        x = (k * 260 + lt * 120) % (W + 600) - 300
        g = np.zeros((420, 420, 4), np.float32)
        cv2.circle(g, (210, 210), 150, (.75, .72, .7, .35), -1); g = cv2.GaussianBlur(g, (0, 0), 50)
        over(c, g, cam(mat(x, 560 + 60 * math.sin(k + lt), 1.4 + .3 * k % 2, 0, 210, 210), *camera))
    c[:] = grade(c, (0, 0, .02), (1.08, .98, .9), 1.12)
    pop(c, L['s_abrek'], W / 2, 430, t, 21.9, -6)
    for lay2, y, t0 in zip(L['p_list'], (720, 830, 940), (23.55, 24.2, 25.55)):
        slide(c, lay2, 110, y, t, t0)
    return c

def sc_wanted(t):
    lt = t - (CUTS[5] - TR); e = out_cubic(prog(lt, 0, 2.6))
    camera = (1.0 + .06 * e, *shake(t, 26.75, 16), -.8 * e)
    c = canvas(camera)
    over(c, L['wood'], cam(C(L['wood'], W / 2, H / 2), *camera))
    p = prog(t, 26.45, .45)
    if p > 0:
        q = out_expo(p)
        wl = L['wanted']
        over(c, wl, cam(C(wl, W / 2, 900, 1.6 - .6 * q, -10 + 7 * q), *camera), min(1, p * 3))
    c[:] = grade(c, (0, 0, .01), (1.08, 1., .9), 1.12)
    pop(c, L['s_reward'], W / 2 + 120, 1360, t, 27.95, 7)
    return c

def sc_molva(t):
    c = word_card(t, L['warm_grid'], L['w_aul'], None, [28.9, 29.0, 29.0, 29.85, 30.2], 0, 760)
    place_word(c, L['w_quote'], W / 2, 980, t, 32.2, .5, 0, 1.5)
    place_word(c, L['w_quote2'], W / 2, 1120, t, 32.85, .5, 0, 1.5)
    place_word(c, L['w_molva'], W / 2, 1300, t, 33.2, .5)
    return c

def sc_map(t):
    lt = t - (CUTS[7] - TR)
    zin = in_out_cubic(prog(t, 37.8, 2.2))
    m = L['map']
    # map space -> canvas: start framing Chechnya, then dive towards Shali
    cx = (GROZNY[0] + SHALI[0]) / 2 * (1 - zin) + SHALI[0] * zin
    cy = (GROZNY[1] + SHALI[1]) / 2 * (1 - zin) + SHALI[1] * zin
    s = (.62 + .04 * out_cubic(prog(lt, 0, 4))) * (1 - zin) + 1.5 * zin
    intro = out_expo(prog(lt, 0, .7))
    camera = (1.25 - .25 * intro, 0, 0, -1.0 * zin)
    c = canvas(camera)
    M = mat(W / 2, 980, s, 0, cx, cy)
    over(c, m, cam(M, *camera))
    # Shali point, encircling ring, then the light goes out
    sx_, sy_ = (M @ np.array([SHALI[0], SHALI[1], 1.]))
    if t >= 37.85:
        p = out_back(prog(t, 37.85, .35))
        dot = ring_layer(16, 32, YEL, 1.)
        over(c, dot, cam(C(dot, sx_, sy_, max(.01, p)), *camera))
    if t >= 38.7:
        k = in_out_cubic(prog(t, 38.7, 2.2))
        r = 420 - 330 * k
        ring = ring_layer(r, 10, RED, .95)
        over(c, ring, cam(C(ring, sx_, sy_), *camera), min(1, (t - 38.7) * 4))
    dark = prog(t, 41.6, .9)
    c[:] = grade(c, (0, 0, .01), (1.05, 1., .92), 1.1) * (1 - .55 * dark)
    if t >= 41.6:
        fl = math.exp(-(t - 41.6) * 9)
        c[:] = c + np.array([.9, .2, .15], np.float32) * .35 * fl
    n = int(clamp((t - 34.1) / 2.9) * len(L['date']))
    if n > 0:
        tw = rgba(text_img(L['date'][:n], L['datef'], (245, 235, 220), 6))
        full = text_img(L['date'], L['datef'], tracking=6).width
        over(c, tw, mat(W / 2 - full / 2, 300, 1, 0, 0, tw.shape[0] / 2))
    pop(c, L['s_shali'], W / 2 + 230, 520, t, 37.85, 6)
    return c

def sc_final(t):
    lt = t - (CUTS[8] - TR); e = in_out_cubic(prog(lt, 0, 6.5))
    camera = (1.0 + .08 * e, 0, 0, 0)
    c = canvas(camera)
    over(c, L['final_bg'], cam(C(L['final_bg'], W / 2, H / 2), *camera))
    nm = L['name_gold'].copy()
    # «уничтожить человека»: the name erodes; «но имя...»: it comes back, glowing
    gone = in_out_cubic(prog(t, 43.4, 2.0)) * (1 - out_cubic(prog(t, 46.0, 1.4)))
    er = cv2.resize(L['erode'], (nm.shape[1], nm.shape[0]))
    nm[..., 3] *= np.clip((er - gone * 1.15) * 8 + 1, 0, 1)
    glow = out_cubic(prog(t, 46.0, 1.4)) * (1 - .6 * prog(t, 47.6, 1.5))
    over(c, nm, cam(C(nm, W / 2, 900), *camera), min(1, (t - CUTS[8] + TR) * 3))
    if glow > 0:
        g = nm.copy(); g[..., :3] = np.array([1., .85, .5])
        g = cv2.GaussianBlur(g, (0, 0), 28)
        w_ = cv2.warpAffine(g, cam(C(g, W / 2, 900), *camera), (W, H))
        c[:] = c + w_[..., :3] * w_[..., 3:4] * .9 * glow
    c[:] = grade(c, (0, 0, .01), (1.06, 1., .9), 1.12)
    place_word(c, L['years'], W / 2, 1060, t, 47.0, .6)
    return c

SCENES = [sc_hook, sc_name, sc_prison, sc_escape, sc_begin, sc_rails, sc_wanted, sc_molva, sc_map, sc_final]

def scene_at(t):
    k = sum(t >= c for c in CUTS)
    return SCENES[k]

def frame_at(t):
    for i, tc in enumerate(CUTS):
        if tc - TR <= t < tc + TR:
            p = (t - (tc - TR)) / (2 * TR)
            a, b = SCENES[i], SCENES[i + 1]
            if p < .5:
                k = in_expo(p * 2) if p > 0 else 0
                img = cv2.warpAffine(np.asarray(a(t)), mat(W / 2, H / 2, 1 + .5 * k, 0, W / 2, H / 2), (W, H), borderMode=cv2.BORDER_REFLECT)
                img = zoom_blur(img, .35 * k)
            else:
                k = 1 - out_expo((p - .5) * 2)
                img = cv2.warpAffine(np.asarray(b(t)), mat(W / 2, H / 2, 1 + .4 * k, 0, W / 2, H / 2), (W, H), borderMode=cv2.BORDER_REFLECT)
                img = zoom_blur(img, .3 * k)
            return np.asarray(img) + .3 * (1 - abs(p - .5) * 2) ** 3
    return np.asarray(scene_at(t)(t))

def render(i):
    t = i / FPS
    acc = np.zeros((H, W, 3), np.float32)
    for k in range(SUB):
        acc += frame_at(t + (k / SUB - .5) * .5 / FPS)
    img = acc / SUB
    c = img.view(Canvas); c.camera = (1, 0, 0, 0)
    draw_captions(c, t)
    img = grain(np.asarray(c), np.random.default_rng(i))
    img = (img * clamp((DUR - t) / .5) * clamp(t / .15)).clip(0, 1)
    cv2.imwrite(f'{OUT}/frames/{i:04d}.png', cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    return i

if __name__ == '__main__':
    os.makedirs(f'{OUT}/frames', exist_ok=True)
    only = [int(x) for x in sys.argv[1:]] or list(range(NF))
    with Pool(4, initializer=init) as p:
        for i in p.imap_unordered(render, only, chunksize=4):
            if i % 150 == 0: print(i, flush=True)
