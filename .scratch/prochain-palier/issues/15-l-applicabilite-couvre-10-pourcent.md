# L'applicabilité couvre 10 % du parc

Type: grilling
Status: resolved
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

---

## Mesure du 2026-08-18 — le cadrage de ce ticket tombe sur TROIS points

Travail AFK, avant toute question. Rien n'est tranché ici : le ticket reste
`grilling`, et la décision « lesquels masque-t-on » attend Antoine. Mais les
chiffres sur lesquels il repose ne tiennent plus.

### 1. Le DÉNOMINATEUR est faux — 289 rangées, pas 365 paramètres

Un `EffectParam` n'est pas une rangée de panneau. Soixante-seize d'entre eux
sont **consommés par un contrôle composite** — points de `curveControls`,
arrêts de `colorRampControls`, bornes de `tonalRangeControl`, satellites d'un
`colorGroup` — et ne sont jamais rendus comme une ligne à masquer.

| | Déclarés | **Rangées réelles** |
| --- | --- | --- |
| Parc entier | 365 | **289** |

La couverture n'est donc pas de 10 %, ni même de 13,2 % : elle est de
**16,6 %** (48 conditions / 289 rangées). Masquer un paramètre qui n'a pas de
ligne n'a aucun sens — il ne pouvait pas être au dénominateur.

### 2. `curves`, l'exemple n°1 du ticket, s'effondre

Le ticket ouvre sur « `curves` — 37 paramètres, **0** condition », en tête d'un
tableau des « plus chargés ». Mesuré : **37 déclarés, 13 rangées.** Les
vingt-quatre autres sont les points de ses quatre courbes, qui se manipulent
dans le tracé et pas dans une liste. Il est en milieu de peloton, pas en tête.

### 3. ⚠️ Pour HUIT effets, une condition est STRUCTURELLEMENT IMPOSSIBLE

C'est la trouvaille qui change la question. La voie A est fermée par décision :
**une condition vise un paramètre à `choices` et rien d'autre.** Or le parc ne
compte que **25 paramètres à `choices`**, et huit effets n'en ont **aucun** :

| Effet | Rangées | Params à `choices` |
| --- | --- | --- |
| `curves` | 13 | 0 |
| `lightLeak` | 12 | 0 |
| `pixelStretch` | 12 | 0 |
| `texture` | 9 | 0 |
| `sliceShift` | 8 | 0 |
| `halation` | 6 | 0 |
| `duotone` | 5 | 0 |
| `glow` | 4 | 0 |

**69 rangées où la réponse n'est pas « il manque des conditions » mais « il n'y
a rien sur quoi conditionner ».** Le ticket les comptait comme de la dette ; ce
sont des effets sans mode, donc sans état où un réglage dort.

### 4. Le cas de démonstration du ticket est déjà réparé

Il s'appuie sur `lensFlare` — « trois blocs distincts, trente paramètres, zéro
condition ». Depuis le 2026-08-14, il porte **trois conditions de SECTION**, une
par phénomène. Ses 31 rangées sont donc gouvernées, simplement pas par des
conditions de paramètre. Le ticket a été écrit avant.

### Parc complet au 2026-08-18

24 effets · 365 params déclarés · **289 rangées** · 48 conditions de paramètre ·
77 sections · **10 conditions de section** · 14 effets sur 24 sans aucune
condition d'aucune sorte.

### Ce que la question devient, une fois ces chiffres posés

Le ticket demandait « quels paramètres sont réellement inertes, et lesquels
masque-t-on ». La mesure la scinde en trois, et seule la première est un travail
de déclaration :

1. **Les effets À MODES, sans conditions** — `channelMixer` (16 rangées, 1
   `choices`), `gradientMap` (8, 2), `isolines` (12, 1), `halftone` (12, 1),
   `gooeyMerge` (9, 1), `grain` (5, 1). Là, la question du ticket se pose telle
   quelle, et le gate `--applicabilite` l'éprouve.
2. **Les huit sans `choices`** — la question n'est pas « que masquer » mais
   « ces effets ont-ils un état caché qui mériterait un mode ? ». C'est une
   question de CONCEPTION d'effet, pas d'affichage, et elle ne se répond pas
   dans ce front.
3. **`lensFlare`** — déjà gouverné par sections. Rien à faire.

**La question pour Antoine se réduit donc au point 2** : accepte-t-on que huit
effets restent hors du champ de l'applicabilité par construction, ou est-ce le
signal qu'il leur manque un mode ?

---

## Answer — RÉSOLU le 2026-08-18

**Le front est SOLDÉ, et il ne restait qu'UNE déclaration à écrire.** Pas six
effets, pas dix pour cent à rattraper : une.

### Ce que le ticket comptait comme dette et qui n'en était pas

Le ticket rangeait ensemble tout ce qui porte un `choices` sans condition. Mesuré
sur les 27 effets, **cette liste confond trois choses**, et une seule est une
dette :

