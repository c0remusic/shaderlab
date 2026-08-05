# Task 1 — les 39 déclarations « Sans objet », éprouvées

> Livrable de la Task 1 de
> `2026-08-04-rationalisation-des-controles.md`. Mesuré le 2026-08-05 sur la
> vraie fenêtre WebView2, worktree `claude/applicabilite-controles`.
>
> **Ce document ne décide rien.** Il rend le tableau des verdicts, et pose la
> seule question que la mesure a ouverte.

## Le protocole

`node scripts/render-check.mjs --applicabilite` (table :
`scripts/applicabilite-table.mjs`). Pour chaque déclaration, dans **chaque**
configuration où l'infobulle la dit sans objet : trois rendus — la photo de
fond seule, l'effet avec le paramètre au minimum, puis au maximum.

**Deux chiffres, et le second n'est pas décoratif.** « Zéro écart entre min et
max » a deux causes possibles : le curseur est inerte, ou l'effet entier ne fait
rien dans cette configuration. Une sonde qui ne mesurerait que l'écart min/max
rendrait « inerte » sur un effet éteint — le défaut exact que `verifierSignal`
corrige dans le harnais de rendu. Chaque mesure porte donc aussi l'écart de la
configuration **contre la photo seule**, et un signal sous 3 % rend le verdict
**non concluant**, jamais « inerte ».

Deux valeurs choisies aux bornes, sauf quand une **périodicité** les rendrait
égales par construction : `bladeRotation` et `fieldAngle` vont de 0 à 360°, et
0 vs 360 est le même angle — un « aucun écart » y aurait été un artefact du
choix des valeurs. Ces deux-là prennent 0 vs 37°.

## Le résultat

**39 déclarations · 74 configurations · 38 inertes · 1 VIVANT · 0 non
concluant · 0 erreur.**

Aucune configuration n'était limite : le signal le plus faible de toute la
campagne est `lensBlur.fieldAngle` en Radial, à **10,5 %** des canaux — plus de
trois fois le seuil. Le verdict « inerte » repose donc partout sur un effet qui
agissait réellement.

| Effet | Déclarations | Verdict |
| --- | --- | --- |
| `lensFlare` | `ghostFill`, `sensorSpacing` | inertes |
| `lensDistortion` | `centerFalloff`, `centerPresence`, `aberrationAngle` | inertes, en Longitudinale **et** en Anamorphique |
| `lensBlur` | `bladeRotation`, `fieldAngle` | inertes |
| `motionBlur` | `angle`, `centerX` | inertes |
| `glass` | 15 déclarations | 14 inertes, **`flat` VIVANT** |
| `warp` | `centerX` | inerte |
| `hatching` | `waveAmplitude`, `waveFrequency` | inertes |
| `outlines` | 11 déclarations | inertes |
| `gradientMap` | `repeatType` | inerte |

Les 38 inertes peuvent être portées vers `EffectParam.appliesWhen` en Task 2
sans autre examen : leur infobulle dit vrai.

## Le seul VIVANT — `glass.flat`, et ce n'est pas un bug de shader

```
VIVANT  Martele    123 589 canaux (47,145 %), max 179
VIVANT  Ecorce     128 565 canaux (49,044 %), max 248
inerte  Poli · Depoli · Cathedrale · les cinq Pave
```

Vivant sur **exactement les deux matières qui partagent une primitive**, inerte
sur les huit autres. La cause est à `glass.ts:485`, dans la branche
Martelé/Écorce :

```wgsl
let rainure = mix(0.06, 0.40, 1.0 - plat);
```

`plat` y règle **la largeur de la rainure** entre les cellules de Voronoï — et
le commentaire juste au-dessus l'annonce déjà comme l'une des deux constantes
qui distinguent ces matières. **Le shader a raison ; c'est l'infobulle qui
ment.**

### Ce que la mesure a corrigé du plan

Le plan rangeait `glass.flat` en cas de **fusion** : « le contrôle ne disparaît
pas, il change de sens ». C'était juste, et incomplet — il change de sens
**trois** fois, pas deux :

| Matières | Ce que `flat` règle | Documenté ? |
| --- | --- | --- |
| Cannelé simple / croisé / Gaufré | la largeur du méplat entre deux stries | oui |
| Aluminium brossé | la profondeur du brossage | oui |
| **Martelé · Écorce** | **la largeur de la rainure entre cellules** | **non** |

C'est donc pire qu'un contrôle mal rangé : **un contrôle caché par sa propre
documentation.** Un utilisateur qui lit « Sans objet ailleurs » ne touchera
jamais ce curseur en Martelé, et perdra un réglage qui déplace la moitié de
l'image.

⚠️ Et il aurait été **masqué en Task 2** sur la foi de son infobulle, sans que
rien ne rougisse : un curseur qu'on masque ne bouge plus aucun pixel, donc
aucune référence de rendu n'aurait bronché. C'est exactement le scénario que
cette Task 1 existait pour empêcher.

## À trancher avant la Task 2

`flat` porte trois sens sous un seul libellé (« Part plate ») et une seule
infobulle. Trois voies, et c'est un arbitrage de produit :

1. **Libellé et infobulle conditionnels** — le contrôle reste unique, son nom
   et son explication suivent la matière (« Part plate » / « Profondeur du
   brossage » / « Largeur de la rainure »). Le moins cher, et c'est l'exigence
   n°2 du chantier (fusion) prise au mot.
2. **Trois paramètres distincts**, chacun avec sa propre applicabilité. Le plus
   clair à lire — mais deux index de plus dans `params[]`, donc dans les
   presets, pour un shader qui n'a besoin que d'un.
3. **Statu quo documenté** : garder un libellé neutre et corriger seulement
   l'infobulle, qui cesse de dire « sans objet ailleurs ».

Recommandation : **1**. Le shader n'a qu'un besoin, c'est l'affichage qui en a
trois — et le chantier 2 est précisément en train de se doter d'un contrat
déclaratif d'affichage.
