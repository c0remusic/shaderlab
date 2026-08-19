# Recherche 02 — que font Photoshop et Lightroom quand la colonne de panneaux ne tient pas ?

Relevé le 2026-08-19, sur demande d'Antoine (« reference toujours
photoshop/lightroom pour ce genre de choix »), pendant le ticket
[04 — le layout](../issues/04-le-layout.md).

⚠️ **Qualité de source.** Les deux constats viennent de pages
`helpx.adobe.com` — source primaire — mais `WebFetch` a échoué quatre fois de
suite en timeout sur ce domaine. Le texte ci-dessous provient donc des
**extraits de recherche** de ces mêmes pages, pas d'une lecture intégrale. Les
formulations sont fidèles au fond ; ne pas les citer comme des verbatims tant
qu'une lecture complète n'a pas été refaite.

## La question

Notre colonne de dock déborde à 1280 × 720 sur un document réel : 194 px de trop
avec sept calques, et ADR-0001 interdit explicitement un défilement de colonne.
J'allais construire un **auto-repli sous pression** — la colonne mesure, détecte
le débord, et replie une carte désignée.

**Aucun des deux outils ne fait ça.**

## Lightroom Classic — le « Solo mode »

Source : [Workspace basics in Lightroom Classic](https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html).

- S'active par un **clic droit** (Windows) ou Ctrl-clic (Mac) sur l'en-tête d'un
  panneau, puis « Solo mode » ; ou par **Alt-clic** (Windows) / Option-clic (Mac)
  sur l'en-tête.
- S'applique **indépendamment à un GROUPE de panneaux**.
- Une fois actif : **un seul panneau du groupe peut être ouvert à la fois** — en
  ouvrir un autre replie automatiquement celui qui l'était.

Ce qui compte pour nous : le repli automatique existe bien, mais il est
**déclenché par un geste de l'utilisateur** (il ouvre un autre panneau), jamais
par une mesure de place. Et il est **opt-in** : l'utilisateur décide que sa
colonne marche comme ça.

## Photoshop — le repli en ICÔNES

Sources : [Expand or collapse panel icons](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html),
[Arrange and group panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/manipulate-panel-groups.html).

- La **double flèche en haut à droite du dock** replie tous les panneaux en
  icônes.
- Cliquer une icône **n'ouvre que ce panneau-là**.
- Réduire la largeur du dock jusqu'à faire disparaître les libellés ne laisse que
  les icônes ; l'élargir les fait revenir.
- **Les espaces de travail par défaut livrent déjà certains panneaux repliés** —
  ce n'est pas un état dégradé, c'est la configuration de départ.

Photoshop répond donc au manque de place par une **densité choisie** (un rail
d'icônes) et par un **défaut livré replié**, pas par une réaction automatique.

## Ce que ça tranche

**Un repli déclenché par une mesure de hauteur n'a de précédent ni chez l'un ni
chez l'autre.** Et c'est cohérent : un panneau qui se referme tout seul pendant
qu'on travaille est un mouvement qu'on n'a pas demandé, et l'utilisateur qui le
rouvre le verrait se refermer — le mécanisme se retourne contre lui dès qu'il
n'est pas d'accord avec la mesure.

Les deux conventions disponibles, et elles se combinent :

1. **Solo mode** (Lightroom) — ouvrir une carte replie les autres. Déterministe,
   opt-in, aucun risque de lutte avec l'utilisateur.
2. **Replié par défaut** (Photoshop) — la carte naît repliée, l'utilisateur
   l'ouvre s'il en a besoin. C'est déjà ce que faisait notre carte Textures, donc
   la convention est en vigueur ici sans avoir été nommée.

## Ce que ce relevé n'a PAS trouvé

- **Rien de dimensionnel**, une fois de plus : aucune hauteur, aucun seuil, aucun
  nombre de lignes minimum. Le [relevé 01](01-conventions-adobe.md) l'avait déjà
  constaté pour le layout, et ça se confirme. Les chiffres se mesurent sur notre
  app.
- **Rien sur un plancher de liste.** Notre `--dock-card-list-rows` n'a pas
  d'équivalent documenté chez Adobe : Photoshop laisse les listes défiler chez
  elles sans promettre un nombre de lignes visibles. Le choix de la valeur reste
  donc le nôtre, et se mesure.
