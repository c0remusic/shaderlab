---
id: ADR-0004
status: active
date: 2026-07-28
---

# Sens causal de la pile de calques

Supersede [ADR-0003](ADR-0003-sens-affichage-pile-calques.md), qui avait retenu
le sens Photoshop la veille.

## Contexte

Le modèle de shaderlab est une chaîne de traitement : `framePipelineExecutor`
part de `readTexture = sourceTexture` (la photo du document) et boucle sur les
calques **dans l'ordre du tableau** (`src/render/framePipelineExecutor.ts:230-232`).
`layers[0]` est donc le calque appliqué en premier, directement sur la photo.

L'ADR-0003 avait fait de la liste le **miroir** de ce tableau, par convention
d'éditeur d'images. Les deux sens ont été mis côte à côte et regardés le
2026-07-28. Antoine a tranché sur ce qu'il voyait :

> « causal je pense, la photo ne traite rien, c'est les effets qui traitent la
> photo »

L'effet est l'agent, la photo est la matière. La matière vient avant
l'opération : c'est le modèle mental de l'utilisateur de cet outil, et il ne
coïncide pas avec la convention Photoshop.

## Décision

**Sens causal.** La liste se lit de haut en bas dans l'ordre du TRAITEMENT. La
photo d'abord, puis les effets qui s'appliquent dessus. La liste est l'ordre
**direct** du tableau.

C'est un changement d'**affichage uniquement**, exactement comme l'ADR-0003. Le
modèle ne bouge pas : `layers[0]` reste le calque appliqué en premier
(`src/layers/layerStack.ts`). Le pipeline, `LayerStack`, les presets et
l'historique sont inchangés.

La conversion affichage ↔ modèle reste dans **un seul module pur et testé**,
`src/components/layerDisplayOrder.ts`. Ce corollaire de l'ADR-0003 est
intégralement reconduit, et il vient de prouver sa valeur : ce second
changement de sens en deux jours n'a touché qu'une fonction et les commentaires
qui l'entourent.

Ces trois fonctions sont aujourd'hui l'**identité**, et elles restent en place.
Les inliner parce qu'elles ne calculent plus rien serait supprimer la frontière
au moment précis où l'historique démontre qu'elle sert. Un `reverse()` ou un
calcul d'index de ligne ailleurs dans le code reste un bug.

## Conséquences

- La ligne d'arrière-plan **ouvre** la liste par le haut : elle alimente
  `layers[0]`, la ligne juste en dessous d'elle.
- Dans l'arbre de rattachement, une photo est **au-dessus** de ses effets
  rattachés. `layerParentIds` (`src/components/layerTree.ts`) est inchangé : il
  raisonne en espace modèle et ignore le sens vertical.
- `firstChild`/`lastChild` sont des bornes de **position** dans la liste, pas
  des rôles. Le calcul est direction-agnostique et n'a pas bougé, mais c'est
  désormais `firstChild` qui touche la photo parente : les deux règles CSS du
  filet (`.layer-panel__rail--first` / `--last`, `src/components/LayerPanel.css`)
  ont été échangées.
- La flèche d'écrêtage désigne la base, appliquée **avant**, donc la ligne du
  **dessus** : `CornerLeftDown` devient `CornerLeftUp`. Les libellés suivent ce
  que l'utilisateur voit — « Écrêté sur le calque du dessus » (`LayerPanel`) et
  « Écrêter sur la photo du dessus » (`ParamPanel`).
- **Un calque ajouté apparaît EN DESSOUS de la sélection**, et c'est voulu.
  `insertIndexAfter` (`src/layers/layerStack.ts:63-67`) insère à `index + 1`,
  c'est-à-dire *appliqué après* le calque sélectionné — en sens causal, plus
  bas dans la liste. Cela surprendra quiconque vient d'un éditeur classique, où
  « ajouter au-dessus » veut dire plus haut à l'écran. Ce n'est pas un défaut à
  corriger : l'ordre d'application n'a pas changé, seule sa lecture a changé de
  sens. Le corriger reviendrait à insérer *avant* la sélection, donc à casser
  « le nouvel effet traite ce que je viens de sélectionner ».
- Toute story ou tout test qui indexe une ligne par sa position lit désormais la
  pile dans l'ordre du tableau : `rows[0]` est `layers[0]` (c'était
  `layers[length - 1]` sous l'ADR-0003).
- L'ordre de tabulation suit l'ordre du DOM, donc l'ordre visuel : rien à
  inverser de ce côté. Aucun raccourci clavier de réordonnancement n'existe dans
  le projet à cette date.

## Alternatives écartées

- **Garder le sens Photoshop de l'ADR-0003.** C'est l'option renversée ici. Son
  motif d'origine — l'utilisateur vient de Lightroom et Photoshop — est caduc :
  l'[ADR-0002](ADR-0002-abandon-round-trip-lightroom.md) a acté l'abandon du
  round-trip Lightroom, et l'utilisateur affirme un modèle mental différent
  après avoir vu les deux. Le modèle mental de l'utilisateur prime sur la
  convention d'un autre logiciel.
- **Inverser le modèle** (faire de `layers[0]` le haut de pile). Touche le
  pipeline, les presets et l'historique pour un problème d'affichage —
  disproportionné, et chaque document de preset déjà écrit deviendrait faux.
  Écartée par l'ADR-0003, écartée à nouveau ici pour les mêmes raisons.
- **Supprimer `layerDisplayOrder.ts` puisque la conversion est l'identité.**
  Économie apparente de trois fonctions, perte réelle de la seule frontière
  nommée du sens d'affichage — que ce dépôt a déjà changé deux fois.
- **Convertir les index dans le composant, au fil des besoins.** Inchangé
  depuis l'ADR-0003 : c'est le chemin par lequel un dépôt finit une ligne à
  côté.

## Croyances révisées

- Croyance : le sens d'affichage de la pile se déduit des conventions du domaine
  (Photoshop, Lightroom), donc la question est tranchée par la référence.
  Réfutée par : la décision d'Antoine du 2026-07-28, prise après avoir vu les
  deux sens côte à côte — « la photo ne traite rien, c'est les effets qui
  traitent la photo ». La référence a été retenue le 2026-07-27 (ADR-0003) et
  renversée le lendemain.
  Ce que ça change : sur une question de lecture d'interface, la convention du
  domaine est une hypothèse à montrer, pas une conclusion. Un sens d'affichage
  se décide sur pièce, en regardant les deux.

- Croyance : l'argument « l'utilisateur vient de Lightroom et Photoshop » est un
  motif durable pour aligner shaderlab sur ces outils.
  Réfutée par : l'ADR-0002 (abandon du round-trip Lightroom) l'avait déjà vidé
  de sa substance au moment où l'ADR-0003 s'en est servi, le 2026-07-27.
  Ce que ça change : un motif qui s'appuie sur un ADR antérieur doit être
  revérifié contre le statut de cet ADR avant d'être invoqué. `INDEX.md` porte
  le statut pour cette raison.

- Croyance : une conversion réduite à l'identité peut être inlinée sans perte.
  Réfutée par : le témoin du 2026-07-28 — la conversion sabotée fait échouer les
  six cas de déplacement, ce qui n'est vérifiable que parce qu'elle est une
  fonction nommée et testée séparément.
  Ce que ça change : la frontière survit à sa propre trivialité.
