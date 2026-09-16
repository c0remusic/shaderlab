"""Fabrique la MIRE DE PRESENCE — celle qui peut montrer Texture et Clarte.

POURQUOI UNE TROISIEME MIRE. Ni la principale ni la locale ne peuvent rien dire
de ces deux curseurs, et pour une raison qui se mesure :

  - sur la mire PRINCIPALE, Texture mesure 0,00 et Clarte 14,1 niveaux, mais ces
    deux chiffres ne parlent pas des operateurs : sa rampe monte par marches de
    8 px et ses patches sont contigus, donc ce qu'on lit est un artefact de
    voisinage, pas une reponse ;
  - la mire LOCALE porte des aplats et des echelons. Un aplat dit qu'un operateur
    local ne fait RIEN (utile, c'est le temoin) et un echelon excite toutes les
    frequences a la fois : sa reponse est une somme qu'on ne sait pas separer.

Or ce qui separe Texture de Clarte est exactement une ECHELLE. Et le binaire dit
que ce n'est pas la seule chose a mesurer (CameraRaw.dll 14.5.1) :

  - Texture  = cr_stage_texture_direct_gf_ycc (cr_texture.cpp) : un FILTRE GUIDE
    (guide image, small content image, deux etages de reechantillonnage). Un
    filtre guide n'est PAS lineaire : son epsilon decide a partir de quelle
    variance locale il cesse d'extraire le detail et se met a preserver le bord.
    Sa reponse depend donc de l'AMPLITUDE du detail, pas seulement de sa taille.
  - Clarte   = cr_stage_local_contrast (cr_clarity.cpp) : un masque Y floute
    (LocalContrastMaskY) plus une TABLE 2D (textureScale1X/Y, textureScale2X/Y,
    clarityAmount). Une table 2D indexee par le ton veut dire que la reponse
    depend du NIVEAU de base, pas seulement du contraste local.

D'ou trois axes, un par question, et un temoin :

  ZONE ECHELLE   — 15 sinusoides verticales, base 128, amplitude 24, periodes de
    2 a 256 px par pas de ~1,5x. Donne le gain en fonction de la TAILLE du
    detail : c'est la mesure qui separe la bande fine (Texture) de la bande
    moyenne (Clarte), et qui donne le rayon de chacune.

  ZONE AMPLITUDE — deux periodes (16 et 64 px), amplitudes 2 a 64. Donne la
    non-linearite : un passe-haut lineaire rend un gain CONSTANT, un filtre guide
    rend un gain qui TOMBE quand l'amplitude depasse son epsilon. C'est l'axe qui
    identifie l'epsilon, et il n'existe sur aucune autre mire.

  ZONE TON       — memes deux periodes, amplitude 16, bases 24 a 232. Donne la
    dependance au niveau, celle que la table 2D de Clarte laisse attendre.

  ZONE PLATE     — trois aplats hauts de 256 px. Temoin : un operateur purement
    local n'y touche pas. Tout ecart y est un terme GLOBAL.

  ZONE ECHELON   — trois marches pleine page, 1024 px de haut, moitie gauche /
    moitie droite. Elle existe parce que la premiere campagne a montre que les
    trois zones ci-dessus ne peuvent PAS lire un grand rayon : leurs bandes font
    48 px, donc au-dela de ce pas c'est le voisinage VERTICAL qui remplit le
    masque, et la courbe de gain devient plate quel que soit le rayon reel. Une
    marche avec 1024 px de plateau de chaque cote donne le profil du halo en
    clair : sa largeur EST le rayon, jusqu'a ~500 px, sans demodulation.

CONTROLE INTERNE. Le stimulus (base 128, amplitude 16, periodes 16 et 64) est
present DEUX FOIS, une fois en zone AMPLITUDE (entouree de bandes de meme base)
et une fois en zone TON (entouree de bandes d'autres bases). Un operateur assez
local pour que la mire le lise rend le meme chiffre aux deux endroits ; un
operateur plus large que le pas des bandes ne le rend pas. La mire dit donc
elle-meme quand elle est aveugle — c'est le seul garde-fou qui ne se perime pas.

POURQUOI DES SINUSOIDES, ET POURQUOI VERTICALES. Un creneau porte ses harmoniques
(P/3, P/5...) : le gain lu a la periode P y melangerait trois echelles. Une
sinusoide n'excite qu'une frequence. Et le nombre de CYCLES est entier sur la
largeur (periode = W/N, pas l'inverse), donc la demodulation est exacte et sans
fuite spectrale.

Verticales — constantes selon y — pour deux raisons. La moyenne sur les lignes
tue le bruit de quantification et celui du JPEG. Et surtout : la contamination
entre bandes voisines est VERTICALE, alors que l'estimateur correle selon x a une
frequence donnee. Une contamination verticale, meme forte, ne correle pas avec
une sinusoide horizontale : l'estimateur y est aveugle. C'est ce qui permet des
gardes de 24 px au lieu de gardes plus larges que le rayon.

La deuxieme harmonique (2N) se lit au meme prix et donne l'ASYMETRIE du halo :
un operateur qui pousse plus le cote clair que le cote sombre la fait sortir.

Usage : python faire-mire-presence.py
Sorties, a poser dans C:/Users/LEETJ/Pictures/shaderlab-mire/ :
  shaderlab-mire-presence.jpg      (2048 de large)
  shaderlab-mire-presence-2x.jpg   (4096 de large, memes CYCLES donc periodes
                                    doublees — voir plus bas)
  shaderlab-mire-presence.json     (la GEOMETRIE, lue par l'analyse : un seul
                                    point de verite, jamais recopie)

LA MIRE 2x REPOND A UNE SEULE QUESTION, et c'est la plus lourde de consequences :
le rayon de Lightroom est-il en PIXELS ABSOLUS, ou proportionnel a la taille de
l'image ? Le filtre guide du binaire travaille sur une image reduite, et rien ne
dit si la reduction est fixe. Memes cycles, largeur doublee : si le rayon est
absolu, la courbe de gain se decale d'une octave ; s'il est relatif, elle est
identique. Sans cette reponse, toute calibration faite sur une mire de 2048 px ne
vaut rien sur une photo de 6240 px.
"""
import json
import os

