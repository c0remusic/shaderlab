# Porter nos effets dans Affinity plutôt que construire shaderlab ?

Question d'Antoine, posée deux fois, le 2026-08-19. Répondue par MESURE sur le
SDK Affinity réel (MCP `affinity`, Affinity 3.2.3.4646 Win32), pas par opinion.

## Réponse courte

**Non, et ce n'est pas un jugement de goût : le SDK d'Affinity est une API
d'AUTOMATISATION, pas une API de PLUGIN.** On peut lui faire faire ce qu'Affinity
sait déjà faire. On ne peut pas lui ajouter une opération par pixel à une vitesse
utilisable.

## Les trois constats, dans l'ordre où ils tombent

### 1. Aucune API de shader. Le seul accès aux pixels est UN PIXEL À LA FOIS

`pixelaccessor.js` expose vingt classes, toutes bâties sur exactement deux
méthodes :

```js
readPixel(x, y)
writePixel(x, y, rgba)
```

Pas d'accès buffer, pas de `TypedArray`, pas de GLSL, pas de WGSL, pas de compute.
Nos vingt-sept effets sont du WGSL qui échantillonne des textures — il n'y a rien
en face pour les recevoir.

### 2. Les seuls effets scriptables sont les DIX effets de calque intégrés

`layereffects.js`, liste complète : `GaussianBlur`, `OuterShadow`, `InnerShadow`,
`OuterGlow`, `InnerGlow`, `Outline`, `ColourOverlay`, `GradientOverlay`,
`BevelEmboss`, `PhongBevel`.

C'est la famille « styles de calque » de Photoshop. Aucun recoupement avec ce que
nous faisons : ni grain, ni halation, ni tramage, ni trame CMJN, ni verre, ni
courbes par canal, ni flare, ni aberration.

⚠️ **CE PARAGRAPHE ÉTAIT FAUX ET IL EST CORRIGÉ CI-DESSOUS** (2026-08-19, le
soir même). Il disait : « les LIVE FILTERS d'Affinity — ses filtres non
destructifs, ceux qui font le vrai travail de pixels, et qui sont sur GPU —
n'apparaissent nulle part dans l'API `Document`. Même les siens ne sont pas
pilotables. Le SDK ne donne accès qu'aux styles de calque. »

> **Le SDK pilote une trentaine de filtres et une vingtaine d'ajustements.** Ils
> ne sont pas des méthodes de `Document` — ils sont des `DocumentCommand`
> passées à `doc.executeCommand()`, et ils vivent dans `commands.js`, un autre
> fichier du même SDK : `createBloomFilter`, `createLensBlurFilter`,
> `createHalftoneFilter`, `createVoronoiFilter`, `createSetCurvesAdjustmentParameters`,
> `createSetBlendRanges`, `createDetectDepth`… Liste complète dans
> [`affinity-plugin-verdict`](affinity-plugin-verdict-2026-08-19.md).
>
> ⚠️ **QUATRIÈME conclusion tirée d'une absence dans ce fil**, même mécanique que
> les trois autres : j'avais listé l'API `Document`, je n'y avais pas trouvé de
> filtre, j'en avais conclu que le SDK n'en avait pas. La liste des fichiers du
> SDK était sous les yeux depuis le début — `commands.js` y était.
>
> **C'est l'erreur qui a coûté le plus cher du fil**, parce qu'elle fermait le
> seul instrument capable de répondre honnêtement à la question d'Antoine :
> piloter leurs filtres, relire les pixels, comparer aux nôtres. Le verdict du
> ticket 12 en sort entièrement, et deux améliorations de nos effets avec.
>
> Ce qui reste vrai du paragraphe d'origine : **les filtres du SDK sont
> DESTRUCTIFS**. Ils écrivent dans le raster, l'annulation les nomme
> (« Croissance », « Demi-ton »), et aucun calque de filtre n'apparaît dans
> l'arbre du document. Le chemin LIVE, lui, n'est toujours pas pilotable.

### 3. Le coût par pixel, mesuré

Mesure du seul ALLER-RETOUR du pont JS → natif, sur l'appel le plus creux
possible (`app.majorVersion`, un simple entier) — donc une **borne inférieure**
que tout traitement par pixel paiera, deux fois, avant même de calculer quoi que
ce soit :

```
200 000 appels natifs        20 ms      ->  0,100 us par appel
boucle JS pure (temoin)       1 ms      ->  20x moins : c'est bien le pont qu'on mesure
```

Extrapolé à une photo de 26 Mpx, **une seule passe**, lire + écrire :

| | |
| --- | --- |
| Plancher Affinity par script | **5,2 s** |
| shaderlab, pile complète mesurée sur 26 Mpx | **63 ms** (15,9 images/s) |
| Rapport | **~83×**, et c'est le cas le plus favorable |

Pourquoi « le plus favorable » : `readPixel` rend une structure de pixel, plus
cher qu'un getter d'entier ; nos effets font jusqu'à seize prélèvements par pixel
(diffusion du verre) ; `outlines` en mode Échos fait neuf passes de pyramide ; et
shaderlab compose la pile à chaque frame pendant qu'on tire un curseur.

Un curseur temps réel demande ~16 ms. Le plancher est à 5 200 ms.

## Ce que la question avait de juste

Elle n'était pas absurde, et deux choses la rendaient raisonnable :

- **Affinity fait déjà tout ce que shaderlab n'est pas** — calques, masques,
  historique, export, gestion couleur, texte, vecteur. Tout ce travail-là est
  effectivement du travail refait.
- **Le SDK est riche** : il pilote les calques, les sélections, les macros, les
  snapshots, l'export, et même des API d'IA (`generateImage`,
  `generativeEditImage`, `removeBackground`, `selectSubject`).

Ce qu'il ne sait pas faire, c'est précisément la SEULE chose que shaderlab
apporte : exécuter nos shaders.

## ⚠️ Ce que ce relevé n'a PAS vérifié

À vérifier avant de traiter la réponse comme définitive :

- **Un SDK natif C++ séparé.** Ce relevé ne couvre que le SDK JavaScript exposé
  par le MCP. Si Serif/Canva publie une API de plugin native, la réponse peut
  changer — c'est la seule porte qui reste, et elle n'a pas été cherchée.
- **Le format de macro** (`importMacro` / `exportMacro`). Une macro Affinity
  enchaîne des filtres INTÉGRÉS ; ça ne porte pas un shader, mais ça n'a pas été
  regardé en détail.
- Le débit réel de `readPixel` lui-même, non mesuré : la borne ci-dessus le
  sous-estime, elle ne le mesure pas.

## La question qui reste ouverte, et qui n'est pas celle-là

Ce relevé répond à « peut-on porter nos effets dans Affinity ? » — non. Il ne
répond PAS à « shaderlab doit-il refaire un éditeur complet ? ». Celle-là reste
entière, et le relevé la rend même plus vive : tout ce qu'Affinity fait déjà
bien — masques, historique, gestion couleur, export — est du travail que
shaderlab refait pour pouvoir montrer ses shaders.
