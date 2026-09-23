"""Lot de rendus spektrafilm pour la planche : 3 photos x 4 stocks, image entiere
reduite (echelle physique corrigee) + un crop 1:1 a pleine resolution.
Les crops de l'ORIGINAL sont decoupes avec la meme geometrie que crop_image.

Usage : python spektrafilm-lot.py <python-du-venv-spektrafilm> <dossier-de-sortie>
Le venv porte spektrafilm (andreavolpato/spektrafilm, installe en editable avec
--no-deps) et ses dependances de coeur, sans l'interface graphique. Les rendus
sont des photos d'Antoine : ils ne vont JAMAIS dans le depot."""
import os, subprocess, sys, time
import numpy as np
from PIL import Image, ImageOps

ICI = os.path.dirname(os.path.abspath(__file__))
PY = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

PHOTOS = {
    # nom : (chemin, centre du crop (x, y), taille en fraction du grand cote)
    "5163-bougie": (r"C:\Users\LEETJ\Pictures\2018\2018-01-25\DSCF5163.JPG", (0.52, 0.86), 0.16),
    "5160-agave": (r"C:\Users\LEETJ\Pictures\2018\2018-01-22\DSCF5160.JPG", (0.40, 0.55), 0.16),
    "5171-lys": (r"C:\Users\LEETJ\Pictures\2018\2018-01-25\DSCF5171.JPG", (0.47, 0.42), 0.16),
}
STOCKS = [
    ("portra400", "kodak_portra_400", "kodak_portra_endura"),
    ("vision3-500t", "kodak_vision3_500t", "kodak_2383"),
    ("ektar100", "kodak_ektar_100", "kodak_endura_premier"),
    ("velvia100", "fujifilm_velvia_100", "scan"),
]
ECHELLE = 0.25


def crop_comme_eux(img, center, size):
    center = np.flip(np.array(center))
    shape = np.array(img.shape[0:2])
    cn = np.round(shape * center)
    sz = np.round(float(np.max(shape)) * np.flip(np.array(size)))
    x0 = np.round(cn - sz / 2).astype(np.int64)
    sz = sz.astype(np.int64)
    x0[x0 < 0] = 0
    for k in range(2):
        if x0[k] + sz[k] > shape[k]:
            x0[k] = shape[k] - sz[k]
    return img[x0[0]:x0[0] + sz[0], x0[1]:x0[1] + sz[1], :]


for nom, (chemin, centre, taille) in PHOTOS.items():
    im = np.asarray(ImageOps.exif_transpose(Image.open(chemin)).convert("RGB"))
    Image.fromarray(crop_comme_eux(im, centre, (taille, taille))).save(os.path.join(OUT, f"{nom}__original__crop.png"))
    petit = Image.fromarray(im)
    petit = petit.resize((round(im.shape[1] * ECHELLE), round(im.shape[0] * ECHELLE)), Image.LANCZOS)
    petit.save(os.path.join(OUT, f"{nom}__original__entier.png"))

t0 = time.time()
for nom, (chemin, centre, taille) in PHOTOS.items():
    for court, film, papier in STOCKS:
        for mode in ("entier", "crop"):
            sortie = os.path.join(OUT, f"{nom}__{court}__{mode}.png")
            if os.path.exists(sortie):
                continue
            args = [PY, os.path.join(ICI, "spektrafilm-rendre.py"), chemin, film, papier, sortie]
            args += [str(ECHELLE)] if mode == "entier" else ["1.0", str(centre[0]), str(centre[1]), str(taille), str(taille)]
            r = subprocess.run(args, capture_output=True, text=True)
            print((r.stdout.strip() or r.stderr.strip()[-600:]), flush=True)
print("lot termine en %.0f s" % (time.time() - t0))
