# Contrôles par mode — design

> Demande d'Antoine, 2026-08-05, en trois phrases :
> 1. « chaque catégorie d'effet devrait avoir des contrôles custom selon son mode » ;
> 2. « que les contrôles irrelevant dans leur contexte ne soient pas affichés » ;
> 3. « il faut aussi que les contrôles soient optimisés pour fit l'affichage
>    optimal de chaque mode ».
>
> La deuxième est l'exigence 1 du chantier 2, déjà planifiée et déjà instruite
> (Task 1 : 38 déclarations sur 39 prouvées inertes). Les deux autres
> **élargissent le chantier** : elles disent que la liste uniforme de curseurs
> cesse d'être la forme par défaut.

---

## 1. Ce qui existe, mesuré le 2026-08-05

Sur les 21 effets du registre, **14 portent au moins un mode** (un paramètre à
`choices`) et 7 n'en portent aucun.

| Catégorie | Effets | Modes | Contrôles spécialisés déjà là |
| --- | --- | --- | --- |
| Lumière | `glow` 4p · `halation` 6p · `lensFlare` 30p | aucun | disque posé + groupes de couleur (`lensFlare`) |
| Optique | `lensDistortion` 16p · `lensBlur` 11p · `motionBlur` 7p · `glass` 22p | `aberrationMode`(3) · `fieldShape`(4) · `trajectory`(3) · **`material`(14) × `profile`(5) × `orientation`(2)** | axe et point posés (`motionBlur`) |
| Déformation | `warp` 10p · `gooeyMerge` 11p · `pixelStretch` 12p · `sliceShift` 8p | `type`(9) · `inputMode`(3) | disque posé (`pixelStretch`) |
| Couleur | `duotone` 11p · `channelMixer` 22p · `curves` 37p · `gradientMap` 20p | `transferSpace`(2) · `blendSpace`(4) × `repeatType`(2) | **courbes + plage tonale** (`curves`), **rampe** (`gradientMap`) |
| Impression | `hatching` 16p · `halftone` 9p · `dither` 14p · `outlines` 26p · `isolines` 18p | `pattern`(4) · `colorMode`(4) · `style`(7)×`distribution`(2) · **`inputSource`(3) × `inkMode`(2) × `detectMode`(3)** | groupes de couleur (4 des 5) |
| Texture | `grain` 5p | `mode`(2) | aucun |

**Cinq familles de contrôles spécialisés existent déjà** : `CanvasControl`
(point / disque / axe), `CurveControl`, `TonalRangeControl`, `ColorRampControl`,
`ColorGroupControl`. Le chantier n'invente donc pas la notion — il la
généralise et lui donne un pilote.

### Les deux cas qui justifient à eux seuls le chantier

- **`glass`** : 22 paramètres, **zéro** contrôle spécialisé, et le plus grand
  espace de modes du registre. En Poli, **15 des 22 curseurs sont sans objet**
  (mesuré) — l'utilisateur lit une liste dont les deux tiers ne servent à rien.
- **`outlines`** : 26 paramètres et **18 combinaisons** de ses trois modes
  croisés. C'est aussi l'effet dont les 19 premiers index sont gelés par sept
  références de pixels — le plus rentable et le plus risqué.

---

## 2. « Mode » recouvre TROIS choses, et il ne faut pas les traiter pareil

C'est le constat qui structure tout le reste. Le registre appelle « mode » un
paramètre à `choices`, mais ces paramètres ne jouent pas le même rôle.

### A. Mode EXCLUSIF — le choix change la nature de l'effet

`glass.material` (14), `outlines.detectMode` (3), `warp.type` (9),
`motionBlur.trajectory` (3), `lensBlur.fieldShape` (4), `hatching.pattern` (4),
`dither.style` (7), `halftone.colorMode` (4), `lensDistortion.aberrationMode` (3).

