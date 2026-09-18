"""OU la reduction de bruit tombe-t-elle dans la chaine de Lightroom ?

Le pre-lissage en passe finale ne recupere pas la discrimination du portail
(1,29 au mieux) alors que retirer le grain de la SOURCE la porte a 6,25. Le grain
de ces JPEG est correle sur plusieurs pixels — demosaicage et blocs JPEG — donc
une petite boite ne le tue pas.

Hypothese a eprouver sur piece : Lightroom debruite AVANT de construire le guide
de Texture, et nous ne debruitons pas du tout. Si l'etage de bruit precede celui
du detail localise, notre portail n'a jamais travaille sur le meme signal que le
leur, et aucun reglage de portail ne rattrapera ca.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")

print("=== fichiers cr_*.cpp de bruit / debruitage ===")
vus = []
for m in re.finditer(r"cr_[A-Za-z0-9_]*(?:noise|denoise|nr)[A-Za-z0-9_]*\.cpp", s, re.I):
    if m.group(0) not in vus:
        vus.append(m.group(0))
for t in vus[:30]:
    print("  " + t)

print("")
print("=== etages cr_stage_* de bruit ===")
vus = []
for m in re.finditer(r"cr_stage_[A-Za-z0-9_]*(?:noise|denoise|nr_|luminance_smooth|wavelet)[A-Za-z0-9_]*", s, re.I):
    if m.group(0) not in vus:
        vus.append(m.group(0))
for t in vus[:40]:
    print("  " + t)

print("")
print("=== le GUIDE de Texture : sur quoi est-il construit ? ===")
vus = []
motif = r"cr_stage_[A-Za-z0-9_]*(?:texture|guide|small_content|smallcontent|downsample|halfsize)[A-Za-z0-9_]*"
for m in re.finditer(motif, s, re.I):
    if m.group(0) not in vus:
        vus.append(m.group(0))
for t in vus[:50]:
    print("  " + t)

print("")
print("=== chaines nommant explicitement une image de contenu reduite ===")
vus = []
for m in re.finditer(r"[A-Za-z_][A-Za-z0-9_]{0,40}(?:SmallContent|smallContent|small_content|ContentImage|contentImage)[A-Za-z0-9_]{0,40}", s):
    if m.group(0) not in vus:
        vus.append(m.group(0))
for t in vus[:40]:
    print("  " + t)
