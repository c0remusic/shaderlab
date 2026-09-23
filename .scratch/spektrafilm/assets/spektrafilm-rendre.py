"""Rend une photo d'Antoine a travers spektrafilm, tel quel (boite noire).

Usage : python rendre.py <photo> <film> <papier|scan> <sortie.png> [echelle] [crop cx cy w h]
  echelle : upscale_factor de spektrafilm (0.3 = image reduite, taille de pixel
            physique corrigee, donc grain et halation a la bonne echelle) ;
  crop    : centre (x, y) et taille (w, h) en fraction du grand cote, a pleine
            resolution — l'echelle physique est calculee sur l'image entiere
            avant la decoupe (runtime/services/resize.py), donc un crop 1:1 est
            fidele.
Entree : JPEG sRGB 8 bits, orientation EXIF respectee. Exposition automatique
COUPEE : on garde l'exposition du photographe.
"""
import sys, time
import numpy as np
from PIL import Image, ImageOps
from spektrafilm import init_params, simulate

photo, film, papier, sortie = sys.argv[1:5]
echelle = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
crop = [float(v) for v in sys.argv[6:10]] if len(sys.argv) > 9 else None

im = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
img = np.asarray(im, dtype=np.float64) / 255.0

params = init_params(film_profile=film, print_profile=("kodak_portra_endura" if papier == "scan" else papier))
params.io.input_color_space = "sRGB"
params.io.input_cctf_decoding = True
params.io.output_color_space = "sRGB"
params.io.output_cctf_encoding = True
params.io.upscale_factor = echelle
params.io.scan_film = papier == "scan"
if crop:
    params.io.crop = True
    params.io.crop_center = (crop[0], crop[1])
    params.io.crop_size = (crop[2], crop[3])
params.camera.auto_exposure = False
params.settings.use_enlarger_lut = True
params.settings.use_scanner_lut = True

t0 = time.time()
out = simulate(img, params)
dt = time.time() - t0
out = np.clip(np.asarray(out, dtype=np.float64), 0, 1)
Image.fromarray(np.round(out * 255).astype(np.uint8)).save(sortie)
print("%s %s %s -> %s  %dx%d  %.1f s" % (photo.split("\\")[-1], film, papier, sortie.split("\\")[-1], out.shape[1], out.shape[0], dt))
