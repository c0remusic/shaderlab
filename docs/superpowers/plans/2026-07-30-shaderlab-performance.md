# Plan performance — shaderlab, 2026-07-30

Référence de mesure : `docs/superpowers/specs/2026-07-30-shaderlab-performance-baseline.md`.
Ce plan ne réénonce pas les chiffres, il les consomme. Tout gain se juge contre
cette ligne de base, avec le même instrument.

## Règle d'exécution (boucle de review)

Chaque tranche passe par TROIS temps, dans cet ordre, et ne se déclare finie
qu'au bout :

1. **Mesurer avant** — sur le code de départ de la tranche, avec le protocole de
   la ligne de base. Une tranche qui ne peut pas mesurer son avant ne peut pas
   prouver son après.
2. **Implémenter** — en worktree isolé, un seul sujet par tranche.
3. **Review adverse + mesurer après** — un agent qui n'a pas écrit le code
   relit le diff ET **rejoue les commandes lui-même**. Un écart entre chiffre
   déclaré et chiffre re-mesuré est bloquant.

**Critères permanents, à chaque tranche, sans exception :**
- `npm run test` · `npx tsc --noEmit` · `npm run lint:tokens`
- `npm run test:render` **avec témoin planté** : une constante modifiée dans un
  shader du chemin touché doit faire ROUGIR le scénario concerné, puis être
  retirée. Sans ce témoin, « aucune régression » ne prouve pas que le harnais
  lit le bon code (piège du Vite d'un autre worktree, vécu deux fois).
- `npm run test:gpu-shaders` si un WGSL est touché.
- Tout chiffre annoncé vient d'une sortie collée.

**Condition de sortie de la boucle** (posée le 2026-07-30) : temps de frame
médian < 16,7 ms et p95 < 33 ms en geste interactif à 5 calques photo, sans
régression de rendu. ⚠️ La ligne de base GPU passe déjà cette cible (6,82 / 9,11
ms) : **c'est le CPU qui décide** (20,4 ms/événement après les trois premières
corrections, contre 34,2 au départ).

**Interdits permanents** (rappel `CLAUDE.md`) : aucune distinction
aperçu/export, aucun downscale, aucune dégradation de qualité de rendu. Une
tranche qui aurait besoin de ça s'arrête et remonte la question.

---

## P0 — Mesurer en build de PRODUCTION (aucun code modifié)

**Pourquoi en premier** : toute la ligne de base est mesurée sur le serveur de
dev. Les fonctions dev-only de React (`jsxDEV`, `createElement` de développement)
et le **double rendu de `StrictMode`** pèsent 20 à 30 % du JS actif — c'est
exactement l'écart qui reste à combler (20,4 mesuré contre 16,7 visé).
**Il est possible que la cible soit déjà atteinte en production**, auquel cas les
tranches suivantes optimiseraient dans le vide.

**Fait =** les trois gestes de §2.2 mesurés sur un build de production servi
localement, comparés au dev, même protocole, même machine, même session.
**Difficulté nommée** : `Profiler.startPreciseCoverage` donne des noms de
fonction minifiés — le comptage de rendus par composant sera dégradé ou
impossible. Le temps CPU par événement et les tâches longues, eux, restent
mesurables et suffisent à trancher.
**Sortie possible de la boucle** : si la cible est tenue en production, la boucle
s'arrête ici et les tranches P1-P5 deviennent du confort, à rouvrir seulement si
Antoine ressent encore la lenteur.

## P1 — La morphologie de masque cesse d'être invalidée par le guide

**Hypothèse LUE, jamais mesurée** (baseline §4) : `maskTextureResolver.ts:259-263`
incrémente la révision dès que le `guideEpoch` change ; or `refine()` (`:922-929`)
ne consomme pas le guide — seul `edge()` le fait (`:671`), et seulement si
`edgeAware && edgeStrength > 0`, dont le défaut est `false`.

