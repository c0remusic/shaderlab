---
id: ADR-0005
status: active
date: 2026-07-29
---

# Rattachement d'un effet à sa photo : la PROXIMITÉ, pas la vérité littérale

## Contexte

L'imbrication des effets sous leur photo a été livrée le 2026-07-28
(`src/components/layerTree.ts`). Elle reposait sur une règle de **vérité
littérale** : une ligne n'était imbriquée que quand la relation « cet effet
s'applique à cette photo » était exacte. Un effet non écrêté s'appliquant en
réalité à tout le composite sous lui, il ne s'imbriquait donc que s'il n'y avait
**qu'une seule** photo plus bas ; deux photos ou plus, il restait racine.

Constat d'Antoine sur la vraie fenêtre le 2026-07-29 :

> « Je vois toujours les effets affichés randomly, plutôt qu'en arborescence
> liés à leur photo importée »

Sur son document — fond `DSCF5160.JPG` + `Glow` + `Grain` + photo importée
`DSCF5160-edited.JPG` + `Chromatic bleed` écrêté — **une seule ligne sur quatre**
était indentée. `Glow` et `Grain` avaient **zéro** photo sous eux, la photo de
fond n'étant pas un `LayerState` (`src/layers/photoLayer.ts:3-5`) : ils restaient
racine. Seul l'écrêté nommait sa base.

La règle était exacte et illisible. C'est la troisième fois qu'Antoine
redemandait l'arborescence.

## Décision

**Un effet appartient à la photo qui le précède dans la chaîne.** Une photo ouvre
son groupe ; tous les effets qui suivent lui appartiennent jusqu'à la photo
suivante. En espace modèle (indice supérieur = calque du dessus) : le parent de
`layers[i]` est la photo d'indice le plus élevé strictement inférieur à `i`.

Deux clauses indissociables :

1. **Le fond du document compte comme photo parente.** Les effets sous lesquels
   aucun calque photo n'existe lui sont rattachés — c'est littéralement vrai,
   ils s'appliquent bien à lui. Le fond n'étant pas un `LayerState`, son identité
   arrive en **paramètre** (`BACKGROUND_LAYER_ID`, `toLayerTreeRows(layers,
   backgroundId)`), jamais devinée par le module. Seul l'ID est demandé : le nom
   d'affichage reste la propriété du panneau, qui le rendait déjà
   (`backgroundName`) — l'exiger ici ferait porter à l'interface une donnée
   qu'elle ne lit pas.
2. **L'écrêtage garde la priorité.** Un effet écrêté nomme explicitement sa base
   (`clipBaseId`) et ce rattachement l'emporte sur la proximité. Sauf écrêtage
   `inert` (aucune base photo), où l'on retombe sur la proximité : une ligne ne
   désigne jamais une base inexistante.

C'est un changement d'**affichage uniquement**. L'ORDRE des lignes reste
exactement `toDisplayOrder(layers)` — l'imbrication est une profondeur portée par
la ligne, jamais un tri —, donc `data-layer-row-index`,
`displayInsertToModelInsert` et le glisser-déposer sont inchangés (verrouillé par
`test/components/layerTree.test.ts`, dont les six cas de déplacement).

## Conséquences

- **L'imbrication ne dit plus tout à fait la vérité, et c'est assumé.** Un effet
  non écrêté s'applique à tout le composite sous lui, pas à cette seule photo :
  l'affichage privilégie désormais la **lisibilité du groupe** sur l'exactitude
  littérale. La nuance est consignée en tête de `src/components/layerTree.ts`
  avec l'ordre explicite de ne pas la « corriger ».
- Sur un document ouvert, **toute ligne d'effet est désormais imbriquée** : il y a
  toujours au moins le fond au-dessus d'elle. Une ligne d'effet racine ne
  s'observe plus que sans document.
- Les groupes restent **contigus**, donc les bornes du filet (`firstChild` /
  `lastChild`) se calculent toujours en comparant au voisin immédiat : la règle
  découpe la pile en tranches, et `clipBaseId` ne peut désigner que la photo de
  la tranche courante (une photo est terminale, `src/layers/clipping.ts`).
- Le groupe du fond commence à la première ligne de la liste ; son filet remonte
  jusqu'à la ligne d'arrière-plan, qui l'ouvre depuis l'ADR-0004.

## Alternatives écartées

- **Garder la vérité littérale et signaler la portée réelle** (badge « s'applique
  à tout le composite », libellé de portée). Rejeté : Photoshop ne signale jamais
  le cas normal, et le problème rapporté est qu'on ne LIT pas les groupes — y
  ajouter un marquage aggrave la densité que l'ADR-0001 cherche à réduire.
- **Faire du fond un vrai `LayerState`** pour qu'il tombe sous la règle générale
  sans clause particulière. C'est la tranche T1 du design « le fond devient un
  calque », qui touche le pipeline (`sourceTexture`), l'export et l'historique —
  disproportionné pour un défaut d'affichage, et cette décision-ci n'y fait pas
  obstacle : le jour où le fond sera un calque, la clause 1 disparaîtra
  d'elle-même et `BACKGROUND_LAYER_ID` avec elle.
- **Deviner le fond dans `layerTree`** (par exemple en traitant `null` comme
  « il y a toujours un fond »). Rejeté : le module ne peut pas savoir si un
  document est ouvert, et un rattachement à un parent qui n'est pas rendu
  produirait un filet vers le vide.

## Croyances révisées

- Croyance : une relation affichée doit être littéralement vraie, sinon elle
  ment ; le prix à payer est que certaines lignes restent à plat.
  Réfutée par : le document réel d'Antoine le 2026-07-29 — une ligne indentée
  sur quatre, et trois demandes successives d'arborescence. Une règle exacte qui
  ne produit pas la lecture attendue n'informe personne.
  Ce que ça change : sur une question de LECTURE, l'exactitude n'est pas le
  critère terminal ; elle se pèse contre la lisibilité, et l'écart se documente
  au lieu d'être arbitré en silence.