| effet | son `choices` | ce que c'est |
| --- | --- | --- |
| `channelMixer` | `transferSpace` | un **ESPACE** — change comment chaque paramètre agit, n'en éteint aucun |
| `isolines`, `gooeyMerge` | `inputMode` | une **ENTRÉE** — même chose |
| `gradientMap` | `blendSpace` + `repeatType` | un espace, plus un vrai mode **déjà déclaré et mesuré inerte** |
| `grain` | `mode` | un vrai mode, **mais rien d'inerte dedans** |
| `halftone` | `colorMode` | un vrai mode, **mais rien d'inerte dedans** |
| `emboss` | `rendu`, `entree` | sans condition **délibérément**, dit à sa déclaration |

**Un `choices` qui nomme un espace ou une entrée ne gouverne rien** : il change
la façon dont TOUS les réglages agissent, pas lesquels existent. Seul un
`choices` qui nomme un MODE peut rendre un paramètre inerte. La règle manquait au
ticket, et c'est elle qui fait tomber quatre effets de la liste.

Les deux vrais modes ont été éprouvés au gate, en témoins INVERSES — on demande
« ce paramètre est-il inerte ? » en s'attendant à VIVANT :

- `halftone.rotation` en Noir sur blanc : **VIVANT, 34,2 % des canaux, max 255** ;
- `grain.size` en Capteur : **VIVANT, 72,1 % des canaux, max 107**.

### ⚠️ Le couple de valeurs a produit un FAUX « inerte », et c'est le sens dangereux

Première mesure de `halftone.rotation` : `a: 0`, `b: 90`. Verdict **INERTE, zéro
canal d'écart** — sur la mire structurée. Faux : **une rotation de 90° d'un
réseau CARRÉ le ramène sur lui-même.** L'en-tête de la table nomme exactement ce
piège pour `bladeRotation` (0 vs 360), et je suis tombé dedans dix lignes plus
bas. Avec `0` vs `37`, le même paramètre rend 34,2 %.

Ce que ça coûte si personne ne le voit : **on masque un curseur vivant, et rien ne
rougit** — un curseur caché ne bouge plus aucun pixel. La règle qui manquait :
**les deux valeurs ne doivent pas être une SYMÉTRIE du mécanisme**, et la
périodicité d'un angle n'est pas la seule (un réseau carré est invariant à 90°,
un hexagonal à 60°).

Autre leçon du même essai : **la mire décide du verdict.** Sur `mireRampe`, la
même déclaration rendait « VIVANT à 0,006 % » — assez pour ne pas conclure à
l'inertie, trop peu pour prouver quoi que ce soit. Une rampe lisse ne peut pas
montrer une grille qui tourne.

### La seule vraie dette, et elle attendait depuis quatorze jours

`glass.flat` était le **seul VIVANT des 41 déclarations**, depuis le 2026-08-04.
Il ne l'était plus pour la raison d'origine : son infobulle a été corrigée le
2026-08-05 (Martelé et Écorce nommés), et **personne n'a reporté la correction
dans la table ni dans un `appliesWhen`**. Le gate a donc affiché « 40 inertes,
1 VIVANT » pendant deux semaines sur une déclaration que le code ne portait plus.

⚠️ **Un VIVANT qu'on s'habitue à voir cesse d'être un signal.** C'est le même mode
de panne qu'un test rouge toléré.

Corrigé : `flat` porte sa condition sur les **six** matières qui le lisent (trois
cannelures, Martelé, Écorce, Aluminium), et les **huit** autres sont éprouvées une
par une au gate — Poli, Dépoli, Cathédrale et les cinq pavés, toutes inertes.
14 = 6 + 8 : la couverture est complète par construction, aucune n'est masquée
sur une déduction. Le test de `glass` qui gardait `flat` visible partout est
retourné avec sa raison — il avait raison tant que personne n'avait mesuré.

### État de sortie, mesuré

**41 déclarations, 41 inertes, 0 VIVANT** — le gate est propre pour la première
fois. `test:render` rend **aucun écart**, ce qui est le gate discriminant du
ticket : masquer est de l'AFFICHAGE, et un écart aurait prouvé qu'on a touché au
rendu en croyant toucher au panneau.

### La question du point 2, tranchée

**Oui, les effets sans `choices` restent hors du champ, et ce n'est pas une
dette.** Non par acceptation d'une limite du contrat, mais parce que la mesure
retire la prémisse : même les effets qui ONT un mode n'ont rien d'inerte dedans.
Le champ de l'applicabilité n'est pas « 10 % couverts, 90 % à faire » — il est
**couvert**. Ce qui reste hors champ est hors champ parce qu'il n'y a rien à y
mettre, pas parce que la voie A serait trop étroite.

Corollaire pour la suite : **ajouter un mode à un effet pour pouvoir le
conditionner serait l'inverse du geste.** Une condition suit un mode qui existe
pour une raison de rendu ; elle ne le justifie pas.
