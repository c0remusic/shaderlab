# La barre d'options règle-t-elle l'outil ou le calque

Type: grilling
Status: open
Parent: ../map.md

## Question

Ouvert le 2026-08-17, après l'ajout de l'outil **Forme** et la question d'Antoine
(« niveau layout tu as prévu quoi ? On peut wireframe peut-être ? »). Planche :
[`docs/wireframes/barre-options-outil.html`](../../../docs/wireframes/barre-options-outil.html).

**La barre d'options règle-t-elle l'OUTIL — donc le prochain tracé — ou le CALQUE
sélectionné ?**

## Ce que la planche a établi, et qui n'est plus à décider

**La barre d'options existe déjà et ne sert qu'un outil sur quatre.**
`BrushToolbar` se décrit elle-même comme « barre d'options du pinceau (style
barre d'outils Photoshop) ». Le pinceau et la gomme la partagent ; *Déplacer* et
*Forme* n'ont rien.

**Et elle a un défaut mesuré** dans la vraie fenêtre à 1280 × 720, en passant de
*Déplacer* au *Pinceau* :

| | Déplacer | Pinceau | écart |
| --- | --- | --- | --- |
| haut de la toile | y 57 | y 132 | +75 px |
| hauteur de la toile | 663 | 588 | −75 px (−11,3 %) |
| **haut de la palette d'outils** | **y 73** | **y 148** | **+75 px** |

Le troisième chiffre est le défaut. Une toile qui se réduit est un arbitrage
discutable ; **une palette d'outils qui se déplace de 75 px au moment où on
clique dedans** n'en est pas un. On choisit un outil, la rangée de boutons glisse
sous le curseur, et le suivant n'est plus là où on pointait — c'est la seule
surface dont la position doit être stable, puisque c'est ce à quoi elle sert.

La planche écarte donc **B** (une barre par outil : reconduit le défaut et
l'empire, les hauteurs différant d'un outil à l'autre) et **C** (les options dans
le dock : loin du geste, et la colonne est déjà sous budget — ADR-0001).

## Ce qui reste, et c'est un vrai arbitrage

La voie **A** — une barre permanente à hauteur constante dont le contenu suit
l'outil — demande de répondre à une question que Photoshop tranche sans le dire :

**Une valeur réglée dans la barre appartient à quoi ?**

- **À l'OUTIL.** « Le prochain rectangle sera bleu. » C'est la réponse de
  Photoshop. Elle permet de régler AVANT de tracer — ce qui est aujourd'hui
  impossible : on trace un rectangle noir, puis on va chercher sa couleur dans
  le dock. ⚠️ Mais elle crée **deux surfaces pour une même valeur** : la barre
  règle le prochain tracé, le dock règle le calque déjà posé. C'est exactement ce
  qu'ADR-0001 refuse.
- **AU CALQUE sélectionné.** Une seule surface, la règle est sauve — mais on ne
  peut plus rien régler avant de tracer, et la barre devient un doublon du dock
  placé plus près de la main. Le problème d'origine revient entier.

## Ce que ce ticket doit produire

Pas seulement « A », qui est acquis. **La réponse à la question ci-dessus**, et
avec elle ce que la barre porte pour chacun des quatre outils — dont *Déplacer*,
qui n'a rien à régler aujourd'hui et occuperait quand même la bande.

⚠️ Ce que la planche ne tranche PAS et qu'il ne faut pas y chercher : le CONTENU
de la barre pour *Forme*. « Fond, contour, primitive, angle » est ce que
Photoshop y met, mais notre contour n'existe pas (écarté par Antoine le
2026-08-17) et notre `aplat` porte un dégradé que Photoshop n'a pas dans sa
barre. Le contenu se décide après la structure.

## Lien avec le reste de la carte

Voisin de [Les outils sur la toile](17-les-outils-sur-la-toile.md) — troisième
front du chantier des contrôles — mais distinct : le 17 porte sur ce qu'on
manipule SUR l'image (poignées, `CanvasControl`), celui-ci sur ce qu'on règle
AUTOUR d'elle. Ils ne se bloquent pas.
