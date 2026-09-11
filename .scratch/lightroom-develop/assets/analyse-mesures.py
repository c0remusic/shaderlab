"""Lit les JPEG exportes par le plugin (Documents/shaderlab-lightroom-mesures/)
et en tire, pour chaque mesure :
  - la COURBE DE TRANSFERT sur la rampe de gris (256 points, entree -> sortie sRGB),
  - le DECALAGE DE TEINTE / saturation / luminance sur le balayage 0..360 (sat 100 %, L 50 %),
  - les patches (primaires, peaux, gris 18 %).
Sortie : research/mesures/<nom>.json + research/03-courbes-lightroom-mesurees.md (tableau).
Usage : python analyse-mesures.py [dossier_des_jpeg]
"""
import sys, os, json, glob, colorsys
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
OUT = os.path.join(os.path.dirname(__file__), "..", "research", "mesures")
os.makedirs(OUT, exist_ok=True)
W = 2048

def rows(img, y0, y1):
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    return a[y0:y1].mean(axis=0)  # moyenne verticale -> (W, 3)

def rampe(img):
    r = rows(img, 40, 150)  # coeur de la bande, loin des bords
    # 256 niveaux, 8 px chacun : moyenne des 8 px (en evitant les 2 px de bord jpeg)
    out = []
    for v in range(256):
        x0 = v * 8 + 2; x1 = v * 8 + 6
        out.append(float(r[x0:x1].mean()))  # luminance sRGB moyenne (R=G=B sur une rampe)
    return out

def rampe_rgb(img):
    r = rows(img, 40, 150)
    return [[round(float(c), 2) for c in r[v * 8 + 2:v * 8 + 6].mean(axis=0)] for v in range(256)]

def balayage(img, y0, y1):
    r = rows(img, y0 + 30, y1 - 30) / 255.0
    hs = []
    for x in range(0, W, 8):
        px = r[x:x + 8].mean(axis=0)
        h, l, s = colorsys.rgb_to_hls(*px.tolist())
        hs.append([round(x * 360 / W, 1), round(h * 360, 2), round(s, 4), round(l, 4)])
    return hs  # [teinte_entree, teinte_sortie, sat, lum]

def patches(img):
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    pw = W // 12
    return [a[1120:1250, i * pw + 20:(i + 1) * pw - 20].reshape(-1, 3).mean(axis=0).round(2).tolist() for i in range(12)]

def bandes(img):
    # 8 bandes Lightroom (R,O,J,V,Aqua,B,Violet,M) : luminance de sortie le long de x (lum d'entree 0..1)
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    res = {}
    for i, nom in enumerate(["rouge", "orange", "jaune", "vert", "aqua", "bleu", "violet", "magenta"]):
        y0 = 768 + i * 40 + 8; y1 = y0 + 24
        r = a[y0:y1].mean(axis=0) / 255.0
        pts = []
        for x in range(0, W, 64):
            px = r[x:x + 64].mean(axis=0)
            h, l, s = colorsys.rgb_to_hls(*px.tolist())
            pts.append([round(x / W, 3), round(h * 360, 1), round(s, 3), round(l, 3)])
        res[nom] = pts
    return res

def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.jpg")))
    if not files:
        print("aucun JPEG dans", SRC); sys.exit(1)
    temoin = None
    resume = []
    for f in files:
        nom = os.path.splitext(os.path.basename(f))[0]
        img = Image.open(f)
        if img.size != (W, 1280):
            print("dimensions inattendues", nom, img.size); continue
        d = {"nom": nom, "rampe": rampe(img), "rampe_rgb": rampe_rgb(img), "balayage": balayage(img, 192, 384),
             "balayage_l25": balayage(img, 576, 672), "balayage_l75": balayage(img, 672, 768),
             "balayage_sat50": balayage(img, 384, 576), "patches": patches(img), "bandes": bandes(img)}
        with open(os.path.join(OUT, nom + ".json"), "w", encoding="utf-8") as o:
            json.dump(d, o, ensure_ascii=False)
        if nom == "temoin": temoin = d
        resume.append(d)
    if temoin is None:
        print("pas de temoin"); sys.exit(1)
    t = np.array(temoin["rampe"])
    def teinte_gris(d):
        rgb = np.array(d["rampe_rgb"])
        return [f"{rgb[v][0]-rgb[v][2]:+.0f}/{rgb[v][1]-(rgb[v][0]+rgb[v][2])/2:+.0f}" for v in (32, 128, 224)]
    tb25 = np.array([[p[1], p[2], p[3]] for p in temoin["balayage_l25"]])
    lines = ["# Courbes de Lightroom Classic 14.5.1, mesurées en boîte noire", "",
             f"Source : {len(resume)} exports JPEG (sRGB, q100) de la mire, produits par le plugin",
             "`assets/shaderlab-dump.lrdevplugin` (AutoMesures). Données brutes : `research/mesures/<nom>.json`.",
             "Rampe : sortie sRGB pour les entrées 0 · 32 · 64 · 96 · 128 · 160 · 192 · 224 · 255,",
             "puis écart max à la rampe témoin. Teinte : décalage moyen (°) sur le balayage sat 100 % L 50 %,",
             "et sur le balayage sombre (L 25 %). « Gris » : dérive R−B / G−(R+B)/2 de la rampe grise aux niveaux 32, 128, 224", "",
             "| mesure | 0 | 32 | 64 | 96 | 128 | 160 | 192 | 224 | 255 | écart max | Δteinte moy | Δsat moy | Δlum moy | Δteinte L25 | gris 32 · 128 · 224 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    tb = np.array([[p[1], p[2], p[3]] for p in temoin["balayage"]])
    for d in resume:
        r = np.array(d["rampe"]); b = np.array([[p[1], p[2], p[3]] for p in d["balayage"]])
        dh = ((b[:, 0] - tb[:, 0] + 180) % 360) - 180
        cells = [f"{r[i]:.0f}" for i in (0, 32, 64, 96, 128, 160, 192, 224, 255)]
        b25 = np.array([[p[1], p[2], p[3]] for p in d["balayage_l25"]]); dh25 = ((b25[:, 0] - tb25[:, 0] + 180) % 360) - 180
        lines.append(f"| {d['nom']} | " + " | ".join(cells) + f" | {np.abs(r - t).max():.1f} | {dh.mean():+.1f} | {(b[:,1]-tb[:,1]).mean():+.3f} | {(b[:,2]-tb[:,2]).mean():+.3f} | {dh25.mean():+.1f} | {' · '.join(teinte_gris(d))} |")
    md = os.path.join(os.path.dirname(__file__), "..", "research", "03-courbes-lightroom-mesurees.md")
    with open(md, "w", encoding="utf-8") as o:
        o.write("\n".join(lines) + "\n")
    print("écrit", md, "et", len(resume), "json")

if __name__ == "__main__":
    main()
