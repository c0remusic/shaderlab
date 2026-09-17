"""Chiffre ce que la planche montre : le grain amplifie, et le halo de bord.

Deux mesures, sur les memes pixels des deux cotes :

  GRAIN — ecart-type d'une zone lisse, rapporte a celui du temoin. C'est le
    facteur par lequel l'operateur amplifie le bruit du capteur. Un filtre guide
    le freine (son epsilon ferme la ou la variance monte) ; un passe-haut nu le
    multiplie tel quel.

  BORD — profil moyen en travers de la frontiere rouge/gris, rapporte au temoin.
    Le depassement de part et d'autre EST le lisere qu'on voit.
"""
import os

import numpy as np
from PIL import Image

SP = r"C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad"
LR = os.path.expanduser("~/Documents/shaderlab-lightroom-mesures")
X, Y, T = 2600, 2500, 320
DOSES = ["ph-temoin", "ph-texture-p40", "ph-texture-p100", "ph-texture-m60"]
LUMA = np.array([0.2126, 0.7152, 0.0722])


def lr(dose):
    a = Image.open(os.path.join(LR, dose + ".jpg")).convert("RGB").crop((X, Y, X + T, Y + T))
    return np.asarray(a, dtype=np.float64) @ LUMA


def nous(dose):
    a = Image.open(os.path.join(SP, f"nous-{dose}-petale.png")).convert("RGB")
    return np.asarray(a, dtype=np.float64) @ LUMA


# ZONE LISSE : un carre du gris clair, loin de la frontiere. On retire une
# tendance lineaire avant de mesurer, sinon la pente du degrade compte comme du
# grain.
def grain(img):
    z = img[200:280, 200:280]
    yy, xx = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    A = np.c_[xx.ravel(), yy.ravel(), np.ones(z.size)]
    coef, *_ = np.linalg.lstsq(A, z.ravel(), rcond=None)
    return float((z.ravel() - A @ coef).std())


print("GRAIN — ecart-type d'une zone lisse, et facteur par rapport au temoin")
gt_lr, gt_nous = grain(lr("ph-temoin")), grain(nous("ph-temoin"))
print("  %-16s %10s %10s %10s %10s" % ("", "LR", "LR x", "nous", "nous x"))
for d in DOSES:
    a, b = grain(lr(d)), grain(nous(d))
    print("  %-16s %10.2f %10.2f %10.2f %10.2f" % (d.replace("ph-", ""), a, a / gt_lr, b, b / gt_nous))

# BORD : la frontiere rouge/gris traverse le detourage en diagonale. On prend une
# BANDE de lignes et on suit le profil selon x autour du saut, ligne par ligne
# recalee sur son propre point d'inflexion.
def profil_bord(img, temoin, montant):
    """⚠️ SEPARE PAR POLARITE. Une frontiere diagonale traverse le detourage dans
    les deux sens ; moyenner les deux ensemble annule tout halo SIGNE et ne
    laisse que sa part symetrique. Un liseré d'accentuation est signe."""
    ecarts = []
    for y in range(40, 280):
        ligne, t = img[y], temoin[y]
        d = np.diff(t)
        i = int(np.argmax(np.abs(d)))
        if np.abs(d).max() < 5 or i < 40 or i > T - 40:
            continue
        if (d[i] > 0) != montant:
            continue
        ecarts.append((ligne - t)[i - 30:i + 30])
    return np.array(ecarts).mean(axis=0) if ecarts else None


print()
print("BORD — ecart au temoin en travers de la frontiere (negatif = assombri)")
print("  distance au bord " + "".join("%7d" % k for k in range(-12, 13, 3)))
for montant in (True, False):
    print("  --- bord %s (cote gauche = sombre)" % ("MONTANT" if montant else "DESCENDANT"))
    for d in DOSES[1:]:
        for tag, f in (("Lightroom", lr), ("shaderlab", nous)):
            p = profil_bord(f(d), f("ph-temoin"), montant)
            if p is None:
                continue
            vals = [p[30 + k] for k in range(-12, 13, 3)]
            print("  %-9s %-6s " % (tag, d.replace("ph-texture-", "")) + "".join("%7.2f" % v for v in vals))
