# Le layout, mesuré contre les deux références

Type: grilling
Status: resolved
Parent: ../map.md

## Question

Énoncé d'Antoine : « Fait un max de recherche pour qu'on atteigne la qualité et
le workflow photoshop, **pareil pour le layout** ».

**Qu'est-ce qui, dans la disposition de l'app, s'écarte de ce qu'un utilisateur
de Photoshop ou de Lightroom attend ?**

## ⚠️ Ce que la recherche N'A PAS trouvé, et c'est le point de départ

Relevé du 2026-08-18 sur sources primaires Adobe : **aucune source ne donne de
gabarit chiffré.** La documentation est descriptive — « le panneau Propriétés
montre W et H », « la barre d'options est en haut » — jamais dimensionnelle.
Aucune largeur de panneau, aucune hauteur de barre, aucun rapport.

**Conséquence directe : ce ticket ne peut pas se résoudre par de la recherche.**
Il se résout par des MESURES sur notre app et par des captures comparées. Le
chercher plus loin dans la documentation serait du temps perdu, et c'est le
genre de recherche qu'on continue par habitude quand elle a déjà rendu ce
qu'elle avait.

## Ce qu'on sait déjà de notre layout, mesuré

- **La barre d'options est permanente et haute de 75 px** depuis le 2026-08-18.
  La toile perd 75 px en permanence, y compris sous *Déplacer* qui n'a rien à
  régler. C'est un arbitrage rendu (ticket 27), pas un défaut — mais c'est la
  plus grosse dépense de hauteur de l'app.
- **Le dock est à droite**, largeur par défaut 320 px, borné à 240–400, avec un
  rail d'icônes. Référence assumée : Photoshop.
- **La colonne du dock ne défile pas** — ADR-0001 l'interdit ; ce sont les
  cartes qui se compriment, avec un plancher en lignes.
- **Aucune section de panneau ne dépasse six lignes visuelles** depuis le
  2026-08-18, exception écrite comprise.

## Ce qu'il faut interroger

- **Quel écart Antoine a-t-il vu ?** L'énoncé met le layout en second, après
  « la qualité et le workflow ». C'est peut-être une conséquence des autres
  points (une barre qui bouge, un cadenas mal posé) plutôt qu'un sujet propre.
  À vérifier AVANT d'ouvrir un chantier de disposition.
- **Le prix de la barre permanente se voit-il ?** 75 px sur une fenêtre de
  720 px, c'est 10,4 % de la hauteur. Sur un écran large, rien ; sur un portable,
  beaucoup. La mesure existe, le jugement non.
- **Lightroom et Photoshop ne disposent PAS pareil**, et l'app doit choisir :
  Lightroom met ses réglages dans une colonne unique qui défile, Photoshop les
  éclate en panneaux flottants ou dockés. Nous avons pris Photoshop (dock,
  cartes, rail) avec une contrainte de Lightroom (pas de défilement de colonne).
  L'hybride est-il assumé, ou est-ce le mélange qui gêne ?
- **Que fait la barre d'options de *Déplacer* ?** Elle porte une phrase d'aide.
  C'est le seul endroit de l'app où une bande de 75 px ne sert qu'à écrire une
  phrase.

## Contraintes dures

- ADR-0001, dans sa lettre : zone de contrôles fixe hors du conteneur défilant,
  liste défilante DANS le panneau, hauteur de panneau bornée, **jamais un
  défilement de colonne**.
- La palette d'outils ne doit pas bouger quand on change d'outil — mesuré à
  0 px depuis le 2026-08-18, et c'était un vrai défaut avant.

## Ce qui prouve que ce ticket est fini

Un écart NOMMÉ, mesuré sur notre app, et une décision. Pas « le layout a été
revu ».

⚠️ Et si la réponse est « il n'y avait pas d'écart de layout, c'étaient les
autres points », **c'est une réponse valide et il faut l'écrire**. Le pire
résultat serait de refondre une disposition qui allait bien parce qu'un ticket
existait.

---

## Answer — RÉSOLU le 2026-08-18

**La disposition n'a pas d'écart de principe. Elle a UN défaut, mesuré et
reproduit, et il viole ADR-0001 dans sa lettre.**

### La mesure, à trois tailles de fenêtre

| fenêtre | pasteboard | barre d'options | dock |
| --- | --- | --- | --- |
| 1280 × 720 | 81,7 % | 75 px = **10,4 %** de la hauteur | 25,5 % de la largeur |
| 1600 × 900 | 85,3 % | 8,3 % | 20,0 % |
| 1920 × 1080 | 87,8 % | 6,9 % | 16,7 % |

Rien d'anormal dans ces proportions : le pasteboard tient plus de quatre
cinquièmes de la fenêtre partout, et le dock reste sous le quart au-delà de
1280. **Le ticket n'a donc pas de refonte à demander**, et c'est la réponse que
son propre garde-fou autorisait.

### ⚠️ LE DÉFAUT : à 1280 × 720, la colonne du dock DÉFILE