import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))

# Nombres de CYCLES sur la largeur (la periode vaut W/N, donc elle peut etre
# fractionnaire — c'est N qui doit etre entier pour que la demodulation ferme).
# La periode 2 px (N = 1024 A LARGEUR 2048) est ECARTEE et non oubliee : a
# Nyquist la sinusoide n'a plus qu'un degre de liberte, la demodulation complexe
# y rend le double de l'amplitude reelle, et n'importe quel reechantillonnage
# detruit de toute facon ce detail. Le premier point utile est la periode 3.
# ⚠️ Cette liste est en CYCLES, donc le rang de Nyquist depend de la largeur :
# a 1024, N = 512 EST Nyquist et reste dedans, et sa bande lit le double. Sans
# consequence — la mire 1024 n'existe que pour sa zone ECHELON — mais ne pas
# lire ses zones a bandes sans le savoir.
CYCLES = [683, 512, 341, 256, 171, 128, 85, 64, 43, 32, 21, 16, 11, 8]
N_FIN = 128     # periode 16 px a W=2048 — la bande que Texture est censee viser
N_MOYEN = 32    # periode 64 px a W=2048 — la bande que Clarte est censee viser

BASE_REF = 128
AMP_ECHELLE = 24
AMPLITUDES = [2, 4, 8, 16, 32, 64]
AMP_TON = 16
BASES = [24, 72, 128, 184, 232]
PLATS = [32, 128, 224]
ECHELONS = [(96, 160), (32, 64), (176, 224)]   # (gauche, droite)

H_BANDE = 48      # hauteur du motif
H_GARDE = 24      # aplat de la base de la bande, au-dessus et en dessous
H_PLAT = 256      # les temoins sont hauts : eux ne sont pas proteges par la
                  # demodulation, puisqu'ils n'ont aucune frequence a demoduler
H_ECHELON = 1024  # une marche doit porter plusieurs rayons de chaque cote, dans
                  # les DEUX directions : c'est ce qui coute cette hauteur-la
H_MESURE = 12     # demi-hauteur des lignes centrales effectivement lues


def bandes():
    """Liste declarative des bandes, dans l'ordre de l'image.

    `cycles` > 0 = sinusoide, 0 = aplat, -1 = marche (gauche/droite)."""
    b = []
    for n in CYCLES:
        b.append({"zone": "echelle", "cycles": n, "base": BASE_REF, "amplitude": AMP_ECHELLE})
    for n in (N_FIN, N_MOYEN):
        for a in AMPLITUDES:
            b.append({"zone": "amplitude", "cycles": n, "base": BASE_REF, "amplitude": a})
    for base in BASES:
        for n in (N_FIN, N_MOYEN):
            b.append({"zone": "ton", "cycles": n, "base": base, "amplitude": AMP_TON})
    for v in PLATS:
        b.append({"zone": "plat", "cycles": 0, "base": v, "amplitude": 0})
    for g, d in ECHELONS:
        b.append({"zone": "echelon", "cycles": -1, "base": g, "amplitude": 0, "droite": d})
    return b


def hauteur_motif(n):
    return H_ECHELON if n < 0 else (H_PLAT if n == 0 else H_BANDE)


