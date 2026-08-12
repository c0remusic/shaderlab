# L'applicabilité couvre 10 % du parc

Type: grilling
Status: open
Parent: ../map.md

> Front 1 sur 3 de la rationalisation des contrôles. Cadrage et ordre :
> [La rationalisation des contrôles n'est pas terminée](14-la-fusion-des-reglages-redondants.md).
> **À traiter en PREMIER** : masquer réduit mécaniquement ce qui est à l'écran,
> donc re-sectionner avant serait sectionner un panneau qui n'existera plus.

## Question

Mesuré le 2026-08-12 ([`assets/mesure-controles.ts`](../assets/mesure-controles.ts)) :
**36 conditions `appliesWhen` sur 345 paramètres**, soit **10 %**, concentrées
sur 8 effets. **15 effets sur 23 n'en ont AUCUNE** — et ce sont les plus
chargés.

| Effet | Paramètres | Conditions |
| --- | --- | --- |
| `curves` | 37 | **0** |
| `lensFlare` | 30 | **0** |
| `channelMixer` | 22 | **0** |
| `gradientMap` | 20 | **0** |
| `isolines` | 18 | **0** |
| `lightLeak`, `halftone`, `pixelStretch` | 12 | **0** |
| `duotone`, `gooeyMerge` | 11 | **0** |
| `texture` 9 · `sliceShift` 8 · `halation` 6 · `grain` 5 · `glow` 4 | | **0** |

Constat d'Antoine, le même jour : « des réglages orphelins qui ne font *rien*
selon certains types d'effets/situations ».

**Quels paramètres sont réellement inertes, dans quels états, et lesquels
masque-t-on ?**

## Le cas qui démontre le problème

ADR-0017 dit que `lensFlare` porte **trois blocs distincts** — fantômes
(réflexions entre faces polies), diffusion (stries d'une surface sale), red dot
(aller-retour avec le capteur). Ils diffèrent par l'endroit où la lumière se
perd, et chacun a ses paramètres. **Quand un bloc est éteint, ses paramètres ne
font rien — et rien ne les masque.** Trente paramètres, zéro condition.

Même forme probable ailleurs : `curves` a quatre canaux (maître, R, V, B) ;
`gradientMap` et `channelMixer` ont des modes ; `dither`, `halftone` et
`hatching` ont des modes d'encre.

## La règle qui gouverne ce front

⚠️ **Une applicabilité se MESURE avant de se déclarer.** Le gate existe :

```bash
node scripts/render-check.mjs --applicabilite
```

Sur les 41 déclarations éprouvées le 2026-08-05, **une était FAUSSE** —
`glass.flat`, qui bougeait 47 % des canaux en Martelé. Masquée sur sa foi,
**aucun test n'aurait rougi** : un curseur caché ne bouge plus aucun pixel. Ce
front consiste donc à multiplier par dix un geste dont on sait qu'il produit des
faux à 2,4 %.

## Ce qu'il faut interroger

- **Inerte ou seulement RARE ?** Masquer un paramètre sans effet est évident.
  Masquer un paramètre qui agit mais qu'on utilise peu est une autre décision —
  et c'est là que la troisième voie de Lightroom (faner et mettre en italique
  au lieu de retirer, voir [Quels mécanismes de lisibilité adopter](11-quels-mecanismes-de-lisibilite-adopter.md))
  redevient pertinente. Ne pas les traiter pareil.
- **Masquer ou DÉSACTIVER ?** Un curseur masqué disparaît ; un curseur grisé
  dit « il existe, mais pas ici ». Le second enseigne l'effet, le premier
  allège. Le dépôt a choisi de masquer — sur quel raisonnement, et tient-il à
  345 paramètres ?
- **Combien de conditions faudrait-il vraiment ?** Le chiffre honnête n'est pas
  « 345 » : beaucoup de paramètres sont toujours actifs. Estimer effet par
  effet AVANT de commencer, sinon on ne saura pas quand on a fini.
- **Le coût du geste.** Une `DisplayCondition` vise un paramètre à `choices` et
  rien d'autre (voie A, aucune échappatoire prédicat). Est-ce que tous les cas
  inertes s'expriment dans ce vocabulaire, ou certains demandent-ils autre chose
  — auquel cas c'est une décision de contrat, pas une déclaration de plus ?

## Contraintes dures

- **Masquer ne borne pas.** Le shader garde ses clamps, un preset ne passe pas
  par le panneau. `LayerStack.updateParams` n'écrête rien.
- **`params[]` ne se réordonne jamais** — les index sont persistés dans les
  presets. L'applicabilité est de l'AFFICHAGE.
- **`test:render` doit rendre ZÉRO écart** après ce travail. C'est le gate
  discriminant : un écart prouve qu'on a touché au rendu en croyant toucher à
  l'affichage.

## Ce qui prouve que ce front est fini

**Zéro paramètre inerte non masqué, prouvé effet par effet** — et chaque
déclaration éprouvée par le gate, jamais posée sur une croyance.

⚠️ **Pas un compte de déclarations.** « On est passé de 36 à 200 » ne prouve
rien : c'est exactement la mesure qui a fait croire, le 2026-08-12, que ce front
était couvert.
