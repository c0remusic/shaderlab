Type: prototype
Status: open

> ⚠️ **2026-08-27 — UNE PART DE CE TICKET EST CLOSE PAR RETRAIT (ADR-0021).**
> « les séparations des pavés sont toujours horribles » et les trois refus
> antérieurs qui visaient les pavés ne se corrigent plus : après un quatrième
> refus (« Pavé nuage est horrible »), Antoine a choisi de **retirer les cinq
> matières de PAVÉ** plutôt que de les corriger une quatrième fois. Partent avec
> elles les huit réglages de bloc/mortier/arête et les cinq références de pixels.
>
> **Ce qui reste ouvert est tout le reste, et c'est la majorité du ticket** — il
> porte sur le mode **Poli** et sur les feuilles : reflet spéculaire, dispersion,
> présence du relief, creux, et les options inertes en Poli. Le front nommé par le
> grilling (reflet spéculaire du Poli d'abord) est INCHANGÉ, et sa tranche de code
> est le ticket 17 de `.scratch/retour-usage-execution/`.

> 🔵 **Grilling 2026-08-21** : front = **reflet spéculaire du Poli d'abord**.
> Recherche large glass shading LIVRÉE : `research/01-glass-shading.md` — diagnostic
> confirmé (Blinn-Phong = mauvais opérateur, **Fresnel gelé à 0,04 = l'erreur
> centrale**), 5 idées de refonte (reflet d'environnement fabriqué sans cubemap,
> Fresnel rampant, patron Apple « Liquid Glass » = énergie au BORD), licences
> triées (MIT réutilisables listés), 15 références Wikimedia vérifiées. Refonte
> jugée devant photo avec Antoine — c'est de l'apparence. Détail : `../map.md`.

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
