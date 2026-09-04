# 24 — Cadrage : le scale générique du rendu d'un effet placé

Écrit le 2026-09-04, sur pièces (pipeline et shaders lus, taps comptés par
effet — voir la table). Ce document répond aux quatre questions du ticket :
où vit le scale, ce qu'il compose, ce qu'il coûte, et ce que le prototype doit
montrer avant qu'Antoine tranche.

## Le fait central, mesuré : trois classes d'effets, pas une

Le grilling a tranché « un scale générique du rendu, pas du cas-par-cas par
paramètre » (option ii). La mesure dit que le mot « générique » recouvre trois
comportements différents, parce que les effets ne se ressemblent pas dans leur
rapport à l'image. Compté sur les 26 modules (`grep textureSample`, `passes:`) :

| Classe | Effets | Ce qu'un scale du champ leur fait |
|---|---|---|
| **Champ pur** (0 tap, usage de `uv` comme champ) | `lightLeak`, `aplat`, `grain`, `hatching`, `dither`, `halftone` (1 tap encre) | Exactement ce qu'Antoine demande : le champ s'étire, l'image ne bouge pas |
| **Ponctuel** (0 tap, `uv` ignoré) | `curves`, `duotone`, `gradientMap`, `channelMixer` | Rien — un opérateur point à point est invariant par transformation du domaine. Honnête, pas cassé (Photoshop non plus n'étire pas un calque de réglage) |
| **Lecteurs d'image** (≥1 tap sur `srcTexture`/`prevPass`) | `glass` (4), `warp`, `lensBlur` (4), `motionBlur` (3), `displacementMap` (5), `gooeyMerge` (17), `nettete` (10), `outlines` (7), `glow`/`halation`/`lensFlare` (pyramides), `pixelStretch`, `sliceShift`, `isolines`, `texture`, `lensDistortion` (15) | Ambigu : leurs prélèvements suivent le domaine déformé, donc l'image elle-même se déforme DANS la sortie de l'effet, puis se compose sur un fond NON déformé — décalage visible (image doublée) |

C'est la phrase du ticket « déformer la sortie ≠ déformer le champ », chiffrée.
Aucune voie générique ne rend les trois classes parfaites à la fois ; la
question pour Antoine est de savoir si le comportement de la troisième classe
est acceptable, pas de l'éliminer.

## Voie A — déformer la SORTIE (re-échantillonner le rendu de l'effet)

Mécanique : rendre la passe d'effet dans une cible intermédiaire pleine
résolution, puis une passe de re-échantillonnage affine (le patron existe —
`PhotoLayerInputResolver` fait exactement ça pour un calque photo : texture
pleine taille, couverture en alpha), puis composer.

**Défaut structurel, connu d'avance** : la sortie d'un effet n'est pas « l'effet »,
c'est `composite(effet sur le fond)`. Il n'existe aucune décomposition générique
de la « contribution » d'un effet (les modes de fusion ne sont pas linéaires).
Étirer la sortie étire donc AUSSI la copie du fond qu'elle contient, contre un
fond qui ne bouge pas : dédoublement de l'image au bord de la couverture, sur
TOUTES les classes, y compris champ pur (le light leak étiré emporterait un
fantôme étiré de la photo). C'est « rastériser le composite puis l'étirer ».

Coût : +1 cible pleine résolution (~96 Mo à 24 Mpx) et +1 passe par calque
transformé, par frame.

## Voie B — déformer le CHAMP (transformer l'UV d'entrée de `fs_main`)

Mécanique : dans `composeShader`, quand le calque porte un transform actif,
le wrapper appelle `fs_main(transformUv(in.uv), effectInput)` — `effectInput`
(la couleur du fond) reste échantillonné à l'UV identité. Une matrice affine
inverse (2×3) dans un uniform ; correction d'aspect comme `uvSpace.ts`.

- Classe champ pur : parfait — seul le champ se déforme.
- Classe ponctuelle : inerte, par construction.
- Classe lecteurs d'image : les taps internes partent de l'UV déformé →
  déformation affine locale de l'image dans la sortie de l'effet (une sorte de
  warp), avec le même risque de décalage au raccord. Pour les pyramides
  (`glow`), le halo s'étire EN EMPORTANT la copie d'image qu'il contient.

⚠️ **AMENDÉ le 2026-09-04 par le prototype — une prémisse de ce paragraphe
était fausse sur pièce.** Ce document promettait « passes internes en repère
identité, seule la passe finale lit `prevPass` à l'UV déformé » comme si
c'était le comportement de l'édition naïve. Faux : `composeShader` enveloppe
CHAQUE passe (`effectPassRunner.ts:259` rappelle `runEffectPass` avec
`pass.wgsl`, qui rappelle `composeShader:356`) — le wrapper transformé est
donc émis pour TOUTES les passes, pyramide comprise. Mesuré sur `glow` : le
bloom S'EFFONDRE (scaleX 2 et scaleY 0.4 rendent des PNG byte-identiques,
moyenne 0,34 — halo disparu, l'énergie sort du cadre à chaque niveau).
**L'implémentation réelle de la voie B doit donc GATER la transformation
d'UV sur `opts.applyMask`** (le chemin de compositing, une passe par calque) :
mesuré, ce variant préserve le halo — étiré et détaché des points de base
(le fantôme prédit), états distincts, identité au bit près conservée.

Coût : zéro passe en plus, un uniform. **Chemin identité au bit près** : quand
le transform est absent, la chaîne composée est identique caractère pour
caractère (la chaîne EST la clé de cache des pipelines), donc `test:render`
zéro écart sans régénérer une seule référence — c'est le gate discriminant.

## Où vit le scale — proposition

**Champ neuf sur `LayerState`, pas une réutilisation de `LayerTransform`** :

- `LayerTransform` est contractuellement couplé à `imageSource` (« TOUJOURS
  présents ensemble ou absents ensemble », `layers/types.ts`) et exprimé en
  PIXELS de la photo de fond ; les effets placés parlent en fractions.
- Proposition : `effectTransform?: { scaleX: number; scaleY: number; rotation?: number }`,
  champs scalaires (historique par construction, invariant OOM intact).
  L'ANCRE de la déformation est la position de l'effet — les rôles `x`/`y` de
  `controlFieldRoles`, déjà la seule énumération (ticket 20) ; centre de toile
  pour un effet sans ancrage.
- La translation RESTE dans les params (ticket 20, livré) : « déplacer PUIS
  étirer » — le scale ne réécrit pas les positions, il déforme autour d'elles.

## Ce qu'il compose

- **Params spatiaux** (box d'`aplat` étirée par ses curseurs ET par le scale) :
  le scale est EXTÉRIEUR — les params décrivent la forme dans le repère de
  l'effet, le transform déforme ce repère. Ordre fixe, documenté, jamais de
  fusion des deux (sinon les poignées du ticket 13 deviendraient ambiguës).
- **Verrous** : `locks.position` gèle aussi `effectTransform` (sa définition
  cite déjà la géométrie et le transform photo). Garde à poser dans
  `LayerStack` ET sur la porte `replaceLiveLayers` (le verrou fuit par là,
  payé le 2026-08-19), et l'appairage `requestRender` sur tout chemin vivant.
- **Presets** : exclu au départ, comme `transform` photo (`presetTypes.ts`
  l'exclut explicitement) — cohérent, et réversible plus tard par ajout en fin.
- **UI** : `TransformHandles` existe (huit poignées, rotation) ; la pièce
  manquante est le modèle, pas le contrôle. Surface calquée sur
  `EffectMoveSurface`/`effectMove.ts` (module pur, delta cumulé depuis
  l'appui, jamais incrémental — la leçon anti-dérive est écrite dedans).

## Recommandation, et ce que le prototype doit montrer

**Recommandation : voie B.** Elle est exacte sur la classe que le retour
d'usage vise (light leak, trames, textures — « aplatir le light leak »),
honnête sur les ponctuels, et son ambiguïté sur les lecteurs d'image est
locale au calque au lieu d'être un dédoublement garanti partout comme en A.
Zéro coût mémoire, identité au bit près.

✅ **Prototype RENDU le 2026-09-04** (harnais look-dev, scripts
`assets/planche-24-*.mjs`, planche `assets/planche-24-transform.html` —
zéro édition moteur commitée, `shaderCompose.ts` restauré). Trois effets ×
deux voies × trois états, plus un quatrième rang glow (voie B gatée
`applyMask`). Défauts VUS, pas prédits :

1. `lightLeak` — voie B parfaite : photo intacte, seul le champ du leak
   s'aplatit. Voie A : photo dupliquée à deux échelles, couture franche.
2. `texture` — la trame s'étire proprement en voie B (scaleX 2 élargit les
   cellules, scaleY 0.4 les aplatit). Voie A : trame confinée à la bande,
   photo pleine autour.
3. `glow` (mire bokeh, pire cas) — voie B naïve : effondrement (voir
   amendement ci-dessus) ; voie B gatée : halo préservé, étiré, détaché des
   points (fantôme localisé au calque) ; voie A : dédoublement points/halos.

Gate vérifié sur les trois effets : voie B identité byte-identique au témoin.

## Plan de tranches (après verdict d'Antoine sur la planche)

1. Modèle : `effectTransform` sur `LayerState`, gardes de verrou (LayerStack +
   `replaceLiveLayers`), tests unitaires purs.
2. Moteur : uniform + `transformUv` dans `composeShader` (chemin identité
   inchangé caractère pour caractère), `test:render` zéro écart, puis
   référence neuve (mire qui MONTRE l'étirement — light leak scaleY 0.4).
3. UI : surface de poignées sur `TransformHandles`, geste vérifié par CDP,
   validation à l'œil d'Antoine.
