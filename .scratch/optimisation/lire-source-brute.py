"""Extrait le texte BRUT de la page d'optimisation, sans resumeur.

⚠️ Raison d'etre : WebFetch passe par un petit modele qui RESUME, et il tronque
et hallucine sur les tables et les listes longues. Un tableau de techniques et de
gains chiffres est exactement ce qu'il rate. On lit le HTML.
"""
import html
import re
import sys

SP = r"C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad"
s = open(SP + "/opti.html", encoding="utf-8").read()

# Le corps de l'article seulement.
m = re.search(r'<div class="lesson-main">(.*)', s, re.S)
if m:
    s = m.group(1)
s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
# Garder la structure : titres et paragraphes deviennent des lignes.
s = re.sub(r"<h([1-6])[^>]*>", lambda m: "\n\n### ", s)
s = re.sub(r"</h[1-6]>", "\n", s)
s = re.sub(r"<(p|li|tr|div|br)[^>]*>", "\n", s)
s = re.sub(r"<[^>]+>", " ", s)
s = html.unescape(s)
s = re.sub(r"[ \t]+", " ", s)
s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
lignes = [l.strip() for l in s.split("\n")]

mode = sys.argv[1] if len(sys.argv) > 1 else "titres"
if mode == "titres":
    for l in lignes:
        if l.startswith("###"):
            print(l)
elif mode == "chiffres":
    # Toute ligne qui porte un pourcentage, un facteur ou un nombre d'objets.
    motif = re.compile(r"\d+\s*%|\d+x\b|\btimes faster|fps|\bms\b|\d{3,}")
    for l in lignes:
        if len(l) > 25 and motif.search(l):
            print("-", l[:300])
else:
    print("\n".join(l for l in lignes if l))