Deux régimes n'ont ni les mêmes réglages, ni les mêmes unités, ni la même
géométrie. **C'est ici que « contrôles custom selon le mode » a son sens fort** :
le panneau doit changer de FORME, pas seulement filtrer des lignes.

### B. Mode de RÉGLAGE — le choix change un détail, pas la nature

`gradientMap.blendSpace` (4), `channelMixer.transferSpace` (2),
`outlines.inputSource` (3), `gooeyMerge.inputMode` (3), `isolines.inputMode` (3),
`grain.mode` (2), `gradientMap.repeatType` (2), `glass.orientation` (2).

Ce sont les **contrôles transversaux** posés le 2026-08-01 et leurs cousins. Un
sélecteur suffit ; refondre l'affichage autour d'eux serait du bruit. ⚠️ Ne pas
les traiter comme des modes exclusifs est une exigence, pas une économie : un
panneau qui se réorganise quand on change d'espace de mélange serait
désorientant pour un réglage qui ne change rien à la nature de l'effet.

### C. NI MODE, mais des blocs CUMULATIFS

`lensFlare` porte **30 paramètres et aucun `choices`**. Ce n'est pas un oubli :
ses trois phénomènes — fantômes entre faces polies, diffusion sur surface sale,
quadrillage capteur — **s'additionnent** au lieu de s'exclure (ADR-0017). Un
mode serait faux ici.

Ce qu'il lui faut n'est pas un mode mais des **sections repliables**, une par
phénomène, chacune éteinte quand son intensité est nulle. Même besoin chez
`glass` (optique commune vs matière vs pavé) et `curves` (quatre canaux).

**Conséquence de méthode :** le contrat ne doit pas s'articuler sur « le mode »,
mais sur **des groupes de paramètres qui apparaissent ensemble**. Un groupe peut
être commandé par un mode exclusif (A) ou par un simple seuil (C).

---

## 3. Le contrat, en trois pièces

Toutes déclaratives, dans le module d'effet ; `ParamPanel` interprète. Aucun
`if (effectId)` dans React — frontière d'`ARCHITECTURE.md`.

### Pièce 1 — `EffectParam.appliesWhen` (exigence 2 d'Antoine)

Généralisation de `CanvasControl.visibleWhen`, déjà validé statiquement par
`validateEffect`. **Voie A tranchée** : déclaratif seul, pas d'échappatoire
prédicat. Task 1 a prouvé 38 des 39 déclarations ; la 39ᵉ (`glass.flat`) est un
cas de libellé, pas de masquage.

### Pièce 2 — `EffectModule.sections` (exigences 1 et 3)

Un groupe nommé de paramètres, avec sa propre condition d'apparition et son
propre régime d'affichage. C'est la pièce qui manque aujourd'hui, et c'est elle
qui porte « contrôles custom selon le mode ».

Une section déclare : son titre, les paramètres qu'elle contient, sa condition
(`appliesWhen`, même forme que la pièce 1), et son **gabarit** — comment ses
contrôles se disposent.

### Pièce 3 — les GABARITS, et pourquoi ils sont un vocabulaire FERMÉ

« L'affichage optimal de chaque mode » ne peut pas être une mise en page libre :
ce serait de la logique métier dans le composant, et ça violerait ADR-0001 au
premier ajout. Le gabarit est donc un choix parmi une liste courte, chacun
justifié par un besoin déjà présent dans le registre :

| Gabarit | Ce qu'il rend | Qui en a besoin aujourd'hui |
| --- | --- | --- |
| `liste` | l'existant — un curseur par ligne | tout le reste, et c'est le défaut |
| `paire` | deux curseurs liés sur une ligne | `blackPoint`/`whitePoint` (5 effets), `min`/`max` de plage |
| `grille` | curseurs courts en deux colonnes | les 8 réglages de pavé de `glass`, les 4 du mortier |
| `posé` | un contrôle sur l'image, pas de curseur | déjà `CanvasControl` — `lensFlare`, `motionBlur`, `pixelStretch` |
| `figure` | un contrôle dessiné, propre au domaine | déjà `CurveControl`, `ColorRampControl` |

