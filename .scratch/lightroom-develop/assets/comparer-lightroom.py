"""Compare le rendu HSL de shaderlab au profil MESURE de Lightroom 14.5, mesure par
mesure, AVANT et APRES la calibration du 2026-09-11.

C'est la premiere fois qu'un effet se mesure contre la REFERENCE elle-meme, pas
contre son propre temoin. Le plugin n'exporte pas d'IMAGE brute exploitable ici :
`analyse-mesures.py` a deja reduit chaque export en profil `balayage`
([teinte_entree, teinte_sortie, sat, lum], 256 points a sat 100 % L 50 %). On
compare donc en ESPACE BALAYAGE :

  - Lightroom : on RECONSTRUIT la couleur sRGB de sortie a partir du balayage mesure
    (HLS(teinte_sortie, sat, lum) -> sRGB 0..255).
  - shaderlab : on applique le forward-model (jumeau EXACT du shader `hsl`) a la
    couleur d'entree ideale HLS(teinte_entree, 1, 0.5), meme reglage que la mesure,
    et on lit la sortie sRGB 0..255.
  - ecart = |LR - shaderlab| par CANAL sur tout le balayage : moyenne et max, en
    NIVEAUX (0..255).

AVANT = table « usuelle » d'avant calibration (amp 30, sigma 25 symetrique, satK 1,
lumK 0.5, grayK 0.5, couleurs pures). APRES = table calibree, LUE dans hslBandes.ts.
Le delta dit « notre HSL est passe de X a Y niveaux du leur ».

Usage : python comparer-lightroom.py [dossier_des_json]  (defaut ../research/mesures)
"""
import sys, os, math, json, re
import colorsys

CHROMA_REF = 0.05

def srgb_to_lin(x):
    x = max(x, 0.0)
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

def lin_to_srgb(x):
    x = min(1.0, max(0.0, x))
    return x * 12.92 if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055

def _cb(x):
    return math.copysign(abs(x) ** (1 / 3), x)

def lin_to_oklab(r, g, b):
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = _cb(l), _cb(m), _cb(s)
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)

def oklab_to_lin(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)

def hls_srgb01(hdeg, s, l):
    return colorsys.hls_to_rgb((hdeg % 360) / 360.0, l, s)

def band_dir(rgb):
    lin = [srgb_to_lin(c) for c in rgb]
    lab = lin_to_oklab(*lin)
    c = math.hypot(lab[1], lab[2]) or 1.0
    return lab[1] / c, lab[2] / c

def load(dossier, nom):
    p = os.path.join(dossier, nom + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

# Mesures Lightroom -> (bande, role, valeur) du reglage shaderlab equivalent.
MESURES = {
    "hsl-teinte-rouge-p100": ("red", "hue", +100), "hsl-teinte-orange-p100": ("orange", "hue", +100),
    "hsl-teinte-jaune-p100": ("yellow", "hue", +100), "hsl-teinte-vert-p100": ("green", "hue", +100),
    "hsl-teinte-aqua-p100": ("aqua", "hue", +100), "hsl-teinte-bleu-p100": ("blue", "hue", +100),
    "hsl-teinte-violet-p100": ("purple", "hue", +100), "hsl-teinte-magenta-p100": ("magenta", "hue", +100),
    "hsl-sat-rouge-m100": ("red", "sat", -100), "hsl-sat-bleu-m100": ("blue", "sat", -100),
    "hsl-lum-rouge-p100": ("red", "lum", +100), "hsl-lum-bleu-p100": ("blue", "lum", +100),
    "hsl-lum-vert-p100": ("green", "lum", +100),
}

AVANT = {b: {"rgb": rgb, "amp": 30.0, "sL": 25.0, "sR": 25.0, "satK": 1.0, "lumK": 0.5, "grayK": 0.5}
         for b, rgb in {"red": [1, 0, 0], "orange": [1, 0.5, 0], "yellow": [1, 1, 0],
                        "green": [0, 1, 0], "aqua": [0, 1, 1], "blue": [0, 0, 1],
                        "purple": [0.5, 0, 1], "magenta": [1, 0, 1]}.items()}

def table_courante():
    ts = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "render", "effects", "hslBandes.ts")
    txt = open(ts, encoding="utf-8").read()
    tbl = {}
    for m in re.finditer(r'id:\s*"(\w+)",\s*rgb:\s*\[([^\]]+)\],\s*amplitudeDeg:\s*([\d.]+),\s*'
                         r'sigmaLeftDeg:\s*([\d.]+),\s*sigmaRightDeg:\s*([\d.]+),\s*'
                         r'satK:\s*([\d.]+),\s*lumK:\s*([\d.]+),\s*grayK:\s*([\d.]+)', txt):
        tbl[m.group(1)] = {"rgb": [float(x) for x in m.group(2).split(",")],
                           "amp": float(m.group(3)), "sL": float(m.group(4)), "sR": float(m.group(5)),
                           "satK": float(m.group(6)), "lumK": float(m.group(7)), "grayK": float(m.group(8))}
    if len(tbl) != 8:
        raise SystemExit(f"table courante illisible ({len(tbl)} bandes lues)")
    return tbl

