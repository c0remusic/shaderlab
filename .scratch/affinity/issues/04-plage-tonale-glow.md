# Plage tonale sur `glow`

Type: task
Status: closed
Parent: ../map.md
Fermé le 2026-08-19 — livré, mais PAS ce que ce ticket décrivait. Lire la
section « Ce que la mesure a changé » avant de croire la version d'origine.

## Ce qui a été livré

Deux paramètres sur `glow` : `shadowHold` (« Retenue des noirs ») et
`shadowHoldPoint` (« Limite des noirs »), en fin de `params[]` (index 4 et 5),
neutres à leur défaut. Le composite additif est devenu :

```wgsl
let porte = mix(1.0, smoothstep(0.0, limite, luma_de_ce_qui_est_dessous), shadowHold);
return vec4<f32>(color.rgb + bloom * (intensity * porte), color.a);
```

Références de pixels : `effet-glow-retenue-temoin` et `effet-glow-retenue`, sur
`mireLampes` — la seule mire du script dont une moitié est DENSE et l'autre
CLAIRE sous des sources identiques. Zéro écart sur les 119 références
existantes.

## Ce que la mesure a changé, et c'est l'essentiel du ticket

Ce ticket disait : « Eux dosent le halo séparément dans les ombres, les tons
moyens et les hautes lumières. Trois plages, chacune avec son mélange et sa
valeur. » **C'était une lecture de noms de symboles, et elle est fausse sur deux
points.**

Mesuré le 2026-08-19 en pilotant leur Bloom par le SDK, sur un escalier de
seize tons unis puis sur une mire à trois bandes de fond avec des sources vives
identiques dans chacune (protocole et chiffres :
[`affinity-plugin-verdict`](../../../docs/design-system/affinity-plugin-verdict-2026-08-19.md)) :

1. **Les trois curseurs ne gatent pas la SOURCE du halo.** Ils décident dans
   quels tons du RECEVEUR la lumière est reposée. Le halo apparaît autour des
   sources de la bande claire et **exactement 0,000 dans la bande dense**, quelle
   que soit la position des trois. Un « dosage par plage de la source » n'existe
   pas dans leur bloom.
2. **Les `*Value`, `Method` et `Strong` ne sont pas dans la structure du SDK.**
   `highlightValue: 0` et `highlightValue: 1` rendent deux fichiers de md5
   identique. Il y a QUATRE champs, pas dix.

Reste vrai et repris : **il y a un plancher**. Sous une certaine densité du
receveur, leur bloom ne fait rien du tout.

## Pourquoi UN axe et non trois

La carte interdit de copier une fonctionnalité sans dire quel geste elle
débloque. Un seul axe suffisait ici, et il a un nom que le module citait déjà :
l'en-tête de `glow.ts` nomme trois filtres de référence depuis toujours —
Pro-Mist, **Black** Pro-Mist, Glimmerglass — et n'en rendait qu'un. Ce qui les
sépare n'est pas un dosage : les particules noires du Black Pro-Mist absorbent
la lumière diffusée qui retomberait dans les zones denses. Un composite purement
additif ne peut rendre que le premier.

Le geste débloqué se dit donc en une phrase : **faire fleurir les hautes
lumières sans délaver les noirs**.

## Ce qui n'a PAS été utilisé, contrairement au plan

`EffectModule.tonalRangeControl` — que ce ticket donnait comme « le mécanisme
existe déjà ». Il décrit QUATRE bornes de plages (shadowsMin/Max,
highlightsMin/Max) pour un contrôle dessiné, et il en faut deux ici. L'utiliser
aurait coûté deux paramètres morts pour réutiliser un widget qui ne dit pas la
même chose.