def fabrique(largeur):
    liste = bandes()
    hauteur = sum(hauteur_motif(b["cycles"]) + 2 * H_GARDE for b in liste)
    img = np.zeros((hauteur, largeur, 3), dtype=np.uint8)
    x = np.arange(largeur) + 0.5
    y = 0
    geo = []
    for b in liste:
        n, base, amp = b["cycles"], b["base"], b["amplitude"]
        h = hauteur_motif(n)
        # La garde d'une marche est faite des DEUX plateaux, sinon elle poserait
        # un bord horizontal la ou on veut lire un bord vertical.
        garde = np.full((H_GARDE, largeur, 3), base, dtype=np.uint8)
        if n < 0:
            garde[:, largeur // 2:] = b["droite"]
        img[y:y + H_GARDE] = garde
        y += H_GARDE
        if n < 0:
            img[y:y + h, :largeur // 2] = base
            img[y:y + h, largeur // 2:] = b["droite"]
        elif n == 0:
            img[y:y + h] = base
        else:
            v = base + amp * np.sin(2.0 * np.pi * n * x / largeur)
            # Arrondi au niveau entier : c'est ce que le JPEG recevra, et
            # l'analyse relit de toute facon l'entree REELLE dans le fichier.
            ligne = np.clip(np.rint(v), 0, 255).astype(np.uint8)
            img[y:y + h] = ligne[None, :, None]
        c = y + h // 2
        demi = {-1: H_ECHELON // 4, 0: 32}.get(n, H_MESURE)
        e = dict(b)
        e["periode"] = round(largeur / n, 3) if n > 0 else 0
        e["y0"], e["y1"] = int(c - demi), int(c + demi)
        geo.append(e)
        y += h
        img[y:y + H_GARDE] = garde
        y += H_GARDE
    return Image.fromarray(img), {"largeur": largeur, "hauteur": hauteur, "bandes": geo}


def ecris(largeur, suffixe):
    img, geo = fabrique(largeur)
    # La TAILLE est dans le nom, et c'est delibere : Lightroom garde une photo
    # dans son catalogue PAR CHEMIN. Reecrire le meme nom avec une geometrie
    # differente lui ferait ressortir la precedente, et la campagne mesurerait
    # une mire qui n'existe plus. Une geometrie neuve = un nom neuf, une
    # geometrie identique = le meme nom, donc aucun encombrement.
    suffixe = "%s-%dx%d" % (suffixe, largeur, geo["hauteur"])
    jpg = os.path.join(ICI, "shaderlab-mire-presence" + suffixe + ".jpg")
    img.save(jpg, "JPEG", quality=100, subsampling=0)
    js = os.path.join(ICI, "shaderlab-mire-presence" + suffixe + ".json")
    with open(js, "w", encoding="utf-8") as o:
        json.dump(geo, o, indent=1)
    print("ecrit", jpg, img.size)
    return jpg, geo


def controle_jpeg(jpg, geo):
    """Le JPEG doit rendre les amplitudes qu'on a demandees, sinon la mesure
    divise par un nombre faux. On ne SUPPOSE pas que q100 4:4:4 est transparent :
    on relit le fichier et on demodule son entree."""
    a = np.asarray(Image.open(jpg).convert("RGB"), dtype=np.float64)[:, :, 0]
    W = a.shape[1]
    x = np.arange(W) + 0.5
    print("  zone       periode   amp demandee   amp dans le jpeg   ecart %")
    for b in geo["bandes"]:
        if b["cycles"] <= 0:
            continue
        r = a[b["y0"]:b["y1"]].mean(axis=0)
        ph = 2.0 * np.pi * b["cycles"] * x / W
        amp = 2.0 * abs(np.mean(r * np.exp(-1j * ph)))
        ecart = 100.0 * (amp - b["amplitude"]) / b["amplitude"]
        print("  %-10s %7.2f %14d %18.3f %9.2f" % (b["zone"], b["periode"], b["amplitude"], amp, ecart))


if __name__ == "__main__":
    jpg, geo = ecris(2048, "")
    controle_jpeg(jpg, geo)
    ecris(4096, "-2x")
    # Troisieme taille : la MOITIE. Les deux premieres ne separent pas un rayon
    # proportionnel a la racine de l'aire (x1,41) d'un rayon proportionnel a la
    # largeur (x2) — elles ont la meme hauteur. A 1024, les trois lois predisent
    # des largeurs de halo bien distinctes : 220 px si le rayon est absolu,
    # 156 si c'est la racine de l'aire, 110 si c'est la largeur.
    # Ses bandes FINES aliasent (la periode 3 devient 1,5 px, sous Nyquist) et
    # c'est sans consequence : seule sa zone ECHELON est lue.
    ecris(1024, "-demi")
