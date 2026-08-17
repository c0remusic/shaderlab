# Le sort de sat-feather et de la branche canonique

Type: task
Status: resolved
Parent: ../map.md

> ✅ **RÉSOLU le 2026-08-13**, statut rectifié le 2026-08-16 — il était resté à
> `claimed` trois jours après la résolution. Antoine a répondu que le lag n'avait
> PAS disparu ; `aee22fb` a été **porté** (pas cherry-piqué) en passe
> `featherSat` (`578d67a`, `src/mask/refinePlan.ts:24,67` — vérifié sur disque le
> 2026-08-16), gain mesuré **48,9 → 143,1 images/s** à protocole identique. La
> branche `origin/sat-feather` ne se merge pas et peut être supprimée.
> ✅ **Elle l'a été le 2026-08-16**, avec six autres branches mortes, chacune
> mesurée avant le geste. Ne plus la citer comme existante.
> Détail dans `docs/ROADMAP.md` § 4.

## Question

`origin/sat-feather` porte **12 commits jamais mergés**, dont du code réel :
`b9e7618 feat(mask): SAT plein résolution pour feather, cache à deux paliers,
allocation paresseuse` — +233/−128 sur `src/mask/refineEdgeWgsl.ts` et
`src/render/maskTextureResolver.ts`.

Le ledger `.superpowers/sdd/progress.md` : « Task 4 du plan (checkpoint
visuel/perf live, 6 combos feather/contract) : **DÉMARRÉE, PAS terminée** [...]
PROCHAINE ÉTAPE : Antoine drague les sliders "Adoucir le bord" /
"Contracter/dilater" lui-même en direct, confirme visuellement + ressenti du
lag. » Daté « je fais les vérifs demain », **2026-07-24** — il y a 18 jours.
Depuis, `master` a pris **393 commits**, dont la refonte Pile/Propriétés/Masque
(`1bd8fde`) qui a réécrit le panneau où vivent ces curseurs.

**Ce travail atterrit-il, ou se jette-t-il ?**

## Partie AFK — à faire AVANT de solliciter Antoine

Rien de ce qui suit ne demande un humain, et sans ces faits la question ne se
pose même pas correctement :

