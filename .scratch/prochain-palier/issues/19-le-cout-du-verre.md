# Le coût du verre, mesuré et jamais instruit

Type: task
Status: open

## Question

`glass` est de loin l'effet le plus cher du registre, et personne ne l'avait
mesuré. Combien coûte-t-il réellement, et que peut-on lui retirer sans lui
retirer ce qui le rend crédible ?

## Ce qui l'ouvre

Antoine, le 2026-08-13, devant l'app : « tout est super laggy c'est normal ? »
— en regardant un Pavé quadrillé. Non, ce n'est pas normal.

## Mesuré

Build de développement, photo de 26 Mpx, Pavé quadrillé, vrai glissement souris
à 125 Hz sur le premier curseur du panneau :

| Diffusion | Cadence |
| --- | --- |
| 16 prélèvements (poussés puis annulés le jour même) | **10,0 images/s** |
| 9 prélèvements | **15,9 images/s** |

Les 16 taps coûtaient donc **37 %** — annulés aussitôt, la spirale isotrope
étant conservée à 9 taps (c'est elle qui corrige le grain du Dépoli, et elle ne
coûte rien de plus que l'ancien étalement sur un axe).

**Mais 15,9 images/s est déjà le problème, et il est antérieur.** Ordre de
grandeur par pixel, sur un pavé : ~9 lectures pour la diffusion, 3 pour la
dispersion, **5 pour l'ambiance du mortier** — près de 450 millions de lectures
de texture par image à 26 Mpx.

⚠️ **Mesuré en DÉVELOPPEMENT, où le plancher est 2,6× celui de la production**
(15,4 ms contre 6,2 ms de travail synchrone par événement). La règle payée le
même jour sur le ticket 07 s'applique : une mesure en dev prouve qu'un coût
existe, jamais qu'il est négligeable — et ici elle ne sert qu'à établir
l'existence. **Le chiffre en production reste à prendre**, et c'est la première
chose à faire.

## Pistes, non instruites

- **L'ambiance du mortier** : cinq `verre_lire` par pixel pour une moyenne
  très basse fréquence, recalculée à chaque pixel du joint. Un niveau de mipmap
  grossier donnerait la même valeur en une lecture.
- **La diffusion** : neuf lectures pleine résolution pour un flou. Un mipmap
  choisi selon le rayon de diffusion ferait le même travail en deux ou trois.
- **Le coût est-il payé quand il ne sert pas ?** La diffusion tourne-t-elle à
  rayon nul, la dispersion à dispersion nulle ? La dispersion a déjà sa garde
  (« à dispersion nulle ce bloc ne s'exécute pas »), les autres restent à
  vérifier.
- **Les cinq pavés ajoutent le mortier et l'arête** à tout ce que fait déjà une
  matière de feuille : ce sont eux le pire cas, pas le verre en général.

## Ce qui rendrait ce ticket raté

Optimiser sans mesurer d'abord en production — on ne saurait pas ce qu'on a
gagné, exactement comme la première mesure du feather qui concluait « +15 % »
sur un plancher qui noyait le signal.

Et retirer de la crédibilité pour gagner des millisecondes : l'absorption qui
verdit avec l'inclinaison, la dispersion sur les seuls flancs, le liseré
d'arête sont ce qui sépare ce verre d'une lentille en plastique. Le coût qu'on
retire doit être du travail INUTILE, pas du travail visible.

## Hors sujet ici

L'aspect des pavés (« très artificiel, 3D des années 90 » — la régularité
parfaite d'une cellule à l'autre) et celui du mortier sont un travail de RENDU,
pas de performance. Ils se traitent séparément.
