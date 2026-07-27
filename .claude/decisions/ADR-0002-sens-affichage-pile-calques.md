---
id: ADR-0002
status: active
date: 2026-07-27
---

# Sens d'affichage de la pile de calques

## Contexte

Le modèle de shaderlab est une chaîne de traitement : `framePipelineExecutor`
part de `readTexture = sourceTexture` (la photo du document) et boucle sur les
calques **dans l'ordre du tableau**. `layers[0]` est donc le calque appliqué en
premier, directement sur la photo — le **bas** de la pile.

`LayerPanel` rendait `layers.map(...)` tel quel : `layers[0]` était la
**première** ligne, en haut. La liste affichait donc le bas de pile en haut,
l'inverse de tous les éditeurs d'images.

Ce n'était pas visible tant que la liste ne contenait que des effets — rien à
l'écran ne disait à quel bout se trouvait la photo. L'ajout de la ligne
d'arrière-plan l'a rendu manifeste : elle fermait la liste par le bas alors
qu'elle alimente `layers[0]`, affiché tout en haut, à l'extrémité opposée.

## Décision

**Sens Photoshop.** Le premier effet appliqué apparaît juste au-dessus de
l'arrière-plan, en bas de la liste. La liste est le **miroir** du tableau.

C'est un changement d'**affichage uniquement**. Le modèle ne bouge pas :
`layers[0]` reste le calque appliqué en premier. Le pipeline, `LayerStack`,
les presets et l'historique sont inchangés.

La conversion affichage ↔ modèle vit dans **un seul module pur et testé**,
`src/components/layerDisplayOrder.ts` — jamais dispersée dans le composant. Le
glisser-déposer en dépend, et un calque qui atterrit au mauvais endroit est
pire que pas d'inversion du tout.

Corollaire retenu : le glisser-déposer raisonne **entièrement en espace
d'affichage** (le hook de réordonnancement reçoit la liste affichée,
`data-layer-row-index` porte l'index de ligne). Les indicateurs avant/après
gardent donc leur sens visuel sans traitement particulier, et une seule
frontière convertit — à la sortie du hook.

## Conséquences

- La flèche d'écrêtage désigne le calque de base, celui du **dessous** dans la
  pile ; ce calque est désormais aussi celui du dessous dans la liste, donc la
  flèche pointe vers le **bas**.
- Toute story ou tout test qui indexe une ligne par sa position lit la pile à
  l'envers du tableau : `rows[0]` est `layers[length - 1]`.
- La ligne d'arrière-plan ferme la liste **sous** le calque qu'elle alimente.
- L'ordre de tabulation suit l'ordre du DOM, donc l'ordre visuel : rien à
  inverser de ce côté. Aucun raccourci clavier de réordonnancement n'existe
  dans le projet à cette date.
- Tout code qui voudrait afficher la pile ailleurs (export, aperçu, futur
  panneau) doit passer par `layerDisplayOrder.ts` plutôt que recopier un
  `reverse()` : c'est la seule façon de garder un sens unique.

## Alternatives écartées

- **Garder le sens du tableau et déplacer la ligne d'arrière-plan en haut.**
  Cohérent en interne, mais inverse de toutes les références du domaine :
  l'utilisateur vient de Lightroom et Photoshop, pas de notre tableau.
- **Inverser le modèle** (faire de `layers[0]` le haut de pile). Touche le
  pipeline, les presets et l'historique pour un problème d'affichage —
  disproportionné, et chaque document de preset déjà écrit deviendrait faux.
- **Convertir les index dans le composant, au fil des besoins.** C'est le
  chemin par lequel un dépôt finit une ligne à côté : la conversion se
  dédouble, les deux copies divergent, et rien ne la teste.

## Croyances révisées

- Croyance : la flèche d'écrêtage doit s'afficher dès que `clipToBelow` est
  posé sur le calque.
  Réfutée par : `resolveClipping` (`src/layers/clipping.ts`) rend `inert` un
  calque écrêté sans base photo en dessous — il rend alors linéairement, comme
  un calque non écrêté. Constaté en revue le 2026-07-27 sur un calque écrêté
  en bas de pile.
  Ce que ça change : la flèche reflète l'état **résolu**, pas la présence de
  l'attribut. L'attribut reste posé et décochable ; seul l'affichage suit.