def forward(in_rgb01, band, role, val):
    L, a, b = lin_to_oklab(*[srgb_to_lin(c) for c in in_rgb01])
    chroma = math.hypot(a, b)
    t = min(1, max(0, chroma / CHROMA_REF)); gate = t * t * (3 - 2 * t)
    dx, dy = band_dir(band["rgb"])
    cosd = (a * dx + b * dy) / chroma if chroma > 1e-5 else 0.0
    ang = math.acos(max(-1, min(1, cosd)))
    cross = a * dy - b * dx
    sig = math.radians(band["sR"] if cross >= 0 else band["sL"])
    w = math.exp(-(ang * ang) / (sig * sig)) * gate
    rot = w * (val / 100.0) * math.radians(band["amp"]) if role == "hue" else 0.0
    satMul = 1 + w * (val / 100.0) * band["satK"] if role == "sat" else 1.0
    lumMul = 1 + w * (val / 100.0) * band["lumK"] if role == "lum" else 1.0
    c, s = math.cos(rot), math.sin(rot)
    rl, gl, bl = oklab_to_lin(L * lumMul, (a * c - b * s) * satMul, (a * s + b * c) * satMul)
    return [lin_to_srgb(v) * 255 for v in (rl, gl, bl)]

def lr_rgb(pt):
    r, g, b = colorsys.hls_to_rgb((pt[1] % 360) / 360.0, pt[3], pt[2])
    return [r * 255, g * 255, b * 255]

def actif(pt, role):
    """Vrai la ou la bande AGIT chez Lightroom (zone de pic), pour ne pas noyer
    l'ecart de l'effet dans l'immense zone d'identite du balayage."""
    if role == "hue":
        return abs(((pt[1] - pt[0] + 180) % 360) - 180) > 3.0
    if role == "sat":
        return pt[2] < 0.9      # desature
    return abs(pt[3] - 0.5) > 0.03  # luminance modifiee (entree a L 0.5)

def compare(dossier, table):
    out = []
    for nom, (bid, role, val) in MESURES.items():
        m = load(dossier, nom)
        if m is None:
            continue
        band = table[bid]
        errs, pics = [], []
        for pt in m["balayage"]:
            ours = forward(hls_srgb01(pt[0], 1.0, 0.5), band, role, val)
            theirs = lr_rgb(pt)
            e = [abs(ours[k] - theirs[k]) for k in range(3)]
            errs.extend(e)
            if actif(pt, role):
                pics.extend(e)
        pic_moy = (sum(pics) / len(pics)) if pics else 0.0
        out.append((nom, sum(errs) / len(errs), max(errs), pic_moy))
    return out

def main():
    dossier = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "research", "mesures")
    la = compare(dossier, AVANT)
    lb = compare(dossier, table_courante())
    print("Ecart |Lightroom - shaderlab| en NIVEAUX sRGB (0..255). "
          "moy = tout le balayage ; pic = zone ou la bande agit ; max = pire canal.")
    print(f"{'mesure':26s} | {'AVANT moy/pic/max':>18s} | {'APRES moy/pic/max':>18s}")
    ag, bg, ap, bp = [], [], [], []
    for (nom, am, ax, apic), (_, bm, bx, bpic) in zip(la, lb):
        print(f"{nom:26s} | {am:5.1f} /{apic:5.1f} /{ax:4.0f} | {bm:5.1f} /{bpic:5.1f} /{bx:4.0f}")
        ag.append(am); bg.append(bm); ap.append(apic); bp.append(bpic)
    print(f"{'MOYENNE':26s} | {sum(ag)/len(ag):5.1f} /{sum(ap)/len(ap):5.1f} /    | "
          f"{sum(bg)/len(bg):5.1f} /{sum(bp)/len(bp):5.1f} /")


if __name__ == "__main__":
    main()
