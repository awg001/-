#!/usr/bin/env python3
"""Caption AE — builds the CEP panel (top tabs, HTML) and signs it as a .zxp.

    python3 montage/ae/cep/build_cep.py OUT_DIR

OUT_DIR/com.captionae.panel/   the extension folder, signed (what the installers copy into CEP/extensions)
OUT_DIR/CaptionAE.zxp          the same, signed — for ZXP installers (aescripts ZXP Installer, Anastasiy's, ExManCmd)
OUT_DIR/CaptionAE_panel.zip    both + the installers and guides from install/ — what testers get

The signature is Adobe's ZXP format (UCF zip + META-INF/signatures.xml, XML-DSig): every file's SHA-256 goes into a
<Manifest>, the Manifest's canonical form is digested into <SignedInfo>, SignedInfo is signed RSA-SHA1 with the key in
sign/. Adobe's ZXPSignCmd does the same but has no Linux build. The certificate is self-signed, as ZXPSignCmd's own
-selfSignedCert makes; the key is committed on purpose: it proves nothing about the author, only keeps updates under one
certificate. After signing, the package is verified from the zip itself (verify()).
"""
import base64, datetime, hashlib, os, re, shutil, sys, urllib.parse, zipfile
from lxml import etree
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding

HERE = os.path.dirname(os.path.abspath(__file__))
AE = os.path.dirname(HERE)
BUNDLE = "com.captionae.panel"
DS = "http://www.w3.org/2000/09/xmldsig#"
C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256"
MIMETYPE = b"application/vnd.adobe.air-ucf-package+zip"


def assemble(dst):
    """Extension folder: CSXS, client, host (+ the engine, the recogniser and the sounds, shared with the ScriptUI panel)."""
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(os.path.join(HERE, "CSXS"), os.path.join(dst, "CSXS"))
    shutil.copytree(os.path.join(HERE, "client"), os.path.join(dst, "client"))
    os.makedirs(os.path.join(dst, "host"))
    shutil.copy(os.path.join(HERE, "host", "host.jsx"), os.path.join(dst, "host"))
    shutil.copy(os.path.join(AE, "CaptionAE.jsx"), os.path.join(dst, "host"))
    shutil.copy(os.path.join(AE, "transcribe.py"), os.path.join(dst, "host"))
    shutil.copytree(os.path.join(AE, "CaptionAE_sounds"), os.path.join(dst, "host", "CaptionAE_sounds"),
                    ignore=shutil.ignore_patterns("*.py", "__pycache__", ".DS_Store"))


def files_of(root):
    out = []
    for d, dirs, fs in os.walk(root):
        dirs.sort()
        for f in sorted(fs):
            if f == ".DS_Store":
                continue
            p = os.path.join(d, f)
            out.append(os.path.relpath(p, root).replace(os.sep, "/"))
    return out


def key_and_cert():
    kp, cp = os.path.join(HERE, "sign", "captionae_key.pem"), os.path.join(HERE, "sign", "captionae_cert.pem")
    if not os.path.exists(kp):
        os.makedirs(os.path.dirname(kp), exist_ok=True)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, "RU"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Caption AE"),
                          x509.NameAttribute(NameOID.COMMON_NAME, "Caption AE")])
        now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365 * 25))
                .sign(key, hashes.SHA256()))
        open(kp, "wb").write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        open(cp, "wb").write(cert.public_bytes(serialization.Encoding.PEM))
    key = serialization.load_pem_private_key(open(kp, "rb").read(), None)
    cert = x509.load_pem_x509_certificate(open(cp, "rb").read())
    return key, cert


def b64(b):
    return base64.b64encode(b).decode()


def c14n(el):
    return etree.tostring(el, method="c14n", exclusive=True, with_comments=False)  # what Adobe's signer produces (checked on a real ZXP)


def signatures_xml(root, names, key, cert):
    refs = "".join('<Reference URI="%s"><DigestMethod Algorithm="%s"/><DigestValue>%s</DigestValue></Reference>'
                   % (urllib.parse.quote(n, safe="/"), SHA256, b64(hashlib.sha256(open(os.path.join(root, n), "rb").read()).digest()))
                   for n in names)
    cert_b64 = b64(cert.public_bytes(serialization.Encoding.DER))
    cert_b64 = "\n".join(cert_b64[i:i + 64] for i in range(0, len(cert_b64), 64))
    xml = ('<signatures>\n<Signature xmlns="%s" Id="PackageSignature">\n<SignedInfo>\n'
           '<CanonicalizationMethod Algorithm="%s"/>\n<SignatureMethod Algorithm="%srsa-sha1"/>\n'
           '<Reference Type="%sManifest" URI="#PackageContents">\n<Transforms>\n<Transform Algorithm="%s"/>\n</Transforms>\n'
           '<DigestMethod Algorithm="%s"/>\n<DigestValue></DigestValue>\n</Reference>\n</SignedInfo>\n'
           '<SignatureValue Id="PackageSignatureValue"></SignatureValue>\n\n'
           '<KeyInfo>\n<X509Data>\n<X509Certificate>%s\n</X509Certificate>\n</X509Data>\n</KeyInfo>\n'
           '<Object>\n<Manifest Id="PackageContents">\n%s\n</Manifest>\n</Object>\n</Signature>\n</signatures>'
           % (DS, C14N, DS, DS, C14N, SHA256, cert_b64, refs))
    doc = etree.fromstring(xml.encode())
    ns = {"d": DS}
    man = doc.find(".//d:Manifest", ns)
    doc.find(".//d:SignedInfo/d:Reference/d:DigestValue", ns).text = b64(hashlib.sha256(c14n(man)).digest())
    si = doc.find(".//d:SignedInfo", ns)
    sv = b64(key.sign(c14n(si), padding.PKCS1v15(), hashes.SHA1()))
    doc.find(".//d:SignatureValue", ns).text = "\n".join(sv[i:i + 64] for i in range(0, len(sv), 64))  # wrapped like ZXPSignCmd
    return etree.tostring(doc)


