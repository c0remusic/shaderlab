"""Fabrique les MIRES DE PORTEE — celles qui peuvent contenir la reponse de Clarte.

DEUX DEFAUTS CORRIGES ICI, et le second a ete trouve par la premiere version de
ce fichier, qui les portait tous les deux.

DEFAUT 1 — LE PLATEAU. La mire de presence porte des marches VERTICALES : chaque
plateau fait la moitie de la LARGEUR. Ses deux estimateurs de largeur de halo y
rendent, pour Clarte, environ 0,9 fois le demi-plateau a toutes les tailles
(229 / 452 / 950 px pour des demi-plateaux de 256 / 512 / 1024) — la signature
d'un estimateur SATURE, pas d'une mesure. D'ou une marche HORIZONTALE, dont le
plateau vaut la moitie de la HAUTEUR, qu'on choisit librement.

DEFAUT 2 — LE CONTENU, et il rendait la premiere version INERTE. Une marche
entre deux APLATS ne fait presque rien bouger : mesure du 2026-09-16 sur une
image bi-tonale 96|160, Clarte +100 deborde sur 8 px (77,0 au bord, 94,8 a 8 px)
et le cote clair revient a 160,000 EXACTEMENT. Sur la mire de presence, au meme
echelon 96|160, elle devie encore de 11 niveaux a 900 px du bord. Meme operateur,
meme marche, meme dose : ce qui change est ce qu'il y a AUTOUR.

Le binaire l'avait nomme — `cr_stage_localized_detail_clarity_mask`, a cote de
`cr_stage_localized_detail_clarity_blur`. Clarte est PORTEE PAR UN MASQUE DE
DETAIL : sans detail alentour, elle ne fait rien, quel que soit son rayon. Un
aplat ne peut donc pas servir de plateau pour mesurer sa portee — il l'eteint.

D'ou les deux zones ci-dessous, chacune une marche horizontale a plateaux de
4096 px, et chacune une question :

  ZONE PORTEE — reseau fin autour de 96 en haut, reseau fin autour de 160 en bas.
    Du detail des deux cotes, donc l'operateur est ACTIF partout, et la marche
    porte sur la moyenne LOCALE. La decroissance du halo dans un plateau de
    4096 px donne enfin le rayon du masque, sans saturation.

  ZONE PORTAIL — aplat 128 en haut, reseau fin autour de 128 en bas. Meme
    moyenne des deux cotes : il n'y a PAS de marche de ton, seulement une marche
    de DETAIL. Ce qui bouge dans la moitie plate est donc entierement du au
    portail, et la distance a laquelle ca s'eteint EST sa portee. C'est aussi le
    seul endroit ou un terme GLOBAL peut se lire proprement : loin de la
    frontiere, la moitie plate vaut 128 et rien d'autre.

Le reseau est vertical (il varie selon x) et le profil se prend selon y, moyenne
sur les colonnes : le reseau disparait de la moyenne et le profil ne porte que la
reponse a la marche. Periode 8 px, amplitude 24 — dans la bande ou Texture et
Clarte repondent toutes les deux fort.

Usage : python faire-mire-portee.py
Sortie : shaderlab-mire-portee-<L>x<H>.jpg + .json, a poser dans
C:/Users/LEETJ/Pictures/shaderlab-mire/.
"""
import json
import os

import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))

BAS_TON, HAUT_TON = 96, 160   # memes niveaux que l'echelon 96|160 de la presence
PLAT = 128
PERIODE = 8
AMPLITUDE = 24
DEMI = 4096                   # hauteur d'un plateau par defaut
# Les deux dernieres entrees ont la meme LARGEUR que la deuxieme et des plateaux
# de moitie puis de quart : hauteurs 16384, 8192 et 4096, soit un RAPPORT DE 4
# entre les extremes. C'est la question du rayon, posee a un instrument qui ne
# sature plus. Si la reponse de Clarte est en pixels absolus, son profil est le
# meme aux memes DISTANCES ; si elle suit la hauteur, il est le meme aux memes
# FRACTIONS de plateau. Un rapport de 2 laissait les deux lois a 0,2 et 0,6
# niveau l'une de l'autre — trop serre pour trancher ; a 4, elles s'ecartent
# assez pour que le desaccord sorte du bruit.
TAILLES = [(1024, 4 * DEMI, DEMI), (2048, 4 * DEMI, DEMI),
           (4096, 4 * DEMI, DEMI), (2048, 2 * DEMI, DEMI // 2),
           (2048, DEMI, DEMI // 4),
           # Meme PLATEAU que la precedente (1024 px) mais une image huit fois
           # plus LARGE : la hauteur y est le petit cote, alors qu'elle etait le
           # grand dans toutes les autres. Elle separe « proportionnel a la
           # hauteur » de « proportionnel au GRAND COTE », que rien d'autre ici
           # ne distingue.
           (8 * 2048, DEMI, DEMI // 4)]


def reseau(largeur, base):
    x = np.arange(largeur) + 0.5
    v = base + AMPLITUDE * np.sin(2.0 * np.pi * x / PERIODE)
    return np.clip(np.rint(v), 0, 255).astype(np.uint8)


def ecris(largeur, hauteur, DEMI=DEMI):
    img = np.zeros((hauteur, largeur, 3), dtype=np.uint8)
    img[0 * DEMI:1 * DEMI] = reseau(largeur, BAS_TON)[None, :, None]
    img[1 * DEMI:2 * DEMI] = reseau(largeur, HAUT_TON)[None, :, None]
    img[2 * DEMI:3 * DEMI] = PLAT
    img[3 * DEMI:4 * DEMI] = reseau(largeur, PLAT)[None, :, None]
    nom = "shaderlab-mire-portee-%dx%d" % (largeur, hauteur)
    jpg = os.path.join(ICI, nom + ".jpg")
    Image.fromarray(img).save(jpg, "JPEG", quality=100, subsampling=0)
    geo = {
        "largeur": largeur, "hauteur": hauteur, "demi": DEMI,
        "periode": PERIODE, "amplitude": AMPLITUDE,
        # Le profil se prend sur la moitie CENTRALE des colonnes : les tranches
        # gauche et droite portent le traitement de bord de Lightroom.
        "x0": largeur // 4, "x1": 3 * largeur // 4,
        "zones": [
            {"nom": "portee", "y0": 0, "y1": 2 * DEMI, "haut": BAS_TON, "bas": HAUT_TON,
             "detail_haut": True, "detail_bas": True},
            {"nom": "portail", "y0": 2 * DEMI, "y1": 4 * DEMI, "haut": PLAT, "bas": PLAT,
             "detail_haut": False, "detail_bas": True},
        ],
    }
    with open(os.path.join(ICI, nom + ".json"), "w", encoding="utf-8") as o:
        json.dump(geo, o, indent=1)
    print("ecrit", jpg, (largeur, hauteur))


if __name__ == "__main__":
    for l, h, d in TAILLES:
        ecris(l, h, d)