**Mesurer d'abord, et accepter la réfutation.** Le test qui tranche : 5 calques,
un calque du haut à `feather > 0` et `edgeAware = false`, drag d'un curseur sur un
calque du bas ; compter les exécutions de `refine()` par frame. Ce test **n'a
jamais pu être monté** (pilotage CDP du panneau Masque non fiable) — le monter
est la moitié du travail de cette tranche. Si le compte est déjà à 0, l'hypothèse
tombe et la tranche se ferme sans code.
**Fait =** compte prouvé passé de N à 0, ou hypothèse réfutée par écrit.
**Taille attendue** : trois lignes. **Effet sur le code : simplifie** (la clé de
cache devient honnête sur sa dépendance au lieu d'être conservatrice).

## P2 — La pré-passe photo n'est produite que si elle sert

**Mesuré** (baseline §3.3) : en bougeant un curseur de grain, aucune photo ne
bougeant, 74 % du temps de frame part à redessiner des calques photo inchangés,
dont 29 % de pure re-projection.

⚠️ **Mettre en cache le RÉSULTAT est explicitement interdit** — la cible est
unique et partagée par tous les calques photo d'une frame, et c'est l'ORDRE des
passes qui rend ce partage correct (`photoLayerInput.ts:88-105`, invariant tenu
par un test). La voie n'est pas de mémoriser cette passe mais de **ne pas la
produire** : elle n'est nécessaire que si la photo doit exister comme texture
(effet à passes multiples, ou masque edge-aware actif). Sinon, échantillonner la
photo transformée directement dans la passe de composite (`shaderCompose.ts`
sait déjà produire `effectInput` depuis un binding dédié).
**Bénéfice secondaire, qui vaut le détour** : le chemin nominal cesse de dépendre
de l'invariant d'ordre des passes le plus dangereux du projet.

⚠️ **Le gain dépend de ce que l'utilisateur empile, et la tranche doit mesurer LES
DEUX régimes.** Direction produit rappelée par Antoine le 2026-07-30 : on veut des
effets **par photo** (attachement par proximité, ADR-0005). Or **un seul effet du
registre est à passes multiples — le glow** (vérifié : `grep -l "passes:"
src/render/effects/*.ts` → `glow.ts` seul, sur 11 effets). Donc :
- photo sans effet, ou avec un effet à passe unique → la passe d'effet EST la
  passe de composite, la pré-passe disparaît : **2 passes → 1 par photo** ;
- photo portant un glow, ou un masque edge-aware actif → la pré-passe reste
  nécessaire, régime inchangé.
Mesurer une pile « une photo = un effet simple » ET une pile « une photo = un
glow ». Annoncer un gain moyen sur la seule pile favorable serait un chiffre vrai
et trompeur.
**Fait =** passes par frame passées de `2N+1` à `N+1` **dans le régime à effets
simples**, régime glow mesuré et annoncé séparément, temps de frame re-mesuré,
rendu identique au pixel (`test:render` avec témoin).

## P3 — Cache de préfixe : la chaîne repart du dernier calque inchangé

**Mesuré** (baseline §3.2) : bouger un curseur sur le calque du haut coûte
exactement autant que sur celui du bas (9,90 contre 10,42 ms) — la boucle repart
toujours de la toile.
**L'information d'invalidation existe déjà** : `computeGuideEpochs`
(`framePipelineExecutor.ts:236-250`) calcule à partir de quelle position la
chaîne a divergé, et ne sert qu'au cache SAT.

⚠️ **Deux points durs, à traiter et non à découvrir en route :**
- Le point de coupe ne doit **jamais** tomber entre une base photo et les calques
  écrêtés qui la consomment — la couverture est retenue d'itération en itération
  (`framePipelineExecutor.ts:358, 438-448`) et n'est pas reconstructible depuis
  un composite.
- **+1 texture pleine toile en VRAM.** Le pire cas mesuré est déjà à ~84 % (T3,
  2026-07-30). Cette tranche **doit re-mesurer la VRAM** au protocole de
  `2026-07-28-shaderlab-fond-comme-calque-design.md` §4.5, et **renoncer** si le
  pire cas franchit le seuil. Le gain de temps ne rachète pas un `device.lost`.
**Fait =** écart mesuré entre calque du haut et calque du bas, VRAM re-mesurée
sous le seuil, rendu identique au pixel.

## P4 — Téléversement incrémental du masque

**Mesuré** (baseline §3.5) : pendant la peinture, le raster complet est
retéléversé à chaque frame — 24,76 Mo/frame, ~3,1 Go/s, **~93 % d'occupation**.
C'est le SEUL chemin mesuré où l'app est réellement saturée.
Téléverser la région touchée par le trait au lieu du raster entier.
⚠️ Le temps GPU de ce transfert n'est **pas** mesuré aujourd'hui (une copie n'est
pas une passe, elle n'apparaît pas dans les timestamps) : cette tranche doit
d'abord se donner un instrument, sinon elle ne pourra pas prouver son gain.
**Lien avec l'anomalie non expliquée de §2.3** — +477 Mo de mémoire native pendant
une session de peinture, dont un GC forcé ne rend que 82 : à instruire ici, c'est
le même chemin.

## P5 — Nettoyages secondaires (gain faible, risque quasi nul)

À ne faire que si la cible n'est pas tenue après P0-P4, ou en remplissage.
- Uniformes persistants au lieu de créés/détruits par passe
  (`effectPassRunner.ts:166,181`) — le patron existe déjà (`:65-69`, `timeBuffer`).
- Clé de cache de pipeline courte au lieu de la source WGSL entière
  (`:177, 186` ; `shaderCompose.ts:76-185`).
- Vignette d'import hors du fil principal (`convertToBlob`, ~99 ms).

---

## Ce qu'on ne fera PAS dans cette boucle

- **Découper `maskTextureResolver.ts`** (1023 l). Interface étroite et légitime :
  ce n'est pas un module shallow. Seule l'extraction du filtre guidé gagnerait du
  temps, et seulement si P1 la rend nécessaire.
- **Toucher à ce que la ligne de base §5 liste comme propre** — le coalescing rAF
  du rendu, le coalescing du pinceau, la granularité des epochs, les caches par
  identité, l'overlay qui rejoue `lastOverlayFrame`, `PresentPass` écrivain
  unique, `PhotoSourceStore` point unique d'allocation.
- **Adopter l'aperçu à résolution réduite** (Capture One, Krita, Lightroom le
  documentent ; Photoshop, contrairement à ce que j'avais affirmé, ne le documente
  pas). Ça se paierait en fidélité de l'aperçu, ce que le projet a explicitement
  refusé. À ne rouvrir qu'avec un chiffre : « il manque X ms, les voilà ».

## Ordre et parallélisation

Séquentiel : **P0 → P1 → P2 → P3 → P4 → P5**, une tranche à la fois.
Raison assumée : toutes ces tranches se mesurent sur LA MÊME fenêtre, et deux
agents qui mesurent en parallèle se perturbent — trois mesures ont dû être jetées
le 2026-07-30 pour cette raison exacte. La parallélisation coûterait plus en
mesures invalides qu'elle ne gagnerait en temps.
