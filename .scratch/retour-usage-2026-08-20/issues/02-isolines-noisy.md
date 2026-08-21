Type: task
Status: open

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