Reproduit dans l'état exact où il apparaît — document ouvert, aplat tracé et
SÉLECTIONNÉ, donc carte Propriétés chargée de ses dix-huit réglages :

```
grille : hauteur 556  ·  scrollHeight 630  ·  clientHeight 556
cartes : Presets 184 · Pile 224 · Textures 52 · Propriétés 112  (= 572 + 24 de gouttières)
→ « Propriétés · Aplat » finit 24 px SOUS le bord de la fenêtre, hors de la grille
```

À 1440 × 810, tout rentre (646 disponibles pour 622 nécessaires) : le défaut
n'existe qu'en dessous d'un seuil.

**Le mécanisme est clair, et ce n'est pas une compression qui manque** : la
chaîne fonctionne — Propriétés est déjà comprimée à 112 px. C'est que **la somme
des PLANCHERS (572 px + gouttières) dépasse la hauteur disponible (556 px)**, et
la colonne retombe alors sur son `overflow-y: auto`. Or ADR-0001 interdit
exactement ça : « liste défilante DANS le panneau + hauteur de panneau bornée ;
**jamais un défilement de colonne** ».

### La cause immédiate, et elle est à nous

**Les 75 px de la barre d'options permanente** (ticket 27) sortent de la hauteur
de la colonne. Le prix de cet arbitrage ne se payait donc pas que sur la toile —
personne ne l'avait mesuré de ce côté-là, moi compris en l'écrivant.

⚠️ **Mais la baisser ne corrige pas**, et l'essai a été fait plutôt que supposé :
passer les curseurs de la barre en libellé EN LIGNE la ramène à 55 px, soit
**20 px rendus alors qu'il en manque 40**. Il casse en prime le nom accessible
des quatre curseurs — Base UI porte `aria-labelledby` sur le POUCE, pas sur
l'input — et la garde d'accessibilité l'a attrapé. Piste abandonnée, mesure
conservée.

### Ce qui reste, et pourquoi ce n'est pas à moi de le trancher

Deux voies, et **chacune défait une décision écrite** :

1. **Baisser le plancher des listes sous pression.** `--dock-card-list-rows: 5`
   libérerait les ~70 px manquants en passant à 3 lignes quand la place manque.
   Mais `CLAUDE.md` note que « la borne à 5 lignes est voulue, pas un défaut ».
2. **Replier une carte au lieu de laisser la colonne défiler.** Conforme à
   ADR-0001, mais il faut dire LAQUELLE — et replier celle qu'on vient de
   sélectionner serait absurde.

Choisir entre les deux, c'est arbitrer une règle contre une autre. Le diagnostic
est complet et reproductible ; la décision revient à Antoine.

⚠️ Ne PAS « corriger » en montant simplement la hauteur minimale de fenêtre :
`--window-min-height` vaut 600 px, donc 1280 × 720 est une taille pleinement
supportée, pas un cas limite.

---

## Amendement du 2026-08-18 — une des deux voies est MORTE, mesurée

Les deux voies ci-dessus ont été éprouvées dans la page vivante, à 1280 × 720,
aplat sélectionné. **La première ne rend rien du tout.**

### Voie 1 (baisser le plancher des listes) : 0 px

`--dock-card-list-rows` forcé de 5 à 3 dans la page, puis relecture :

```
débord avant : 74 px
débord après : 74 px
gain réel du passage 5 -> 3 lignes : 0 px
```

La cause est écrite dans `PanelColumn.css:138` et personne ne l'avait rapprochée
de ce ticket : le plancher est borné par
`min(plancher nominal, hauteur naturelle du contenu)` — « une carte plus courte
que le plancher n'est jamais GONFLÉE par lui ». Or **aucune liste n'atteint ici
son plancher de 5 lignes** : contenu naturel de Presets 132 px, de Pile 172 px,
de Textures 0 px. Elles sont bornées par leur CONTENU. Baisser le plancher ne
leur rend rien.

Conséquence sur l'arbitrage : **la note de `CLAUDE.md` (« la borne à 5 lignes
est voulue, pas un défaut ») n'a pas à être défaite.** Elle n'était pas en
cause. Il ne reste donc pas deux voies qui coûtent chacune une décision écrite,
mais **une seule voie**, qui n'en défait aucune — replier une carte est
exactement ce qu'ADR-0001 prescrit.

### Toutes les cartes sont déjà posées sur leur plancher

Relevé, `plancher` étant le `min-height` calculé :

| carte | rendu | plancher | contenu naturel |
| --- | --- | --- | --- |
| Presets | 184 | 184 | 132 |
| Pile | 224 | 224 | 172 |
| Textures | 52 | 52 | 0 (déjà repliée) |
| Propriétés · Aplat | 112 | 112 | **551** |

`rendu === plancher` partout : la colonne ne peut plus se comprimer d'un pixel.
Et Propriétés réclame 551 px pour n'en obtenir que 112.