def verify(zxp):
    """Checks a .zxp the way an installer does: every file listed with the right SHA-256, nothing unlisted,
    the Manifest digest, the RSA signature over SignedInfo with the certificate inside. Returns a list of problems."""
    z, bad = zipfile.ZipFile(zxp), []
    infos = z.infolist()
    if infos[0].filename != "mimetype" or infos[0].compress_type != zipfile.ZIP_STORED or z.read("mimetype") != MIMETYPE:
        bad.append("mimetype is not the first, uncompressed entry")
    doc, ns = etree.fromstring(z.read("META-INF/signatures.xml")), {"d": DS}
    man = doc.find(".//d:Manifest", ns)
    listed = {}
    for r in man.findall("d:Reference", ns):
        listed[urllib.parse.unquote(r.get("URI"))] = r.find("d:DigestValue", ns).text
    for i in infos:
        if i.is_dir() or i.filename.startswith("META-INF/"):
            continue
        if i.filename not in listed:
            bad.append("not signed: " + i.filename)
        elif b64(hashlib.sha256(z.read(i.filename)).digest()) != listed.pop(i.filename):
            bad.append("digest differs: " + i.filename)
    bad += ["listed but missing: " + n for n in listed]
    if doc.find(".//d:SignedInfo/d:Reference/d:DigestValue", ns).text != b64(hashlib.sha256(c14n(man)).digest()):
        bad.append("Manifest digest differs")
    cert = x509.load_der_x509_certificate(base64.b64decode(re.sub(r"\s", "", doc.find(".//d:X509Certificate", ns).text)))
    try:
        cert.public_key().verify(base64.b64decode(re.sub(r"\s", "", doc.find(".//d:SignatureValue", ns).text)),
                                 c14n(doc.find(".//d:SignedInfo", ns)), padding.PKCS1v15(), hashes.SHA1())
    except Exception:
        bad.append("RSA signature does not verify")
    return bad


def zxp(root, out):
    key, cert = key_and_cert()
    names = ["mimetype"] + files_of(root)
    open(os.path.join(root, "mimetype"), "wb").write(MIMETYPE)
    sig = signatures_xml(root, names, key, cert)
    os.remove(os.path.join(root, "mimetype"))
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype", (2026, 1, 1, 0, 0, 0)), MIMETYPE, compress_type=zipfile.ZIP_STORED)
        for n in names[1:]:
            z.write(os.path.join(root, n), n, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("META-INF/signatures.xml", sig, compress_type=zipfile.ZIP_DEFLATED)
    return verify(out)


def pack(out, ext):
    """OUT/CaptionAE_panel.zip for users: the signed folder + the .zxp + installers and guides (.bat with CRLF, .command executable)."""
    with zipfile.ZipFile(os.path.join(out, "CaptionAE_panel.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for n in files_of(ext):
            z.write(os.path.join(ext, n), "CaptionAE_panel/" + BUNDLE + "/" + n)
        z.write(os.path.join(out, "CaptionAE.zxp"), "CaptionAE_panel/CaptionAE.zxp")
        for f in sorted(os.listdir(os.path.join(HERE, "install"))):
            data = open(os.path.join(HERE, "install", f), "rb").read()
            info = zipfile.ZipInfo("CaptionAE_panel/" + f, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            if f.endswith((".bat", ".txt")):
                data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            info.external_attr = (0o100755 if f.endswith(".command") else 0o100644) << 16
            z.writestr(info, data)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--verify":
        bad = verify(sys.argv[2])
        print("\n".join(bad[:20]) if bad else "signature OK")
        sys.exit(1 if bad else 0)
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "cep_build")
    os.makedirs(out, exist_ok=True)
    ext = os.path.join(out, BUNDLE)
    assemble(ext)
    bad = zxp(ext, os.path.join(out, "CaptionAE.zxp"))
    if bad:
        sys.exit("ZXP check failed:\n" + "\n".join(bad))
    # the folder the installers copy = the signed package unpacked, so CEP accepts it even without debug mode
    shutil.rmtree(ext)
    zipfile.ZipFile(os.path.join(out, "CaptionAE.zxp")).extractall(ext)
    pack(out, ext)
    print("built", ext, "and", os.path.join(out, "CaptionAE.zxp"), "(%d files, signature OK)" % len(files_of(ext)))
