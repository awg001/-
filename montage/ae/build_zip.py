"""Pack Caption AE for testers: python3 build_zip.py out.zip

UTF-8 file names (Russian names stay readable on Windows) and the exec bit on install_mac.command."""
import os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['CaptionAE.jsx', 'transcribe.py', 'README.md'] + sorted('install/' + f for f in os.listdir(os.path.join(HERE, 'install')))
# default sounds keep their folder (the panel looks for CaptionAE_sounds/whoosh and /hit next to the script)
SOUNDS = sorted(os.path.join(d, f).replace(os.sep, '/')[len(HERE) + 1:]
                for d, _, fs in os.walk(os.path.join(HERE, 'CaptionAE_sounds')) for f in fs if f.endswith('.wav'))


def main(out):
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in FILES + SOUNDS:
            src = os.path.join(HERE, rel)
            info = zipfile.ZipInfo.from_file(src, 'CaptionAE/' + (rel if rel in SOUNDS else os.path.basename(rel)))
            info.compress_type = zipfile.ZIP_DEFLATED
            if rel.endswith('.command'):
                info.external_attr = 0o100755 << 16
            z.writestr(info, open(src, 'rb').read())
    print(out, len(FILES) + len(SOUNDS), 'files')


if __name__ == '__main__':
    main(sys.argv[1])
