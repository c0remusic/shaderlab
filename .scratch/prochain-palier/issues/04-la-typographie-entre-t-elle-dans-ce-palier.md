# La typographie entre-t-elle dans ce palier

Type: grilling
Status: open
Parent: ../map.md

## Question

Le ROADMAP est catégorique sur le point technique : « `params` est un
`Record<string, number>` parce que l'uniform est `array<f32, 48>` — donc
l'effet qui synthétise ne peut PAS porter une typographie, qui a besoin d'une
**chaîne**. Il bute sur le modèle avant la première ligne de WGSL. » Et : « La
réponse peut donc différer entre formes et typographie ; **les traiter d'un
bloc est le premier piège du chantier**. »

Ce ticket est délibérément SÉPARÉ de
[Une forme a-t-elle besoin de `contentSource`](03-une-forme-a-t-elle-besoin-de-contentsource.md),
et ni l'un ni l'autre ne bloque l'autre : c'est la forme que prend le refus de
ce piège.

**La typographie entre-t-elle dans ce palier, et à quel prix ?**

## Ce qu'il faut interroger

- **Quel besoin, réellement ?** Le cahier de postproduction dit « typographie
  superposée » et « texte calé sur une grille très stricte ». Est-ce du texte
  éditable dans l'app, ou un calque importé depuis un vrai outil de mise en
  page ? Les deux réponses ferment des chantiers entiers, dans des directions
  opposées.
- **La chaîne n'est que le premier mur.** Derrière : le chargement de polices,
  la mise en forme (crénage, ligatures, retour à la ligne), le rendu de glyphes
  sur GPU, et la disponibilité des polices système sur la machine d'un autre.
  Chacun est un chantier. Les nommer avant de décider, pas après.
- **Le raster est une sortie possible.** Un calque photo porte déjà un raster
  et le rend sans rien inventer. Du texte rastérisé une fois, ré-éditable ou
  non, est-il acceptable pour l'usage visé ? C'est exactement le geste qu'a
  fait ADR-0018 pour les textures : un scan est un raster, `imageSource` le
  couvrait déjà, et rien n'a bougé dans `LayerState`.
- **Le coût de dire non maintenant est faible ; celui de dire oui à demi est
  élevé.** Une typographie livrée sans crénage ni polices fiables rendrait
  exactement le « filtre Photoshop 2005 » que ce dépôt proscrit — et la barre
  de qualité du projet est explicite : un effet qui marche mais rend cheap
  n'est pas terminé.

## Une sortie de portée est une réponse valide

Si la conclusion est que la typographie dépasse ce palier, ce ticket **se
clôt en la rangeant dans la section Out of scope de la carte** avec sa raison
écrite — pas dans *Decisions so far*, qui n'enregistre que la route
réellement parcourue. Une frontière de portée n'est pas une étape.