⚠️ **Textures est repliée par DÉFAUT**, ce que le relevé initial du ticket ne
disait pas. Une première sonde a cru la replier alors qu'elle la DÉPLOYAIT, et a
rapporté un « gain » de −356 px qui ressemblait à une anomalie du layout. Il n'y
en a pas : la carte déployée porte un catalogue de 1119 px, plancher 408.

### Ce que chaque repli rend, mesuré carte par carte

| voie | Presets | Pile | Textures | Propriétés | colonne |
| --- | --- | --- | --- | --- | --- |
| actuelle | 184 | 224 | 52 | 112 | **630 / 556 — défile** |
| Presets repliée | 52 | 224 | 52 | **204** | 556 / 556 — tient |
| Pile repliée | 184 | 52 | 52 | **244** | 556 / 556 — tient |
| Propriétés repliée | 184 | 224 | 52 | 52 | 536 / 536 — tient |

Les trois rendent exactement les 74 px manquants : **le choix n'est pas une
question de place**, et aucune voie n'est techniquement meilleure. Ce qui les
sépare est ce qu'on accepte de perdre de vue en travaillant — une liste
consultée par intermittence, la navigation du document, ou le panneau de l'objet
qu'on vient de sélectionner.

Les pixels libérés ne disparaissent pas : ils vont à Propriétés, seule carte à
réclamer plus que son plancher. Replier Presets lui en donne 204, replier Pile
244.

Planche : [`docs/wireframes/dock-1280-arbitrage.html`](../../../docs/wireframes/dock-1280-arbitrage.html).

---

## Résolu le 2026-08-19 — des groupes à ONGLETS, modèle Photoshop

Arbitrage d'Antoine, après avoir demandé « comment faire photoshop ? » devant
deux mécanismes qui marchaient tous les deux.

### Le relevé qui a décidé

[Recherche 02](../research/02-la-colonne-trop-haute.md) : **ni Photoshop ni
Lightroom ne replient un panneau sur une mesure de place.** Lightroom a le Solo
mode, déclenché par un GESTE et opt-in ; Photoshop met les panneaux en ONGLETS
dans des groupes empilés. La raison de préférer les onglets n'est pas
esthétique — **avec un onglet on VOIT que l'autre panneau existe et il est à un
clic** ; un repli le cache et en demande deux.

### Deux mécanismes construits puis retirés

Aucun n'a été écarté sur une intuition :

1. **L'auto-repli sous pression** — la colonne mesure, détecte le débord,
   replie une carte désignée. Sans précédent chez les deux outils, et pour une
   bonne raison : une carte qui se referme pendant qu'on travaille est un
   mouvement qu'on n'a pas demandé, et l'utilisateur qui la rouvre la verrait se
   refermer.
2. **Le Solo mode de Lightroom** — construit, fonctionnel, Alt-clic pour
   basculer, et il TENAIT la colonne au plancher de 5 lignes inchangé. Retiré
   parce qu'il rendait **Pile et Propriétés mutuellement exclusives**, alors
   qu'on les lit ensemble : sélectionner un calque puis régler ses paramètres
   devenait deux clics avec un aller-retour. Son coût n'était pas des pixels
   mais un geste. Le solo de Lightroom s'applique à des panneaux qui SE
   REMPLACENT (Basique, Courbe, TSL), pas à deux compagnons.

### Livré

`DockLayout` passe de `string[][]` à des colonnes de GROUPES
(`{ tabs, active, collapsed }`). Disposition de départ : **Presets et Propriétés
en onglets d'un groupe, la Pile seule dans le sien.**

Deux zones de dépôt, comme Photoshop : les bandes haute et basse ouvrent une
ligne, le milieu rejoint le groupe en onglet. Le guide passe du filet au CADRE
quand on groupe.

Et **la carte Textures est partie** (demande d'Antoine) : son geste — ajouter un
scan comme calque photo — n'a plus de raison d'être depuis qu'un effet
échantillonne la bibliothèque lui-même (ADR-0018).

### Le résultat, mesuré

Débord **194 px → la colonne TIENT**, et `--dock-card-list-rows` n'a **pas** eu à
être abaissé : la note de `CLAUDE.md` (« la borne à 5 lignes est voulue ») reste
intacte. C'est la propriété que ni l'auto-repli ni le colmatage n'avaient — la
colonne est bornée par construction, une seule carte de chaque groupe portant du
contenu.

### ⚠️ Le constat intermédiaire qui était FAUX

L'amendement ci-dessus affirme « baisser le plancher des listes rend 0 px,
la voie est morte ». **Vrai sur 2 calques, faux sur 7** — où chaque ligne retirée
rend exactement 60 px (194 → 134 → 74 → 14 de 5 à 2 lignes). Le relevé était
juste ; c'est de l'avoir présenté comme général qui ne l'était pas, et il a
failli faire trancher de travers. Un scénario de ticket n'est pas le scénario
d'usage : le ticket décrivait un document à trois calques, un vrai document en a
sept.
