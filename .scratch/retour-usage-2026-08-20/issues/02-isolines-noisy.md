Type: task
Status: resolved

## Résolution (2026-08-21)

Diagnostic au pixel sur photo (DSCF5169) : le bruit est le grain JPEG, MAIS l'algo
de lissage était structurellement incapable de le dompter — 4 taps en croix ne
moyennent que 4 échantillons (bruit /√4 = /2), donc un semis poivre-et-sel
subsistait À TOUS les réglages, même smoothing au maximum. Ce n'était pas qu'un
défaut mal calé.

Antoine, mid-session : « ça peut être sympa le bruit mais il faut que ce soit
optionnel ». → ne pas tuer le grain, le rendre optionnel.

Livré : le curseur `Lissage du relief` devient une **grille gaussienne 5×5**
(25 taps, bruit /√25 = /5). Le curseur n'ajoute aucun tap, il ÉCARTE la grille :
- bas de course (0.5–2) → grille sub-pixel → grain rendu quasi intact (« sympa »),
- haut de course (12–24) → vrai lissage → carte nette (capacité qui n'existait pas).
Le grain est donc optionnel dans les deux sens. Ton lissé ET gradient sur le même
voisinage (invariant du fichier préservé) ; gradient par différence centrée des
colonnes extrêmes → échelle EXACTE, `largeursDeTraits` reste vert (l'épaisseur du
trait ne dérive pas). Défaut `smoothing` 3→12 (premier contact = carte lisible ;
la plainte « très noisy » était au défaut). Références isolines régénérées
(26/25 valeurs), périmètre git = 2 PNG. Gates verts : tsc, gpu-shader-check,
test:render, test (2099), lint.

⚠️ Le DÉFAUT (12) est un choix d'ergonomie, pas mesuré beau — à confirmer/ajuster
par Antoine devant l'app.

## Question

`isolines` (courbes de niveau du ton) est « très sympa mais très noisy » (retour
d'Antoine). Peut-on réduire le bruit sans perdre le trait ?

Nature probable : les isolignes suivent le ton pixel par pixel, donc le grain du
JPEG fait onduler/fragmenter chaque courbe. Candidats de calibration à MESURER
avant de trancher (même discipline que sliceShift/outlines) :
- un pré-lissage du ton avant extraction des courbes (passe-bas), avec un curseur
  ou un défaut plus élevé s'il existe déjà ;
- l'épaisseur/le seuil des courbes ;
- vérifier si un paramètre de lissage existe et est mal calibré par défaut.

Calibration → livrable de code (le ticket porte l'exécution). Si le rendu change,
régénérer la/les référence(s) isolines et relire à l'œil. Confirmer au pixel sur
l'app d'abord (est-ce le grain, ou l'algo ?).