1. **La branche s'applique-t-elle encore ?** `maskTextureResolver.ts` a déjà
   été réécrit par le chantier overlay-guide-source pendant que cette branche
   dormait, et 393 commits ont passé. Rebaser sur `master` dans un **worktree
   séparé** (jamais dans l'arbre courant) et rapporter le nombre réel de
   conflits.
2. **Le gain existe-t-il toujours ?** Le chantier corrigeait une boucle WGSL
   O(rayon) perçue comme lente. Mesurer sur `master` d'aujourd'hui : le défaut
   est-il encore là ? La ligne de base est
   `docs/superpowers/specs/2026-07-30-shaderlab-performance-baseline.md`, dont
   le § P0 rappelle qu'en build de PRODUCTION la lenteur ressentie était le
   surcoût dev-only de React — ne pas mesurer en dev et conclure.
3. **Les gates passent-elles ?** `npx tsc --noEmit`, `npm run test`, puis
   `npm run test:render` — ce dernier est le gate discriminant : la branche
   touche le chemin du masque, donc **zéro écart** attendu, et tout écart est
   un résultat à rapporter, pas à corriger en douce.
4. **Le follow-up nommé.** Le même ledger note que `refine()` (Adoucir le
   bord / Contracter-dilater / Lisser) a « le même défaut architectural
   (boucle O(radius)) [...] Perçu comme lent par Antoine ». Est-il inclus dans
   ces 12 commits, ou reste-t-il dehors ? Deux réponses très différentes pour
   la suite.

## Partie HITL — la liste précise remise à Antoine

Une fois l'AFK fait : préparer l'app par `/run-shaderlab`, avec l'image et les
réglages en place, pour qu'Antoine n'ait qu'à **tirer les deux curseurs et
dire** — pas à piloter. Le protocole du ledger existe déjà : six combinaisons
`(0,0) (25,0) (50,0) (0,25) (0,50) (25,25)` plus l'extrême `(50,50)`.

⚠️ **La règle du dépôt tient** : un banc dit qu'un effet agit, jamais qu'il est
beau — et ici la question EST un ressenti (le lag). Un agent peut capturer et
mesurer ; le verdict reste à Antoine.

## Le second sujet, indissociable

`master` est à **393 commits d'avance** sur `feature/design-system`, qui n'a
**rien** en retour. `docs/adr/0003-master-tracks-feature-design-system.md`
décrit donc l'inverse de la réalité, et `origin/HEAD` pointe toujours sur
`feature/design-system`.

**Quelle branche est canonique ?** La réponse conditionne où `sat-feather`
atterrit s'il atterrit, et rend opposable l'ADR à réécrire. La suppression
mécanique des branches mortes qui suit est une corvée, pas une décision — elle
est en **Out of scope** sur la carte, avec la mesure qui l'instruit.

## Constat AFK du 2026-08-11 — NE PAS MERGER LA BRANCHE

La moitié AFK est faite, par sonde non destructive (`git merge-tree`, aucun
worktree créé, aucune branche touchée). **Le résultat contredit le plan du
ledger**, qui disait « si OK : merger sat-feather ».

**Fusionner la branche telle quelle ferait RÉGRESSER `master`.**

### Ce que la mesure dit

Base de fusion : `5b9536c`, **2026-07-24**. Huit conflits, dont cinq de pure
documentation (bruit de 393 commits) et **trois de code** : `refineEdgeWgsl.ts`,
`maskTextureResolver.ts`, `refineEdgeWgsl.test.ts`.

Des trois commits de code de la branche, **deux sont doublés par `master`, qui
a fait le même travail lui-même et mieux** :

| Commit de la branche | État sur `master` |
| --- | --- |
| `c148d8f` morphologie séparable | **`770b7a8` l'a faite indépendamment**, avec `MORPHOLOGY_PASS_AXES` exporté, un commentaire chiffré (10 201 échantillons à r=50, facteur 50) et un test dédié `test/mask/morphologySeparable.test.ts` |
| `0a33de6` refactor helpers | **dépassé par `6f3aa80`**, qui extrait le plan de passes du refine edge en fonction pure (`src/mask/refinePlan.ts`) |
| `aee22fb` **SAT plein résolution feather** | ⚠️ **TOUJOURS UNIQUE** — 105 lignes de prod + 77 de test, allocation paresseuse et cache à deux paliers. Absent de `master`. |

La branche remplacerait la morphologie séparable exportée et testée de `master`
par une fonction **privée et moins documentée** — c'est ça, la régression.

### Le gain restant, chiffré

Sur `master`, le feather est déjà **deux passes de box filter séparables** (H
puis V, `refinePlan.ts:59-61`), donc `2 × (2r+1)` échantillons par pixel — soit
**202 à r=50**. Le facteur 50 par rapport à la version carrée d'origine est
**déjà acquis**.

Ce qu'ajouterait `aee22fb` est le **second** gain, pas le premier : passer de
`O(rayon)` à `O(1)` par pixel quel que soit le rayon. Réel, mais d'un ordre de
grandeur en dessous de ce qui a déjà été encaissé.

### Ce que ça change pour la moitié HITL

⚠️ **La question à poser à Antoine n'est plus celle du ticket.** Elle était
« ce travail fait-il disparaître le lag ». Elle devient :

> **Le lag que tu ressentais sur « Adoucir le bord » a-t-il déjà disparu sur
> `master` d'aujourd'hui ?**

Parce que `master` a encaissé le facteur 50 sans cette branche. Si le lag est
parti, `aee22fb` n'a plus de justification d'usage et **la branche entière se
supprime** — comme `claude/lucid-vaughan-6f8fc7`. S'il reste, alors on
cherry-picke `aee22fb` SEUL, adapté au `refinePlan.ts` d'aujourd'hui, et on
supprime la branche quand même.

**Dans les deux cas la branche ne se merge pas.** Ce qui reste à trancher est
seulement : un cherry-pick, ou rien.

C'est une question de ressenti au pointeur — un banc ne peut pas y répondre.
Préparer l'app par `/run-shaderlab` sur `master` nu, poser un masque, et
laisser Antoine tirer le curseur de 1 à 50.

## Verdict du 2026-08-13 — CHERRY-PICK, et la mesure en dev disait l'inverse

Antoine a tiré le curseur : **« Adoucir le bord est toujours laggy »**. Mesuré
derrière, et le résultat renverse la conclusion prise le matin même.

### Le renversement, et pourquoi la première mesure mentait

Mesure du matin, en build de DÉVELOPPEMENT : le coût du feather ne montait que
de 45,6 à 52,5 ms par pas entre r≈5 et r≈45, soit **+15 %** — lu comme « le gain
restant est sous le seuil du ressenti ». **Cette lecture était fausse**, et pas
d'un peu : le plancher du build de dev (~45 ms par pas, dominé par `jsxDEV`,
`validateProperty`, `addObjectDiffToProperties` — tous absents en production)
NOYAIT le signal. Un coût réel de 3 ms sur 45 ne fait que +7 % ; le même coût
sur un plancher de 6 ms fait +50 %.

Refaite sur le build de PRODUCTION (`--no-bundle`, `target/release`), photo de
**26 Mpx**, 8 calques, cadence pendant un glissement continu :

| Geste | Cadence |
| --- | --- |
| témoin — Tolérance (bon marché) | **165,3 fps** |
| Adoucir le bord, rayon 0 → 8 | **164,4 fps** |
| Adoucir le bord, rayon 0 → 50 | **48,4 fps** |

**Facteur 3,4 entre petit et grand rayon**, en production, sur le chemin
interactif. C'est la dépendance au rayon que `aee22fb` supprime, et elle est
au-dessus du seuil du ressenti — Antoine l'a d'ailleurs signalée sans voir aucun
chiffre.

