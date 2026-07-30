---
id: ADR-0006
status: active
date: 2026-07-30
---

# Le fond d'un export est BLANC

## Contexte

Depuis la tranche T0 du design du 2026-07-28, la chaîne de compositing produit un
alpha droit et une seule passe l'aplatit sur un fond opaque
(`src/render/presentPass.ts`). Le fond est dérivé de la DESTINATION, jamais choisi
par un appelant : damier à l'écran, et jusqu'à cette décision **noir** à l'export
(`presentBackgroundFor`, WGSL `bg = vec3<f32>(0.0)`).

Ce noir n'a jamais été arbitré. Il vient de l'époque où un document était « une
photo qu'on retouche » : la zone non couverte y était un cas dégénéré, et sa
couleur n'intéressait personne. Le chantier « la toile devient un espace de
montage » (design `docs/superpowers/specs/2026-07-29-shaderlab-toile-de-montage-design.md`,
§4.5 et §11.1) change ce statut : dans un collage sur une toile dont le format
n'est celui d'aucune photo, **la zone non couverte est le passe-partout de
l'image finale**. Un collage exporté avec des bandes noires est une décision
esthétique forte, prise par défaut et jamais posée à personne.

La règle du projet (CLAUDE.md global, clause de récidive NG78) impose de poser
une question de goût **avec un rendu en face**. Trois fonds ont été montrés sur un
même collage : noir, blanc, gris moyen.

## Décision

**Le fond d'aplatissement d'un export est le BLANC pur.** Verbatim d'Antoine :
« lecture planche contact, le blanc cadre les images au lieu de les avaler ».

Ce que la décision ne change pas, et qui reste structurel :

- **Le damier reste un rendu d'ÉCRAN et n'atteint jamais un fichier.** La garde
  n'est pas une discipline d'appel mais le type `PresentDestination` (fermé à deux
  cas) plus le mapping unique `presentBackgroundFor` : la taille de case vit dans
  le cas `checker`, que l'export ne peut pas obtenir, donc « une taille de case, à
  l'export » n'est pas exprimable. Cette construction n'est pas affaiblie —
  seul le nom du second cas change (`black` → `white`).
- **`assertOpaqueForJpeg`** (`src/export/exportImage.ts`) reste le second verrou,
  en aval et indépendant.
- **Aucun gamma manuel n'est introduit.** `1.0` est le point fixe de la
  conversion sRGB↔linéaire — la seule valeur qui vaille exactement la même chose
  dans les deux espaces. Le blanc n'a donc rien à décoder, contrairement aux deux
  gris du damier qui passent par `srgb2lin`. La règle projet « jamais de gamma
  manuel sur les couleurs du pipeline » est respectée parce qu'il n'y a rien à
  convertir, pas parce qu'on l'a omis.

## Conséquences

- **Le rendu exporté CHANGE.** Deux références du harnais de rendu ont été
  régénérées, et exactement deux :
  - `toile-vide` : noir uniforme (1 valeur, 100 % noir) → blanc uniforme (1
    valeur, 100 % blanc).
  - `masque-edge-aware-calque-du-bas` : la partie non couverte passe de 66,4 % de
    noir pur à 68,0 % de blanc pur (l'écart de 1,6 point est la frange adoucie du
    masque, qui n'est ni pur noir ni pur blanc).
  Les **sept** autres références sont identiques à l'octet : leurs images sont
  entièrement couvertes par un calque, donc `src.a = 1` partout et
  l'aplatissement y est l'identité, quel que soit le fond. `toile-damier` en
  particulier n'a pas bougé — preuve que le chemin d'écran n'est pas touché.
- Un utilisateur qui exportait un document partiellement couvert obtient
  désormais un fichier différent. C'est l'intention.
- Un collage à dominante claire perd le contraste que le noir donnait au bord de
  l'image. Assumé : le critère retenu est la lecture en planche contact, pas la
  mise en valeur d'une image isolée.
- **Un fond de couleur choisie n'est PAS introduit.** Le fond reste dérivé de la
  destination et non paramétrable : ajouter un paramètre rouvrirait précisément
  la porte que `PresentDestination` ferme. Si un jour un fond réglable est
  demandé, il devra être un CALQUE du document (donc un contenu, pas un réglage
  de présentation) — c'est la forme cohérente avec « toutes les images sont des
  calques » (ADR-0002).

## Alternatives écartées

- **Garder le noir.** Écartée par l'arbitrage, sur rendu. C'était le statu quo et
  personne ne l'avait choisi.
- **Gris moyen.** Montré et écarté : il ne cadre pas les images (trop proche des
  valeurs moyennes d'une photo) et n'a pas la lecture de planche contact.
- **Un fond de couleur paramétrable dans l'interface.** Écartée pour cette
  tranche : elle exigerait de faire redescendre une couleur jusqu'au WGSL par un
  chemin que `PresentDestination` interdit volontairement, pour un besoin que
  personne n'a exprimé.
- **Rendre le damier dans le fichier** (« ce que je vois est ce que j'obtiens »).
  Jamais sur la table : un damier est une convention d'affichage de la
  transparence, pas un contenu.

## Croyances révisées

- Croyance : « le fond d'export est un détail technique, hérité de l'aplatissement
  alpha, sans portée produit ».
  Réfutée par : le chantier montage du 2026-07-29 (§4.5), qui montre que la zone
  non couverte passe de cas dégénéré à sujet de l'image dès qu'une toile n'a plus
  le format d'une photo — et par l'arbitrage d'Antoine du 2026-07-30, qui a
  tranché sur un critère de lecture, pas de technique.
  Ce que ça change : le fond d'export est désormais une décision produit tracée,
  et non une constante à l'intérieur d'un shader.
