# Conventions Adobe qui nous concernent — relevé du 2026-08-18

Sources PRIMAIRES uniquement (`helpx.adobe.com`). Une affirmation, une source.
Rien n'est repris d'un tutoriel, d'un forum ou d'un billet tiers : le dépôt a
déjà payé une passe de raffinement faite sur des références générales
(`lensFlare`, 2026-08-03).

⚠️ **Ce document rapporte, il ne tranche pas.** Ce que nous en faisons se décide
dans les tickets de la carte.

---

## 1. Le verrou de calque — QUATRE verrous, et la forme de l'icône porte l'état

Source : [Move, stack, and lock layers in Photoshop](https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html)

Photoshop expose quatre verrouillages distincts :

| verrou | ce qu'il refuse |
| --- | --- |
| **Lock Transparent Pixels** | confine l'édition aux parties OPAQUES du calque |
| **Lock Image Pixels** | empêche de modifier les pixels aux outils de peinture |
| **Lock Position** | empêche de DÉPLACER les pixels |
| **Lock All** | tout |

Et l'icône n'a pas une seule forme : **elle est PLEINE quand le calque est
entièrement verrouillé, CREUSE quand il l'est partiellement.**

Le cas d'usage est donné explicitement par Adobe : verrouiller partiellement un
calque qui a déjà la bonne transparence et les bons styles pendant qu'on hésite
encore sur son placement.

**Ce que ça dit de chez nous.** Notre `locked` est un booléen et notre cadenas a
une seule forme. Les quatorze opérations que `LayerStack` refuse sont
aujourd'hui refusées ENSEMBLE — on ne peut pas geler la géométrie d'un aplat en
continuant à régler sa couleur, ce qui est pourtant exactement le geste que la
barre d'options rend courant.

⚠️ **Attention au faux ami.** « Lock Image Pixels » n'a pas de sens direct chez
nous : un calque d'effet n'a pas de pixels propres, il transforme ce qui est en
dessous. La transposition demande de dire ce qu'est un « pixel » pour un effet —
c'est une question de domaine, pas de recopie.

---

## 2. La forme reste vivante, et ses réglages vivent à DEUX endroits

Sources : [Work with the Rectangle tool](https://helpx.adobe.com/photoshop/using/modify-shapes.html)
· [Modify fill and stroke for shapes](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/fill-and-stroke-shapes.html)

- Une forme se trace **en glissant sur la toile**, et ses propriétés se règlent
  depuis la **barre d'options** ou le **panneau Propriétés**.
- Les contrôles sur la toile s'appellent **Live Shapes Controls** et s'activent
  par l'icône d'engrenage. Ils portent notamment une **poignée de rotation qui
  apparaît au SURVOL de la forme**.
- Les **rayons d'angle** se manipulent sur la toile : tous ensemble, ou un seul
  en maintenant Alt/Option.
- Le panneau Propriétés porte **W** et **H** en saisie directe, et permet de
  délier les rayons d'angle par une icône de chaîne.
- Le remplissage accepte **couleur unie, dégradé ou motif** ; le contour a une
  épaisseur, un style (plein, tirets, pointillés) et un alignement.

**Ce que ça dit de chez nous.** Nous avons depuis aujourd'hui les huit poignées
et la rotation (genre `box`), et la barre d'options porte la primitive et la
couleur. Trois écarts restent, et ils ne sont pas de même nature :

1. **La poignée de rotation d'Adobe apparaît au SURVOL**, la nôtre est
   permanente — moins d'encre sur la toile chez eux, pour le même geste.
2. **Le rayon d'angle se manipule sur la toile.** Chez nous il n'existe pas :
   `aplat` l'a vu ÉCARTÉ par Antoine le 2026-08-17, en même temps que le
   contour. Ce n'est donc pas un manque, c'est une décision — à ne pas rouvrir
   sur la seule foi de ce relevé.
3. **Le panneau et la toile ne montrent pas les mêmes grandeurs.** Notre panneau
   donne `largeur`/`hauteur` en fraction du cadre ; Photoshop donne W et H en
   pixels. Un utilisateur qui tire une poignée ne peut pas lire ce qu'il vient
   de faire dans une unité qu'il reconnaît.

---

## 3. Le double-clic remet un curseur au défaut — convention Lightroom

Sources : [Work with the Develop module](https://helpx.adobe.com/lightroom-classic/help/develop-module-tools.html)
· [Keyboard shortcuts for Lightroom Classic](https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html)

- **Double-cliquer un curseur le remet à zéro.** C'est la formulation d'Adobe,
  et « zéro » y désigne le neutre du réglage.
- Les flèches **Haut** et **Bas** incrémentent la valeur du champ sélectionné.
- Trois autres chemins de remise à zéro existent : le bouton **Reset**, le
  preset **General - Zeroed**, et un retour par le panneau **Historique**.

**Ce que ça dit de chez nous.** Le double-clic est livré aujourd'hui, et il
ramène à `EffectParam.default` — la bonne lecture, puisque le « neutre » d'un
paramètre d'effet est précisément son défaut déclaré et non zéro (le seuil de
`glow` a 0,55 pour neutre, pas 0).

Ce qui manque encore, et que ce relevé nomme : **il n'y a aucun chemin de remise
à zéro d'un EFFET ENTIER**, ni de la pile. Lightroom en offre trois.

---

## 4. Ce que le relevé n'a PAS trouvé, et qu'il ne faut pas inventer

- **Aucune source Adobe ne décrit une « marque du défaut » sur la piste d'un
  curseur.** Notre marque vient d'une demande d'Antoine devant une planche, pas
  d'une convention externe. Elle est donc à juger à l'usage, sans se réclamer
  d'un précédent.
- **Rien sur la largeur ni la hauteur des panneaux**, ni sur un quelconque
  gabarit chiffré : la recherche sur le LAYOUT n'a pas produit de source
  primaire exploitable. Ce qui existe est descriptif (« le panneau Propriétés
  montre W et H »), jamais dimensionnel. Le ticket sur le layout devra donc se
  mesurer sur NOTRE app et sur des captures, pas sur une documentation qui ne
  dit pas ces choses.
