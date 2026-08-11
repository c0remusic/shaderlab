---
name: nouvel-effet
description: Ajouter un effet au registre de rendu — fichier autonome, enregistrement, panneau déclaré par le module, mire capable de montrer la propriété, puis verrou de pixels. Utiliser quand on crée un nouvel effet, qu'on ajoute des paramètres à un effet existant, ou qu'on écrit sa référence de rendu.
disable-model-invocation: true
---

# Nouvel effet

Un effet est un **module autonome** dans `src/render/effects/`, enregistré dans
`registry.ts`. En ajouter un = un nouveau fichier. La présence d'un fichier dans
`effects/` n'est pas la présence d'un effet : `aperture`, `bayer`, `blendSpace`,
`catalog`, `hash`, `hsl`, `inputMode`, `oklab`, `srgbTransfer`, `uvSpace`,
`validate`, `types` sont des helpers. **Vérifier `registry.ts`, toujours.**

## Avant d'écrire : l'effet a-t-il sa place ?

Trois familles, découpées d'une façon qui ne se devine pas depuis les noms.
La règle qui tranche : **un halo AJOUTE de la lumière, il ne déforme pas l'image.**

- **Halos** — `glow` étale sans colorer, `halation` réexpose en rouge sur fond
  sombre, `lensFlare` RÉFLÉCHIT (copies déplacées de la source).
