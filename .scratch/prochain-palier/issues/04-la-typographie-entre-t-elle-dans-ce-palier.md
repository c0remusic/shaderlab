# La typographie entre-t-elle dans ce palier

Type: grilling
Status: resolved
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

## Answer — HORS PORTÉE, 2026-08-17

Arbitrage d'Antoine, devant la mesure ci-dessous : **« ni l'un ni l'autre pour
l'instant »**. Ni import de PNG comme chantier, ni texte éditable. La typographie
sort du périmètre de cette carte — voir sa section **Out of scope**.

Conformément à ce que ce ticket prévoyait lui-même, la sortie ne va PAS dans
*Decisions so far* : une frontière de portée n'est pas une étape de la route.

### ⚠️ Mais la mesure a renversé la prémisse, et ça, ça reste vrai

Le ROADMAP annonce que la typographie « bute sur le modèle avant la première
ligne de WGSL », parce que `params` est un `Record<string, number>` servi par un
`array<f32, 48>` et ne peut pas porter une CHAÎNE.

**C'est vrai, et hors sujet.** Ce mur ne bloque qu'un *effet qui synthétiserait
des glyphes*. Or le cahier de postproduction n'en demande nulle part : ses quatre
mentions de typographie décrivent toutes ce qu'on fait SUBIR à un texte déjà
composé —

- §384 : « typographie transformée avec `Warp` ou `Displacement Map` », en
  `Multiply` / `Screen` / `Overlay`, masquée par les volumes du sujet ;
- §391 : « une displacement map créée à partir de la photo aide le texte à
  suivre les volumes » ;
- §213 et §445 : des ZONES réservées au texte, jamais le texte ;
- §441 : « textes utilisés comme prolongement du cadre ».

### Ce que la mesure établit, et qui vaut indépendamment de l'arbitrage

**Un PNG à alpha s'importe et se compose DÉJÀ, sans une ligne de code.** Vérifié
dans la vraie fenêtre le 2026-08-17 : un PNG 2400×900 portant du texte blanc sur
fond transparent, importé par `importPhotoByPath`, rend son texte sur la photo
avec le transparent qui laisse passer le fond — et le calque porte ses poignées,
donc il se déplace, tourne, se redimensionne, et tout effet s'empile dessus.

La chaîne le supportait déjà de bout en bout : `createImageBitmap` RENIFLE le
format (l'étiquette `image/jpeg` posée sur le Blob dans `App.tsx` est ignorée),
la texture est en `srgbFormat` donc à quatre canaux, et `photoLayerInput` écrit
déjà la couverture dans l'alpha.

⚠️ **Le seul blocage est un filtre de trois mots, et il est INCOHÉRENT avec
lui-même** : `pick_image_file` (`src-tauri/src/lib.rs:120`) filtre sur
`["jpg", "jpeg"]`, donc le bouton « Ouvrir une image » refuse un PNG — alors que
le glisser-déposer n'a AUCUN filtre (`Canvas.tsx:380`) et l'accepte. Deux chemins
d'entrée pour la même chose, deux réponses différentes.

Ce défaut n'est pas de la typographie et ne sort donc PAS avec elle : il touche
tout PNG à alpha, scan, logo ou masque importé. Il est ticketé à part —
[Le sélecteur de fichier refuse ce que le glisser-déposer accepte](26-le-selecteur-refuse-ce-que-le-glisser-depose-accepte.md).

## Une sortie de portée est une réponse valide

Si la conclusion est que la typographie dépasse ce palier, ce ticket **se
clôt en la rangeant dans la section Out of scope de la carte** avec sa raison
écrite — pas dans *Decisions so far*, qui n'enregistre que la route
réellement parcourue. Une frontière de portée n'est pas une étape.
