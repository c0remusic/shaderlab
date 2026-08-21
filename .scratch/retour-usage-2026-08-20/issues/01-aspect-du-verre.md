Type: prototype
Status: open

## Question

Comment rendre le verre CRÉDIBLE, en particulier le mode Poli — refusé quatre
fois par Antoine ? Le retour du 2026-08-20 empile : « reflet spéculaire
horrible », « dispersion pas très belle », « présence du relief fait un effet
bizarre », « les creux pourraient être mieux faits », « pleins d'options ne font
presque rien en mode Poli, on ne retrouve pas d'effet de mode poli », « les
séparations des pavés sont toujours horribles ». Plus les trois refus antérieurs
(ROADMAP bloc 1 : « très artificiel, 3D des années 90 »).

Ce que le diagnostic analytique a établi (glass Poli, sous-agent, à CONFIRMER au
pixel — c'est de l'analyse numérique, pas des pixels mesurés) :
- **`specular` quasi inerte en Poli** : la normale ne dévie jamais >8,43° de la
  verticale, le reflet Blinn-Phong (exposant 120) plafonne à 0,0004 en linéaire
  au défaut — 1000× sous le seuil de perception. Le matériau le plus LISSE porte
  le reflet le plus MORT, exactement l'inverse de ce qu'un verre poli doit faire.
- **Fresnel collé à 0,04 partout** en Poli → voile uniforme plat, aucun tracé de
  reflet. Double cause de « pas d'effet de mode poli ».
- `grain` déplace jusqu'à 490 px en Poli — « micro-relief » qui n'est plus micro,
  explique une part du flou reproché.

Méthode IMPOSÉE (Notes de la carte) : cross-référencer avec un MAX de références
visuelles (blocs de verre, dépoli, réfraction réelle) AVANT de raffiner. Une
apparence ne se déduit pas d'une spec — leçon déjà payée sur cet effet. Les cinq
photos de référence du scratchpad ne survivent pas à la session : les
retélécharger (Wikimedia Commons `Glass blocks`, `Frosted glass`).

Le rendu changera → les **18 références de pixels du verre** sont à régénérer et
à relire à l'œil, résultat jugé devant photo.

Sous-tickets possibles à faire émerger : le reflet spéculaire du Poli, le Fresnel
spatialement variable, les séparations de pavés (déjà 3 corrections livrées et
refusées — voir ROADMAP), le cadre lisse périphérique, la diffusion structurante.