- **Flous** — CLOSE et réduite à deux : `lensBlur` (noyau d'objectif) et
  `motionBlur` (intégration le long d'une trajectoire). Le gaussien reste
  volontairement dehors (ADR-0010) et un test du registre le vérifie.
- **Impression** — `dither`, `hatching`, `halftone`.

Une famille close se rouvre quand un **mécanisme** qui n'y entre pas se présente,
jamais pour une nuance. Et avant de retirer un doublon : **un doublon se MESURE**.
Sur `chromaticBleed`, la mesure a répondu deux choses — 0,005 % d'écart sur le cas
radial (doublon réel) mais 23,1 % sur l'orientation, que le mode absorbant ne
savait pas produire. Le paramètre a été PORTÉ avant le retrait.

## 1. Le fichier

Déclarer un `EffectModule`. Points qui coûtent s'ils sont approximés :

- **`params[]` ne se réordonne JAMAIS.** Les index sont persistés dans les presets
  et dans les automations. On ajoute **à la FIN**. Même règle pour les entrées
  d'un paramètre à `choices` : à la fin de la liste, jamais au milieu.
- Un effet à paramètres groupés touche aussi `ParamPanel.tsx` et peut élargir
  `MAX_EFFECT_PARAMS` (`shaderCompose.ts`, **48** depuis le 2026-08-04).
- La catégorie éditoriale est **explicite et centralisée** dans
  `effects/catalog.ts` (`EFFECT_CATEGORIES`), jamais inférée du nom. Elle classe
  l'EFFET, pas ses paramètres.
- `libraryTexture` **+ passes internes est refusé** par `validateEffect` — le
  binding n'est résolu que pour la passe finale.

## 2. Le piège du backtick — avant tout autre réflexe

Un corps `wgsl:` est un template literal JS. Un backtick nu dans un commentaire
le FERME. Écrire `` \` `` et jamais `` ` ``, même vigilance pour `${`.

Le hook `PostToolUse` (`.claude/hooks/wgsl-backtick-guard.mjs`) attrape ce cas à
l'écriture. Il ne dispense pas de lancer `npx tsc --noEmit` après toute édition de
shader, **avant quoi que ce soit d'autre** : l'erreur `TS1005` désigne une ligne
LOIN du commentaire fautif, et un fichier qui ne parse pas fait échouer des tests
pour une raison sans rapport avec ce qu'ils testent.

## 3. Le panneau est déclaré par le module, jamais par `ParamPanel`

Trois champs, un seul type de condition partagé (`DisplayCondition`) :
`EffectParam.appliesWhen`, `EffectModule.sections` (vocabulaire **fermé** à
`liste` · `paire` · `grille` · `pose` · `figure`), `CanvasControl.visibleWhen`.
Une condition vise un paramètre à `choices` et rien d'autre.

Corollaires :

- **C'est de l'AFFICHAGE.** `test:render` doit rendre **zéro écart** après tout
  travail de panneau — c'est le gate discriminant : un écart prouve qu'on a trié
  le tableau au lieu des items.
- **Masquer ne borne pas.** Le shader garde ses clamps ; un preset ne passe pas
  par le panneau. Idem `maxFrom`, qui borne le CURSEUR et jamais la valeur.
- **Un paramètre qu'aucune section ne cite n'est pas un défaut** — quatre effets
  en laissent délibérément. La différence entre un orphelin voulu et un oubli se
  LIT dans le commentaire ; aucune mesure ne la donne.
- **Une applicabilité se MESURE avant de se déclarer** :
  `node scripts/render-check.mjs --applicabilite`. Sur 41 déclarations éprouvées,
  une était FAUSSE — masquée sur sa foi, aucun test n'aurait rougi, un curseur
  caché ne bougeant plus aucun pixel.

## 4. Chaque curseur doit avoir une course VIVANTE

Un curseur dont la course est morte est un échec silencieux, au même titre qu'un
paramètre non câblé. Deux formes déjà rencontrées :

- le HAUT de la course dégrade l'effet (`P(fusion) = x·(1−x)` retombait à zéro à
  fond de curseur) ;
- le maximum déclaré dépasse le maximum effectif (`edgeFeather` annonçait 200 px,
  le shader bornait à `sliceSize` = 48 : trois quarts morts).

`test/render/effects/parametresCables.test.ts` vérifie que chaque paramètre
déclaré est lu à SON index par le shader. Elle naît d'un défaut réel — `warp`
avait quatre contrôles sur sept morts ou décalés, invisibles pour le compilateur
**comme pour le verrou de pixels** : un curseur mort ne bouge aucun pixel,
précisément parce qu'il est mort.

## 5. La mire AVANT la référence de pixels

**Un verrou de pixels ne vaut que si sa mire peut MONTRER la propriété que
l'effet prétend porter.** Se demander ce qui distingue l'effet de sa version
naïve, puis vérifier que la mire peut le montrer. Si elle ne le peut pas,
**écrire la mire d'abord**.

Payé le 2026-08-01 : `lensBlur` avait dix-sept tests unitaires verts en floutant
au DOUBLE du rayon réglé et en rendant des nuées granuleuses au lieu d'hexagones.
Son scénario était posé sur la mire commune, qui n'a aucun point lumineux isolé —
or une tache de bokeh ne se lit que sur un petit point brillant contre du sombre.
Sous un damier, un lens blur rend exactement ce que rendrait un gaussien : le
verrou verrouillait du bruit. Trois mires ont dû être écrites dans la journée
(`mireBokeh`, `mireRampe`, `mireBruit`), et les trois ont trouvé un défaut à leur
première exécution.

Corollaire utile : **le verrou rend aussi un refactor prouvable.** Poser une
référence AVANT d'extraire du code transforme « ça devrait être neutre » en
`aucun écart`. Poser la preuve avant le geste, pas après.

## 6. Séquence de vérification

```bash
npx tsc --noEmit
npx vitest run --project=unit
node scripts/gpu-shader-check.mjs --origin http://localhost:1421
npm run test:render
```

⚠️ `npm run test:gpu-shaders` **sans `--origin`** compile les modules FIGÉS en
cache de la fenêtre, pas ton édition : vert ET rouge faux.

## 7. Demander les photos avant de raffiner

Leçon la plus chère du 2026-08-03 : trois passes de raffinement de `lensFlare`
faites sur des références générales, puis cinq photos d'Antoine ont montré que son
objectif ne produit ni chaîne de fantômes ni anneau, mais une plume de diffusion
rasante. **Des références générales disent ce qu'un effet PEUT être ; les photos
de celui qui va s'en servir disent ce qu'il DOIT être.**
