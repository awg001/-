"""Build Cyrillic+Latin TTFs from @fontsource npm packages (PIL needs TTF, fontsource ships split woff2)."""
import glob, os, subprocess, sys
from fontTools.ttLib import TTFont
from fontTools.merge import Merger

FD = sys.argv[1]
os.makedirs(FD, exist_ok=True)
os.chdir(FD)
WANT = [('playfair-display', 400, 'normal'), ('playfair-display', 700, 'normal'), ('playfair-display', 900, 'normal'),
        ('playfair-display', 400, 'italic'), ('montserrat', 600, 'normal'), ('montserrat', 800, 'normal'),
        ('montserrat', 900, 'normal')]
for fam in sorted({f for f, _, _ in WANT}):
    if not glob.glob(f'fontsource-{fam}-*.tgz'):
        subprocess.run(['npm', 'pack', '-q', f'@fontsource/{fam}'], check=True, capture_output=True)
    tgz = glob.glob(f'fontsource-{fam}-*.tgz')[0]
    subprocess.run(['tar', 'xzf', tgz, '--one-top-level'], check=True)
for fam, w, st in WANT:
    name = f'{fam}-{w}-{st}.ttf'
    if os.path.exists(name): continue
    parts = []
    for sub in ['latin', 'cyrillic']:
        src = glob.glob(f'*{fam}*/package/files/{fam}-{sub}-{w}-{st}.woff2')[0]
        f = TTFont(src); f.flavor = None
        out = f'_{sub}_{fam}{w}{st}.ttf'; f.save(out); parts.append(out)
    Merger().merge(parts).save(name)
    print(name)
