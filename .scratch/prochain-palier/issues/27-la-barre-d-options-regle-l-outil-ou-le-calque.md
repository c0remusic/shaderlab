# La barre d'options règle-t-elle l'outil ou le calque

Type: grilling
Status: resolved
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

---

## Answer — RÉSOLU le 2026-08-18

**Arbitrage d'Antoine : la barre règle l'OUTIL.** « Le prochain rectangle sera
bleu » — la réponse de Photoshop. Elle résout le défaut d'origine : aujourd'hui
on trace un rectangle NOIR, puis on va chercher sa couleur dans le dock, et
régler avant de tracer est impossible.

**Le coût nommé par le ticket n'est pas dissous, il est BORNÉ.** Deux surfaces
pour une même valeur, c'est ce qu'ADR-0001 refuse en général. Ce qu'un modèle
peut faire — et fait — c'est rendre la frontière **inexprimable autrement** : il
ne connaît AUCUN calque. Il ne reçoit ni pile, ni sélection, ni identifiant, et
son seul canal vers un calque est `paramsPourNouveauCalque`, appelé à la
CRÉATION. Un réglage de barre ne peut donc pas atteindre un calque existant —
pas par discipline, par typage. La tension reste réelle dans l'interface ; elle
ne peut plus devenir un bug.

### Ce qui est LIVRÉ (2026-08-18, en TDD)

`src/ui/toolOptionsModel.ts`, module pur (même convention que `tools.ts` et
`layerControlsModel.ts`), six tests dans `test/ui/toolOptionsModel.test.ts`.

Deux propriétés que la boucle a fait sortir, et qui sont les deux moitiés de
l'arbitrage :

1. **Les réglages PERSISTENT à travers un changement d'outil.** Sans ça, le
   réglage ne survit pas au premier aller-retour vers le pinceau, et la barre
   redevient un doublon du dock placé plus près de la main — c'est-à-dire
   l'autre réponse du ticket, arrivée par accident.
2. **Un calque créé part avec une COPIE.** C'est le test discriminant entre les
   deux réponses : si la valeur appartenait au calque, éditer le calque posé
   changerait ce que le prochain tracé reçoit. Partager l'objet aurait produit
   ce comportement-là sans qu'aucune décision soit prise.

Par outil, et pas un état partagé : la taille du pinceau et la couleur d'une
forme n'ont rien à se dire.

### ✅ La barre est LIVRÉE le même jour, et le défaut est mesuré CORRIGÉ

`src/components/ToolOptionsBar.tsx` — permanente, hauteur constante, contenu
suivant l'outil. `BrushToolbar` n'est plus sa propre barre : elle est devenue le
CONTENU affiché pour le pinceau et la gomme.

**Mesuré dans la vraie fenêtre par CDP, document ouvert, sur les quatre
outils** :

| | avant | après |
| --- | --- | --- |
| haut de la palette, Déplacer → Pinceau | **+75 px** | **0 px** |
| haut de la palette, Déplacer → Forme | non mesuré | **0 px** |
| hauteur de la toile, Déplacer → Pinceau | −75 px | **0 px** |
| hauteur de la barre | 0 puis 75 | **75 px, constante** |

⚠️ **Le prix est réel et il est celui qu'on a accepté** : la toile perd 75 px en
PERMANENCE, y compris sous *Déplacer* qui n'a rien à régler. C'est la voie A, et
la planche l'avait posé — une toile qui se réduit est un arbitrage discutable,
une palette qui bouge sous le curseur n'en est pas un.

### Deux choses trouvées en câblant, aucune par un test

1. **La hauteur constante ne l'était pas au premier jet.** `min-height:
   var(--toolbar-height)` (36 px) laissait *Déplacer* à 45 px contre 75 px pour
   le Pinceau — le défaut réduit, pas corrigé. Un second essai à 68 px laissait
   68 contre 75. La valeur est celle du CONTENU le plus haut plus le padding, et
   elle a dû être MESURÉE. La story `EveryToolKeepsTheSameHeight` rend les quatre
   outils dans le même arbre et compare leurs hauteurs à celle du premier — c'est
   elle qui a attrapé les deux essais.
2. **Le sélecteur de primitive affichait « 0 ».** Le défaut de `borne` dans
   `aplat` vaut 0 — « bornée par le masque », toute la toile — et ce n'est pas une
   primitive qu'un outil de TRACÉ puisse offrir : la valeur était absente de sa
   propre liste de choix. Le défaut de l'OUTIL est donc le rectangle, exactement
   ce que `handleShapeDrawn` écrivait en dur avant. **Trouvé sur une capture, pas
   dans le code** — aucun test ne le regardait, et la story qui le garde
   maintenant a été écrite après.

### Ce qui RESTE

- **Le contenu de la barre pour le pinceau reste celui d'avant** : quatre
  réglages plus Remplir/Vider plus « Quitter la peinture ». Ce dernier bouton
  n'a plus tout à fait le même sens maintenant qu'un outil se quitte par la
  palette ou par `Échap`.
- **Les défauts de couleur de la forme sont ceux d'`aplat`** — teinte 0,
  saturation 0, luminosité 0, c'est-à-dire NOIR. La barre permet enfin de les
  changer avant de tracer, mais le premier rectangle d'une session reste noir
  tant que personne ne décide d'un autre défaut. Question produit, pas technique.
- **`move` porte une phrase d'aide** faute de réglage. Elle occupe la bande, ce
  qui est le comportement voulu ; ce qu'elle DIT peut se discuter.