### Ce que ça décide

**On cherry-picke `aee22fb` SEUL**, adapté au `refinePlan.ts` d'aujourd'hui, et
on supprime la branche. Les deux autres commits restent écartés pour la raison
mesurée le 2026-08-11 (doublés et mieux faits par `master`) — ce point-là n'a pas
bougé, et la branche ne se merge toujours pas.

### FAIT le 2026-08-13 — porté, mesuré ×2,9, et la branche peut partir

Le commit n'a pas été cherry-pické tel quel : `master` a depuis extrait le plan
de passes en fonction pure (`mask/refinePlan.ts`), que le commit d'origine ne
connaissait pas. Le feather y devient **une** passe `featherSat` au lieu de deux
`boxFilter` — le plan dit QUOI, l'encodeur construit la table et la met en cache.
Toutes les briques SAT existaient déjà sur `master` (`buildSatWidenWgsl`,
`buildSatScanWgsl`, `buildSatLookupWgsl`), donc zéro WGSL importé.

**Gain mesuré à protocole identique** — même build de production, même photo de
26 Mpx, même scène, vrai glissement souris à 125 Hz, l'ancien chemin rebâti
exprès pour servir de témoin :

| Feather | Cadence |
| --- | --- |
| deux box filters (ancien) | **48,9 images/s** |
| table de sommes cumulées + lookup | **143,1 images/s** |

**×2,9.** Le 48,9 recoupe le 48,4 mesuré le matin, ce qui valide rétroactivement
le verdict de ce ticket.

⚠️ **Il a fallu rebâtir l'ancien chemin pour pouvoir le dire.** Les deux chiffres
que j'avais sous la main — 48,4 (sonde synthétique, discréditée depuis) et 175,5
(vrai glissement, mais edge-aware actif) — ne comparaient rien. Un gain ne
s'affirme qu'entre deux mesures dont SEULE la chose testée diffère.

### Un bug latent trouvé au passage, par le garde de reproductibilité

Le cache de pipelines était indexé par `entry:longueur du wgsl`, sans le FORMAT
de la cible. Or un pipeline est compilé pour un format donné : le lookup SAT du
feather (cible `r8unorm`) et celui du filtre guidé (`rg16float`/`rg32float`)
recevaient le même pipeline, le premier arrivé fixant le format. La validation
WebGPU étant asynchrone ici, **rien ne levait** — le rendu devenait simplement
non déterministe. `test:render` l'a vu en constatant que deux exécutions du même
code ne rendaient pas la même image (196 118 canaux sur 196 118), et a refusé de
comparer aux références tant que le protocole était instable. Le format fait
maintenant partie de la clé.

### Les deux risques annoncés, et ce que la mesure en dit

- **Précision.** Une SAT pleine résolution accumule jusqu'à ~26 millions, au-delà
  des 16,7 millions d'entiers exacts d'un `float32`. Vérifié sur la vraie photo à
  rayon 50 : bords propres, **aucune bande ni discontinuité**, et l'écart aux
  anciennes références plafonne à 5 valeurs sur 255 (moyenne 0,002). L'erreur
  relative reste sous le LSB — le risque ne se matérialise pas à cette taille.
- **VRAM.** ~208 Mo de scratch pour deux textures `r32float` pleine taille, d'où
  l'allocation paresseuse (créée au premier `feather > 0`, détruite dès qu'il
  retombe à 0, et au balayage des calques). ⚠️ **Non mesuré** : ni la mémoire
  privée du process WebView2 ni le compteur `GPU Process Memory` ne bougent de
  plus que leur bruit (±3 Mo sur 3,5 Go) alors que la SAT est bel et bien
  construite — sans elle le feather ne rendrait rien. Les deux instruments sont
  donc aveugles à cette allocation, et le coût VRAM reste à confirmer autrement.

### La leçon de méthode, qui vaut au-delà de ce ticket

⚠️ **Une mesure de performance prise en build de développement ne peut pas
conclure à l'ABSENCE d'un coût.** Elle peut prouver qu'un coût existe (le
plancher ne fabrique pas de signal), jamais qu'il est négligeable — le plancher
dev est ~2,6× le plancher prod (15,4 ms contre 6,2 ms de travail synchrone par
événement, mesuré à 8 calques). Le §P0 de
`docs/superpowers/specs/2026-07-30-shaderlab-performance-baseline.md` mettait en
garde ; l'avertissement a été cité dans le rapport du matin **et la conclusion a
été tirée quand même**. Le protocole opposable : toute mesure qui sert à écarter
un travail se refait en production.

## Ce qui rendrait ce ticket raté

Le clore en disant « rebasé, tests verts » sans qu'Antoine ait tiré un seul
curseur. C'est exactement ce qui s'est passé le 2026-07-24, et c'est pour ça
que ce ticket existe.
