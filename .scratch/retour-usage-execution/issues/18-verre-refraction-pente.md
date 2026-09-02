# 18: Réfraction portée par la pente, concentrée aux bords (verre Poli)

**What to build:** La réfraction du Poli cesse d'être étalée uniformément. Un
panneau de verre plat mince ne plie quasi rien au centre (deux faces parallèles
annulent la déviation) — la plier partout participe au look « artificiel ». Elle
devient **portée par le champ de pente** que le matériau calcule déjà, forte là où
la pente est forte (bords, relief), quasi nulle au centre plat. Le centre montre
alors la photo quasi intacte, comportement d'un vrai verre plat.

**Blocked by:** None — le 17 est livré ET jugé (grilling du 2026-08-27, matcap gardé). « Une seule évolution du chemin glass.ts à la fois » reste la règle.

**Status:** ready-for-human — **REQUALIFIÉ le 2026-08-27, aucune ligne de code : la
prémisse était fausse, les vraies causes sont mesurées, le choix est à Antoine.**

## Le constat (port CPU du chemin réel, deuxième ticket fantôme de la chaîne)

**La réfraction est DÉJÀ portée par la pente, et strictement nulle à plat** —
`glass.ts:755-768` : `T = refract(I, N, eta)` avec `N = (0,0,1)` rend
exactement `(0,0,-1)`, déplacement nul (vérifié algébriquement ET par port
CPU). Le modèle « panneau mince à deux faces » ne changerait RIEN là où le
ticket le demande : ≤ 0,022 % d'écart sur toute la course du Poli, et ses
seuls écarts réels (5-10 %) seraient sur les cannelures — que le ticket ne
vise pas. Coder l'énoncé aurait déplacé 13 références pour un changement
invisible. (Après le 16 : deuxième prémisse de la même recherche démentie
par le shader — les prémisses du 19 sont à vérifier pareil avant de coder.)

## Ce qui rend RÉELLEMENT le centre du Poli non intact — deux leviers mesurés

1. **Le micro-relief `grain` entre dans la NORMALE de réfraction** : à défauts,
   il déplace la lecture d'environ UN PIXEL ENTIER d'un pixel au suivant
   (variation voisine 0,9992 px/px contre 0,0014 pour l'ondulation — rapport
   711×). Ce n'est pas une réfraction, c'est un rééchantillonnage aléatoire —
   et le commentaire du Dépoli du MÊME fichier (`:703-709`) interdit
   précisément ça : une rugosité sous-pixel doit devenir un étalement lisse,
   jamais une structure. Levier : le micro-relief alimente l'ÉTALEMENT (`f`)
   au lieu de la normale. Touche les 9 matières.
2. **Le terme constant de la diffusion** (`:773`, `f = diffusion*0.25 +
   length(d)*0.10`) : au défaut 0,08, un rayon de 126 px PARTOUT, porté à
   98,8 % par la constante (1,2 % par la pente), qui pousse le LOD au mip 2
   plein cadre. C'est LUI, « l'étalement uniforme ». Levier : porter ce terme
   par la pente, et/ou revoir le défaut.

**Les deux leviers se jugent sur planche avant/après** (même méthode que le
matcap) — prototypes au site, rendus réels, verdict d'Antoine, puis la
tranche codée proprement avec les 13 références régénérées.

- [ ] La réfraction est concentrée où la pente est forte, ~nulle au centre plat.
- [ ] Le centre d'un panneau plat montre la photo quasi intacte (déviation nette faible).
- [ ] Les 18 références régénérées et **relues à l'œil** ; jugé devant photo par Antoine.
