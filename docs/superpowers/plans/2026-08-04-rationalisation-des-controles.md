# Rationalisation des contrôles — plan d'implémentation

> Cadrage : `docs/ROADMAP.md` §2. Pas de document de design séparé — le cadrage
> y est acquis, c'est le plan qui manquait.
>
> Portée : les **21 effets** du registre. Trois exigences fermes —
> applicabilité conditionnelle, fusion, ordre par catégories.

## 1. Ce que la mesure dit, au 2026-08-04

Mesuré à l'exécution sur `effectRegistry` (module instancié), pas au `grep` sur
les fichiers source.

| Fait | Valeur |
| --- | --- |
| Paramètres portant « Sans objet » en infobulle | **39**, sur **9 effets** |
| Répartition | `glass` 15 · `outlines` 11 · `lensDistortion` 3 · `lensFlare` 2 · `lensBlur` 2 · `motionBlur` 2 · `hatching` 2 · `warp` 1 · `gradientMap` 1 |
| Paramètres à `choices` (listes de modes/matières) | **20** |
| Effets les plus chargés | `curves` 37 · `lensFlare` 30 · `outlines` 26 · `glass` 22 · `channelMixer` 22 |

⚠️ **Le `grep` comptait 16 pour `glass` là où le registre en donne 15** — la
seizième occurrence est dans un commentaire. Écart minuscule, mais c'est le même
piège que partout ailleurs dans ce dépôt : compter la source, c'est mesurer un
proxy. Toute recette de ce plan se mesure sur les modules instanciés.

### Trois constats qui contraignent la forme du contrat

1. **Deux conditions sur 39 ne sont PAS discrètes.** `lensFlare.sensorSpacing`
   (« Sans objet à quadrillage nul ») et `lensBlur.bladeRotation` (« Sans objet
   sur un diaphragme circulaire ») dépendent d'une valeur **continue**, pas d'un
   index de choix. Un contrat purement `{param, equals}` ne les couvre pas.
2. **Les conditions s'ENCHAÎNENT.** `glass.profile`, `glass.orientation` et
   `outlines.inkMode` sont eux-mêmes des paramètres à `choices` **et** portent
   « Sans objet ». Un contrôle masqué peut donc être celui dont dépend un autre
   contrôle : il faut évaluer sur les paramètres résolus, jamais sur ce qui est
   affiché.
3. **`glass.flat` n'est pas un cas d'applicabilité mais de FUSION.** Son
   infobulle dit « En Aluminium brossé, ce curseur règle au contraire la
   profondeur du BROSSAGE. Sans objet ailleurs » — le contrôle ne disparaît pas,
   il **change de sens**. Le masquer serait faux ; c'est son libellé qui est
   conditionnel. À traiter en exigence 2, pas en exigence 1.

## 2. Le contrat, et ses trois précédents

Chaque paramètre déclare sa catégorie et son applicabilité **dans son module
d'effet** ; `ParamPanel` interprète, uniformément. Aucun `if (effectId)` dans
React — la frontière d'`ARCHITECTURE.md` (« `components/` ne contient aucune
logique métier ») tient.

Le patron existe **trois** fois dans le dépôt, et non deux comme le dit la
feuille de route :

