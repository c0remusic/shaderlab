# Arme la campagne A : extrait son bloc de `listes-de-mesures.md` et pose les deux
# sentinelles dans Documents/.
#
# LE BLOC N'EST PAS RETAPE. Il est extrait du depot par ancres, donc ce qui est
# arme est exactement ce qui est versionne — et les TABULATIONS survivent, ce qui
# est le seul point de fragilite du format.
#
# ⚠️ LF PUR, PAS CRLF. Le parseur du plugin lit les valeurs en `([%w]+)=([^;]+)` :
# la derniere paire de chaque ligne capture jusqu'a la fin de ligne, donc un `\r`
# y entrerait et `tonumber("-100\r")` rendrait nil. La campagne perdrait
# silencieusement une cle par ligne — et c'est SplitToningBalance=-100, la cle que
# toute la revision d'aujourd'hui ajoute.
#
# CONTROLE AVANT DE POSER : le parseur Lua est SIMULE ici, ligne par ligne. Une
# course de Lightroom coute un redemarrage et une quinzaine de minutes ; une
# erreur de format ne doit pas se decouvrir la-bas.
import io
import os
import re

DEPOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "listes-de-mesures.md")
DOCS = os.path.join(os.path.expanduser("~"), "Documents")
MIRE = "C:\\Users\\LEETJ\\Pictures\\shaderlab-mire\\shaderlab-mire-lightroom.jpg"

s = io.open(DEPOT, encoding="utf-8").read()

debut = "temoin4\t\n"
fin = "temperature-m50\tIncrementalTemperature=-50\n"
assert s.count(debut) == 1, "ancre de debut absente ou non unique"
i = s.index(debut)
assert s.count(fin) == 1, "ancre de fin absente ou non unique"
j = s.index(fin, i) + len(fin)
bloc = s[i:j]

lignes = bloc.split("\n")
if lignes and lignes[-1] == "":
    lignes.pop()

# ── SIMULATION DU PARSEUR LUA ───────────────────────────────────────────────
# Lua : ligne:match("^([%w%-%_]+)\t(.*)$") puis reste:gmatch("([%w]+)=([^;]+)")
MOTIF_LIGNE = re.compile(r"^([0-9A-Za-z\-_]+)\t(.*)$")
MOTIF_PAIRE = re.compile(r"([0-9A-Za-z]+)=([^;]+)")

echecs = []
total_cles = 0
for n, ligne in enumerate(lignes, 1):
    if "\r" in ligne:
        echecs.append("ligne %d : porte un retour chariot" % n)
        continue
    m = MOTIF_LIGNE.match(ligne)
    if not m:
        echecs.append("ligne %d : le parseur l'IGNORERAIT — %r" % (n, ligne[:60]))
        continue
    nom, reste = m.group(1), m.group(2)
    paires = MOTIF_PAIRE.findall(reste)
    if reste.strip() and not paires:
        echecs.append("ligne %d (%s) : des reglages mais aucune paire lue" % (n, nom))
        continue
    for cle, val in paires:
        total_cles += 1
        try:
            float(val)
        except ValueError:
            if val not in ("true", "false"):
                echecs.append("ligne %d (%s) : %s=%r n'est pas un nombre" % (n, nom, cle, val))

print("bloc extrait : %d lignes, %d cles" % (len(lignes), total_cles))
noms = [MOTIF_LIGNE.match(l).group(1) for l in lignes if MOTIF_LIGNE.match(l)]
print("noms : %s" % ", ".join(noms))
teintes = [n for n in noms if n.startswith("st-h")]
globales = [n for n in noms if n.startswith("cg-glob")]
print("teintes : %d   controles de roue : %d" % (len(teintes), len(globales)))

balances = sum(1 for l in lignes if "SplitToningBalance=-100" in l)
print("lignes portant SplitToningBalance=-100 : %d" % balances)

if echecs:
    print("")
    print("REFUS — le parseur echouerait :")
    for e in echecs:
        print("  " + e)
    raise SystemExit(1)

assert len(teintes) == 11, "attendu 11 teintes, vu %d" % len(teintes)
assert len(globales) == 2, "attendu 2 controles de roue, vu %d" % len(globales)
assert balances == 11 + 2, "attendu 13 lignes a Balance -100, vu %d" % balances
assert os.path.exists(MIRE), "mire absente : %s" % MIRE

# ── ECRITURE ────────────────────────────────────────────────────────────────
extra = os.path.join(DOCS, "shaderlab-mesures-extra.txt")
go = os.path.join(DOCS, "shaderlab-mesures-go.txt")
io.open(extra, "w", encoding="utf-8", newline="").write("\n".join(lignes) + "\n")
io.open(go, "w", encoding="utf-8", newline="").write(MIRE + "\n")

# ── RELECTURE DE CE QUI EST SUR DISQUE, pas de ce qu'on croit avoir ecrit ───
relu = io.open(extra, encoding="utf-8", newline="").read()
assert "\r" not in relu, "un retour chariot a survecu a l'ecriture"
assert len(relu.split("\n")) - 1 == len(lignes), "compte de lignes relu different"
print("")
print("ARMEE. %s (%d lignes) et %s" % (extra, len(lignes), go))
print("mire : %s" % MIRE)