⚠️ **Un gabarit ne choisit pas des pixels, il choisit un RÉGIME.** La densité
reste réglée par les tokens et par ADR-0001. Sans cette frontière, « optimisé
pour chaque mode » devient 21 mises en page à maintenir.

---

## 4. Ce que ça donne, catégorie par catégorie

Pas des maquettes — les conséquences concrètes du contrat sur les six
catégories, qui ne sont pas les mêmes partout.

- **Optique.** La catégorie qui gagne le plus. `glass` passe de 22 curseurs
  plats à trois sections — *Matière* (ce qui fabrique la pente), *Optique*
  (commune aux 14 matières), *Pavé* (les 8 réglages, en grille, absents des
  neuf matières de feuille). En Poli, le panneau tombe de 22 lignes à 7.
- **Impression.** `outlines` passe de 26 lignes à *Détection* + *Encre* +
  *Échos*, la troisième n'apparaissant qu'en mode Échos — exactement le
  prédicat que ses neuf passes portent déjà (`EffectPass.enabled`). Le contrat
  d'affichage devient le miroir du contrat de coût.
- **Couleur.** Déjà la mieux servie (courbes, rampe). Ce qu'elle gagne est la
  *paire* pour `blackPoint`/`whitePoint`, qui traîne dans cinq effets.
- **Lumière.** `glow` et `halation` (4 et 6 paramètres) n'ont **rien** à gagner
  et ne doivent rien changer. `lensFlare` gagne trois sections cumulatives.
- **Déformation.** `warp` a 9 types pour 10 paramètres : c'est le cas où le
  masquage seul suffit, sans section.
- **Texture.** `grain`, 5 paramètres. Ne rien faire.

⚠️ **La moitié du registre n'a rien à gagner à ce chantier**, et le dire
maintenant évite de le découvrir en refondant un effet à 4 paramètres. Le
bénéfice est concentré sur `glass`, `outlines`, `lensFlare`, `curves`,
`channelMixer`, `gradientMap` — six effets, tous au-dessus de 16 paramètres.

---

## 5. Les contraintes dures, inchangées

- **L'index d'un paramètre est PERSISTÉ dans les presets.** Les sections sont
  une donnée d'AFFICHAGE : on regroupe des items de rendu, jamais `params[]`.
- **Les 19 premiers index d'`outlines` sont gelés** par sept références de
  pixels.
- **`groupEffectParams` s'appuie sur l'ORDRE de `params[]`** à deux endroits
  (`spatialFirstIndex`, `firstIndexByKey`). Les sections doivent déplacer des
  blocs entiers, jamais les traverser.
- **ADR-0001** : la checklist de densité s'applique au moment où le contrôle
  change, pas en lot.
- **Aucun pixel ne doit bouger.** `npm run test:render` doit rendre **zéro
  écart** sur les 82 scénarios : ce chantier ne touche que l'affichage. Un écart
  prouverait qu'on a trié le modèle.

## 6. Ce qui reste à trancher

1. **`glass.flat`** (Task 1) — trois sens sous un libellé. La demande d'Antoine
   l'oriente : « les contrôles irrelevant ne sont pas affichés » ne s'applique
   PAS ici, puisque `flat` est pertinent en Martelé. Reste à choisir entre
   libellé conditionnel et paramètres séparés.
2. **Une section vide se masque-t-elle, ou se grise-t-elle ?** Masquer réduit la
   hauteur mais fait sauter le panneau à chaque changement de mode ; griser
   garde la carte stable au prix de la densité. ADR-0001 pousse à masquer, la
   stabilité visuelle à griser.
3. **Le vocabulaire des gabarits est-il le bon ?** Cinq entrées proposées
   ci-dessus, toutes tirées d'un besoin réel du registre. En ajouter une doit
   coûter une décision, sinon la liste dérive vers la mise en page libre.