| Précédent | Forme | Validé statiquement ? |
| --- | --- | --- |
| `EffectPass.enabled` | prédicat `(params) => boolean` | non (fonction opaque) |
| `EffectParam.maxFrom` | prédicat `(params) => number` | partiellement (`validateEffect` l'éprouve sur les défauts) |
| **`CanvasControl.visibleWhen`** | déclaratif `{param, equals}` | **oui** — `validate.ts:94` exige que la cible soit un paramètre à `choices` et que les index existent |

Le troisième est le plus proche : il fait déjà « masquer un contrôle selon la
valeur d'un autre paramètre », mais seulement pour les contrôles posés sur
l'image. **Ce chantier est d'abord une généralisation de `visibleWhen` à
`EffectParam`**, pas une invention.

### Arbitrage TRANCHÉ le 2026-08-04 — déclaratif seul (voie A)

37 conditions sur 39 sont déclaratives ; 2 ne le sont pas. Deux voies étaient
ouvertes, et elles ne coûtaient pas la même chose :

- **A — déclaratif seul.** `appliesWhen?: { param, equals }`, réutilisant
  mot pour mot `CanvasControlVisibility` et sa validation existante. Les deux
  cas continus deviennent des paramètres à `choices` (« Diaphragme : circulaire
  / à lames », « Quadrillage capteur : absent / présent »). Contrat homogène et
  entièrement vérifié au chargement — mais **change deux effets** et donc leurs
  références de pixels.
- **B — déclaratif + échappatoire prédicat.** On ajoute une variante
  `(params) => boolean` pour les deux irréguliers. Aucun effet ne bouge, aucune
  référence à régénérer — mais deux applicabilités échappent définitivement à
  `validateEffect`, et l'échappatoire s'élargira (elle s'élargit toujours).

**Antoine a tranché A le 2026-08-04.** Les deux cas continus sont des états
discrets déguisés en curseur — « 0 lame » n'est pas un diaphragme moins
polygonal, c'est un diaphragme rond. Le contrat reste donc entièrement
vérifiable au chargement, et l'échappatoire prédicat n'existe pas.

Conséquences à porter en Task 2, aucune n'est gratuite :
- `lensFlare.sensorSpacing` et `lensBlur.bladeRotation` changent de condition ;
  les paramètres dont ils dépendent deviennent des listes de `choices`.
- ⚠️ **Un `choices` ajouté change le sens d'un index déjà persisté.** Le
  paramètre porteur (nombre de lames, force du quadrillage) reste à sa place
  dans `params[]` ; c'est un paramètre NOUVEAU qui porte l'état discret, ajouté
  à la fin. Ne pas convertir le curseur existant en liste — les presets et les
  références de pixels lisent son index.
- Références de pixels de `lensFlare` et `lensBlur` à régénérer, et **à relire
  à l'œil** avant commit (`--update` ne juge rien).

## 3. Les catégories de paramètres

`effects/catalog.ts` porte déjà `EFFECT_CATEGORIES` (six entrées : Lumière,
Optique, Déformation, Couleur, Impression, Texture) — mais elle classe
l'**effet**, pas ses paramètres. Le vocabulaire des catégories de PARAMÈTRES
reste à écrire, et c'est une taxonomie éditoriale : explicite et centralisée,
jamais inférée du nom.

La mesure du vocabulaire réel donne les familles qui reviennent d'un effet à
l'autre — c'est la matière brute de cette taxonomie, pas la taxonomie :

| Famille observée | Occurrences |
| --- | --- |
| Teinte / Saturation / Luminosité (`colorGroup`) | **21 groupes** |
| Centre X · Centre Y | 5 effets |
| Point noir · Point blanc | 5 effets |
| Seuil | 3 · Intensité 3 · Direction 3 · Graine 3 |
| Espace de mélange · Mode d'entrée | 2 chacun (les contrôles transversaux) |

## 4. Les trois contraintes dures

- **L'index d'un paramètre est PERSISTÉ dans les presets.** La catégorie est une
  donnée d'**affichage** : on trie les items de rendu, jamais `params[]`. Même
  règle pour les `choices` d'une liste — on ajoute à la fin.
- **Les dix-neuf premiers index d'`outlines` sont gelés** par sept références de
  pixels et par les presets. C'est le troisième effet le plus chargé et le
  deuxième porteur de « Sans objet » (11) : principal bénéficiaire, plus gros
  risque.
- **Densité UI = ADR-0001**, checklist au moment où le contrôle change, jamais
  en lot de rattrapage. Masquer des contrôles RÉDUIT la hauteur de colonne :
  c'est le sens favorable, mais la carte ne doit pas se mettre à sauter de
  hauteur à chaque changement de mode.

### Un piège propre au tri par catégories

`groupEffectParams` (`ParamPanel.tsx:41`) construit ses items dans l'ordre de
`params[]` et s'appuie sur cet ordre à deux endroits : `spatialFirstIndex`
(l'en-tête d'un contrôle spatial se pose au premier de ses paramètres) et
`firstIndexByKey` (un groupe de couleur se pose au premier de ses trois rôles).
**Trier par catégorie doit déplacer ces blocs entiers, jamais les traverser** —
sinon un en-tête « Trajectoire » se retrouve séparé de son angle.

## 5. Comment se MESURE une applicabilité

Une applicabilité déclarée sans mesure a déjà été fausse **dans les deux sens** :
`sliceShift` avait deux courses mortes non déclarées (D11), et `glass` déclarait
« Sans objet en Poli » sur un curseur vivant qui produisait de l'aliasing à fond
de course (2026-08-04).

Protocole, avec le seul instrument du dépôt qui sache répondre : **deux
scénarios `render-check` identiques sauf le curseur en question, dans la
configuration où il est déclaré inerte. Zéro canal d'écart = inerte. Un seul
canal d'écart = la déclaration est fausse.** Trente-neuf déclarations à
éprouver ; celles qui tombent sont des bugs trouvés, pas du retard.

## Task 1 — Éprouver les 39 déclarations

- Écrire le harnais de mesure : pour chaque paramètre déclaré « Sans objet »,
  deux rendus au min et au max du curseur, dans la configuration excluante.
- Sortir le tableau des 39 verdicts (inerte / vivant).
- **Livrable = le tableau**, avant toute ligne de contrat. Les « vivants »
  remontent à Antoine : c'est son arbitrage de savoir si l'infobulle ment ou si
  le shader a un défaut.

## Task 2 — Le contrat déclaratif

- Après l'arbitrage §2 : ajouter `appliesWhen` à `EffectParam` (`types.ts`),
  documenté au même niveau que `maxFrom` — d'où ça vient, et ce que ce n'est pas.
- Étendre `validateEffect` : cible existante, cible à `choices`, index valides —
  la validation de `CanvasControl.visibleWhen` est à réutiliser, pas à recopier.
- ⚠️ Ce n'est **pas** une validation de valeur : masquer un contrôle ne borne
  rien. Le shader garde ses clamps, un preset ne passe pas par le panneau.

## Task 3 — Les catégories

- `PARAM_CATEGORIES` dans `catalog.ts`, et `EffectParam.category`.
- Ordre de rendu = rang de catégorie, **stable** à l'intérieur (donc l'ordre de
  `params[]` reste l'ordre d'affichage au sein d'une catégorie).
- Blocs atomiques : groupes de couleur et contrôles spatiaux se déplacent
  entiers.

## Task 4 — Déclarer sur les 21 effets

- Porter les 39 « Sans objet » vers `appliesWhen` **en gardant l'infobulle**
  (elle explique POURQUOI, le masquage ne dit que QUE).
- Catégoriser les paramètres des 21 effets.
- Traiter `glass.flat` en libellé conditionnel (exigence 2), pas en masquage.

## Task 5 — Preuve

- `npm run test:render` : **zéro écart attendu partout**. Le rendu ne dépend pas
  du panneau — un écart signalerait qu'on a touché `params[]` au lieu de
  l'affichage. C'est le gate le plus discriminant de ce chantier.
- Storybook : les stories `ParamPanel` bougent **par construction** ; ce sont
  elles la preuve visuelle du tri et du masquage. Ajouter une story par régime
  (mode local vs mode Échos sur `outlines`, feuille vs pavé sur `glass`).
- Unit, type-check, lint tokens, `npm run test:gpu-shaders --origin`.
- Checkpoint humain : la carte Propriétés sur `glass` et `outlines`, en changeant
  de mode — c'est là que le saut de hauteur se verrait.
