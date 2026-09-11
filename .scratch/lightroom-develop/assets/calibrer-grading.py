"""Calibre la table du Color Grading de shaderlab sur les profils MESURES de
Lightroom 14.5 (research/mesures/*.json). Meme contrat que calibrer-hsl.py : lit
les mesures, ajuste dans les termes du forward-model, REECRIT src/render/effects/
colorGradingTable.ts (les seuls champs MESURABLES), imprime les residus.

⚠️ CE QUI EST MESURABLE, ET CE QUI NE L EST PAS (constat sur piece 2026-09-11).
Les teintes Ombres / Hautes lumieres du Color Grading vivent, dans le moteur de
Lightroom, sous les cles HERITEES SplitToningShadow* / SplitToningHighlight*, PAS
sous ColorGradeShadowHue / ColorGradeHighlightHue. Le plugin de mesure a ecrit ces
dernieres : Lightroom les a ignorees, et grading-ombres-bleu (220/60) comme
grading-hl-orange (40/60) rendent une rampe de gris STRICTEMENT NEUTRE dans les
exports (dch = 0 partout, verifie en OKLab). Idem Balance et Fusion (dont l effet
ne se lit que sur une teinte presente). NE SONT DONC MESURABLES QUE :

  - MEDIANS (grading-moyens-vert, MidtoneSat 60) : la cloche de chroma sur la
    luminance -> midCenter, midSigma, chromaK.
  - GLOBAL luminance (grading-global-lum-p50, GlobalLum +50) : le lift en cloche
    -> lumK.

chromaK / lumK sont REUTILISES pour les quatre roues (un seul modele de melange).
Les profils Ombres / Hautes lumieres, Balance et Fusion sont MODELISES, non
mesurables ici, bornes par le twin, provisoires (posture du grayK au ticket 05).

Usage : python calibrer-grading.py [dossier_des_json]   (defaut : ../research/mesures)
"""
import sys, os, math, re

def s2l(x):
    x = max(x / 255.0, 0.0)
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

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

import json
def load(dossier, nom):
    p = os.path.join(dossier, nom + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

def oklab_ramp(d):
    """256 points (L_oklab, a, b) de la rampe de gris teintee."""
    return [lin_to_oklab(*[s2l(c) for c in px]) for px in d["rampe_rgb"]]

def fit_midtone(dossier):
    """Ajuste midCenter, midSigma, chromaK sur grading-moyens-vert (MidtoneSat 60)."""
    tem = load(dossier, "temoin"); mv = load(dossier, "grading-moyens-vert")
    if tem is None or mv is None:
        return None
    ot, om = oklab_ramp(tem), oklab_ramp(mv)
    pts = []
    for v in range(4, 252, 4):
        La, aa, ba = om[v]; Lt, at, bt = ot[v]
        pts.append((La, math.hypot(aa - at, ba - bt)))
    best = (1e18, None)
    midcs = [x / 100 for x in range(45, 76)]
    sigs = [x / 1000 for x in range(80, 240, 4)]
    cks = [x / 1000 for x in range(80, 300, 2)]
    for midC in midcs:
        for sig in sigs:
            for cK in cks:
                e = 0.0
                for L, ch in pts:
                    pred = 0.6 * cK * math.exp(-((L - midC) ** 2) / (2 * sig * sig))
                    e += (pred - ch) ** 2
                if e < best[0]:
                    best = (e, (midC, sig, cK))
    midC, sig, cK = best[1]
    return midC, sig, cK, math.sqrt(best[0] / len(pts))

def fit_global_lum(dossier):
    """Ajuste lumK sur grading-global-lum-p50 (GlobalLum +50), poids 4L(1-L)."""
    tem = load(dossier, "temoin"); gl = load(dossier, "grading-global-lum-p50")
    if tem is None or gl is None:
        return None
    ot, og = oklab_ramp(tem), oklab_ramp(gl)
    pts = []
    for v in range(4, 252, 4):
        pts.append((ot[v][0], og[v][0] - ot[v][0]))
    best = (1e18, None)
    for lK in [x / 1000 for x in range(20, 300)]:
        e = sum((0.5 * lK * 4 * L * (1 - L) - dL) ** 2 for L, dL in pts)
        if e < best[0]:
            best = (e, lK)
    return best[1], math.sqrt(best[0] / len(pts))

def reecrire_table(midC, sig, cK, lK):
    ts = os.path.join(os.path.dirname(__file__), "..", "..", "..",
                      "src", "render", "effects", "colorGradingTable.ts")
    txt = open(ts, encoding="utf-8").read()
    remplacements = {"chromaK": cK, "lumK": lK, "midCenter": midC, "midSigma": sig}
    for champ, val in remplacements.items():
        pat = re.compile(r"(\b" + champ + r":\s*)[-\d.]+")
        neuf, n = pat.subn(lambda m: m.group(1) + f"{round(val, 4)}", txt, count=1)
        if n != 1:
            raise SystemExit(f"champ {champ} introuvable dans colorGradingTable.ts")
        txt = neuf
    open(ts, "w", encoding="utf-8").write(txt)
    print("reecrit", ts)

def main():
    dossier = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(__file__), "..", "research", "mesures")
    mt = fit_midtone(dossier)
    gl = fit_global_lum(dossier)
    if mt is None or gl is None:
        print("mesures grading-moyens-vert / grading-global-lum-p50 absentes de", dossier)
        sys.exit(1)
    midC, sig, cK, rmse_mid = mt
    lK, rmse_lum = gl
    print(f"MEDIANS    midCenter={midC:.3f} midSigma={sig:.3f} chromaK={cK:.3f}  rmse={rmse_mid:.4f} (chroma OKLab)")
    print(f"GLOBAL LUM lumK={lK:.3f}  rmse={rmse_lum:.4f} (dL OKLab)")
    print("MODELISES (non mesurables) : shadowCenter, highCenter, softBase, softSpread, midSoft, balanceShift")
    reecrire_table(midC, sig, cK, lK)

if __name__ == "__main__":
    main()
