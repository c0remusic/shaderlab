"""Les titres de BREVETS cites dans CameraRaw.dll — ils nomment les mecanismes.

Trouve en minant cr_split_tone : le binaire porte, en clair et a cote de
cr_stage_SplitTone, la ligne

  Adobe patent application tracking B220 entitled
  « Color toning while maintaining constant luminance using color curve slopes »
  inventors Mark Hamburg

C'est la source la plus directe qu'on ait jamais eue sur la FORME d'un operateur
de ce dossier : un titre de brevet dit ce que l'operateur FAIT, pas ce qu'on en
deduit. Ce script sort TOUS ces marqueurs, avec l'etage auquel chacun est
accole.

⚠️ CE QU'UN TITRE NE DIT PAS. Il nomme un mecanisme, il ne donne aucune
amplitude, et il peut couvrir une partie seulement de l'etage ou il est cite.
Consigne permanente : le binaire donne la FORME, les mesures donnent les
AMPLITUDES.

⚠️ ET UN CONTROLE DE SOUS-CHAINE NE VAUT RIEN ICI. Chercher « lab » au ras de
cr_split_tone rend 8 fenetres sur 8 — parce que « scalable » contient « lab »
(cr_memory_scalable_allocator). Le premier balayage d'espaces de ce minage est
donc JETE : il mesurait l'allocateur memoire. Les motifs ci-dessous sont bornes.
"""
import re

DLL = r"C:\Program Files\Adobe\Adobe Lightroom Classic\CameraRaw.dll"
with open(DLL, "rb") as f:
    s = f.read().decode("latin-1")

# Le marqueur exact repere dans le binaire. On le cherche tel quel, puis on
# ramasse le titre entre « entitled » et « inventors ».
print("=== TOUS LES BREVETS CITES ===")
brevets = []
for m in re.finditer(r"patent application tracking\s*#?\s*([A-Za-z0-9]+)\s*,?\s*entitled\s+", s):
    suite = s[m.end():m.end() + 400]
    fin = re.search(r"\s+inventors?\s+", suite)
    titre = (suite[:fin.start()] if fin else suite[:160]).strip()
    auteurs = ""
    if fin:
        apres = suite[fin.end():fin.end() + 160]
        auteurs = re.split(r"[^A-Za-z .,'-]", apres)[0].strip()
    brevets.append((m.group(1), titre, auteurs, m.start()))

print("  %d marqueur(s)" % len(brevets))
for code, titre, auteurs, pos in brevets:
    print("")
    print("  [%s] @%d" % (code, pos))
    print("      titre    : %s" % titre)
    print("      inventeurs : %s" % auteurs)
    # L'etage auquel le marqueur est accole : le premier cr_stage_* apres lui.
    apres = s[pos:pos + 3000]
    stages = []
    for x in re.findall(r"cr_stage_[A-Za-z0-9_]{3,50}", apres):
        if x not in stages:
            stages.append(x)
    print("      etages proches : %s" % (", ".join(stages[:6]) if stages else "aucun"))

# Meme chose pour les autres formulations possibles.
print("")
print("=== AUTRES FORMULATIONS ===")
for motif in (r"patent[^\x00]{0,60}entitled", r"US Patent[^\x00]{0,80}",
              r"entitled\s+[A-Z][^\x00]{10,120}"):
    trouve = sorted(set(re.findall(motif, s)))
    print("  %-34s -> %d" % (motif[:32], len(trouve)))
    for t in trouve[:12]:
        print("      " + t.strip()[:150])
