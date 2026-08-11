# Le sort de sat-feather et de la branche canonique

Type: task
Status: claimed
Parent: ../map.md

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

## Ce qui rendrait ce ticket raté

Le clore en disant « rebasé, tests verts » sans qu'Antoine ait tiré un seul
curseur. C'est exactement ce qui s'est passé le 2026-07-24, et c'est pour ça
que ce ticket existe.
