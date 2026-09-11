"""Compare le rendu HSL de shaderlab a l'export Lightroom, mesure par mesure.

PROVISOIRE tant que les exports du plugin n'existent pas
(Documents/shaderlab-lightroom-mesures/). C'est la premiere fois qu'un effet se
mesure contre la REFERENCE elle-meme et non contre son propre temoin.

Protocole :
  1. pour chaque mesure `hsl-*` de Lightroom (voir MESURES ci-dessous), on connait
     le reglage shaderlab equivalent (le meme, cle par cle) ;
  2. shaderlab rend la MEME mire (mireBalayage) avec ce reglage, a la resolution de
     l'export Lightroom (2048x1280), via le harnais de look-dev
     `render-check-page.html` (module map vierge -> sert les modules du DISQUE,
     edition non commitee comprise ; aucun IPC). Le companion `rendre-mire-hsl.mjs`
     ecrit ces rendus dans `assets/rendus-hsl/<nom>.png` (a ecrire/lancer quand les
     exports existent, sur le patron de `planche-02-reglages-rendu.mjs`) ;
  3. on compare canal par canal sur le BALAYAGE de teinte (la zone qui porte le
     signal HSL), et on imprime ecart moyen et max.

Sans les exports (ni les rendus), le script le dit et sort proprement.

Usage : python comparer-lightroom.py [dossier_exports] [dossier_rendus]
"""
import sys, os, glob
import numpy as np
from PIL import Image

# Reglage shaderlab equivalent a chaque mesure Lightroom (le meme, cle par cle).
# Les cles sont celles du module hsl (hslDevelop.ts).
MESURES = {
    "hsl-teinte-rouge-p100": {"redHue": 100},
    "hsl-teinte-rouge-m100": {"redHue": -100},
    "hsl-teinte-orange-p100": {"orangeHue": 100},
    "hsl-teinte-jaune-p100": {"yellowHue": 100},
    "hsl-teinte-vert-p100": {"greenHue": 100},
    "hsl-teinte-aqua-p100": {"aquaHue": 100},
    "hsl-teinte-bleu-p100": {"blueHue": 100},
    "hsl-teinte-violet-p100": {"purpleHue": 100},
    "hsl-teinte-magenta-p100": {"magentaHue": 100},
    "hsl-sat-rouge-p100": {"redSat": 100},
    "hsl-sat-rouge-m100": {"redSat": -100},
    "hsl-sat-bleu-p100": {"blueSat": 100},
    "hsl-sat-bleu-m100": {"blueSat": -100},
    "hsl-lum-rouge-p100": {"redLum": 100},
    "hsl-lum-rouge-m100": {"redLum": -100},
    "hsl-lum-bleu-p100": {"blueLum": 100},
    "hsl-lum-bleu-m100": {"blueLum": -100},
    "hsl-lum-vert-p100": {"greenLum": 100},
    "nb": {"mode": 1},
}

# Bande de balayage de teinte (sat 100 %) dans la mire 2048x1280 : y 192..384.
Y0, Y1 = 192, 384


def comparer(lr_path, sl_path):
    lr = np.asarray(Image.open(lr_path).convert("RGB"), dtype=np.float64)
    sl = np.asarray(Image.open(sl_path).convert("RGB"), dtype=np.float64)
    if lr.shape != sl.shape:
        return None, f"dimensions differentes LR {lr.shape} vs shaderlab {sl.shape}"
    a = lr[Y0:Y1]
    b = sl[Y0:Y1]
    d = np.abs(a - b)
    return {"moyenne": float(d.mean()), "max": float(d.max()),
            "p95": float(np.percentile(d, 95))}, None


def main():
    exports = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
    rendus = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "rendus-hsl")
    if not glob.glob(os.path.join(exports, "hsl-*.jpg")) and not glob.glob(os.path.join(exports, "nb.jpg")):
        print("Aucun export Lightroom hsl-* dans", exports)
        print("-> a lancer quand le plugin shaderlab-dump.lrdevplugin aura produit les exports,")
        print("   puis rendre-mire-hsl.mjs pour peupler", rendus, "(patron planche-02-reglages-rendu.mjs).")
        sys.exit(0)

    print(f"{'mesure':28s} {'moyenne':>8s} {'p95':>6s} {'max':>5s}")
    for nom in MESURES:
        lr = os.path.join(exports, nom + ".jpg")
        sl = os.path.join(rendus, nom + ".png")
        if not os.path.exists(lr):
            continue
        if not os.path.exists(sl):
            print(f"{nom:28s}  rendu shaderlab absent ({sl}) — lancer rendre-mire-hsl.mjs")
            continue
        stats, err = comparer(lr, sl)
        if err:
            print(f"{nom:28s}  {err}")
        else:
            print(f"{nom:28s} {stats['moyenne']:8.2f} {stats['p95']:6.1f} {stats['max']:5.0f}")


if __name__ == "__main__":
    main()
