# Observations directes — Photoshop web, 2026-07-27

Observé en session réelle (Antoine, `photoshop.adobe.com`, document PSDC ouvert en
lecture, aucune modification), via claude-in-chrome. **Tout ce qui suit a été vu à
l'écran.** Ce qui n'a pas été observé est marqué comme tel — ne rien déduire de plus.

Complète `photoshop-web-reference-tokens.md` (2026-07-20, valeurs de tokens) : ce
document-ci porte sur la **hiérarchie et la densité**, pas sur les couleurs.

Contexte : chantier de hiérarchisation UX de shaderlab. La recherche web documentaire
n'avait produit **aucune source exploitable** (0 URL sur 6 documents) et un agent avait
fabriqué des citations d'éditeurs. D'où cette observation directe.

## 1. Disposition générale

- Rail d'**outils vertical à GAUCHE**. Rail d'**icônes de panneaux vertical à DROITE**.
- Colonne de panneaux à droite, empilés : **Historique**, puis **Calques**, puis
  **Propriétés**. Séparateurs de redimensionnement visibles entre eux.
- Chaque panneau porte un **bouton X** de fermeture dans sa barre de titre.
- Le panneau d'**options de l'outil actif** est en **haut à gauche**, près du rail
  d'outils — pas dans la colonne de droite.

Ordre observé : l'**objet** (Calques) est au-dessus de ses **propriétés** (Propriétés).
Le panneau Propriétés affiche les réglages du calque sélectionné, et son contenu dépend
du **type** de calque (sur un calque de forme : Forme de rectangle, Style, Épaisseur,
Alignement, Transformation, Styles de calque).

## 2. Le constat le plus important pour shaderlab — densité de la ligne de calque

**Fusion et Opacité ne sont PAS sur les lignes de calque.** Ils vivent dans un
**en-tête unique** en haut du panneau Calques, appliqué au calque sélectionné.

Une ligne de calque contient seulement : **œil · vignette du calque · vignette du
masque · nom**. Hauteur mesurée à l'écran : **~29 px**.

Comparaison shaderlab (mesurée depuis le CSS) : **167,2 px** par ligne non
sélectionnée, parce que chaque ligne embarque son slider d'opacité et son sélecteur
de mode de fusion. **Facteur ~5,8×.**

C'est la cause de la colonne qui déborde, bien avant le nombre de calques.

## 3. Le mode outil ne redimensionne PAS l'image

Vérifié en changeant d'outil (Déplacer → Retoucher) et en comparant deux captures :
le panneau d'options change entièrement de contenu, **le canvas ne bouge pas d'un
pixel** (mêmes bornes à l'écran avant/après).

Le panneau d'options d'outil est un **overlay flottant** sur le bord du canvas, pas une
bande dans le flux qui pousse le contenu. Même chose pour la barre d'action au bas de
l'image.

Conséquence directe pour shaderlab : le coût annoncé de l'option B (« l'image se
redimensionne à chaque entrée/sortie du pinceau ») **n'est pas une fatalité** — il
vient du choix d'avoir monté `BrushToolbar` dans le flux, en frère du workspace
(`src/App.tsx`, `src/App.css`). Un overlay supprime ce coût sans rien rendre permanent.

## 4. Sélection

- La ligne sélectionnée porte un **fond bleuté pleine largeur**.
- Sélection et visibilité sont **indépendantes** : le calque sélectionné observé avait
  son œil barré (masqué) tout en restant sélectionné.

## 5. Source documentaire complémentaire (citable)

`https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/work-with-the-layers-panel.html`
(mise à jour 2026-02-23), verbatim utile :
- renommer un calque = **double-clic sur le nom**, puis Entrée ;
- réordonner = **glisser** la ligne ;
- afficher/masquer = **icône œil** à côté de la vignette.

## 5bis. Pile longue — LE constat décisif (observé sur 8 calques)

Observé en dupliquant un calque 7 fois (Ctrl+J) dans un document d'Antoine, avec son
accord explicite, puis en revenant à l'état « Ouvrir » via le panneau Historique —
retour vérifié en capture (état actif = « Ouvrir », les 7 « Calque par Copier »
grisés, pile revenue à 1 calque).

Avec 8 calques, Photoshop web :

1. **L'en-tête Fusion/Opacité reste FIXE** en haut du panneau — il ne défile pas avec
   la liste, il est toujours visible quel que soit le défilement.
2. **La liste des calques défile À L'INTÉRIEUR du panneau**, barre de défilement fine
   sur son bord droit.
3. **Le panneau Propriétés reste à sa place**, en dessous, visible. Il n'est jamais
   poussé hors écran par la longueur de la pile.
4. Le panneau Calques garde une **hauteur bornée** : il ne s'étend pas pour absorber
   son contenu.

**shaderlab fait exactement l'inverse** : la carte prend la hauteur de son contenu,
pousse les cartes suivantes vers le bas, et c'est la COLONNE qui défile — donc
Réglages et Masque sortent de l'écran dès que la pile s'allonge. C'est la cause
directe du « plusieurs calques gênaient la navigation » rapporté par Antoine.

### Conséquence : le commit f8b2a0b a gardé la mauvaise moitié

`f8b2a0b` (2026-07-27) a supprimé le double défilement en retirant celui des cartes
(`max-height: 42vh` + `overflow-y` sur `.docked-panel-card__content`) et en laissant
`.panel-column__stack` seul scroller. Le modèle observé impose l'inverse : **scroll
PAR PANNEAU, avec en-tête fixe, et pas de scroll de colonne**.

Le diagnostic « deux scrollers empilés, il faut n'en garder qu'un » était juste ; le
choix de celui à garder était faux. À corriger : rendre au contenu de carte son
défilement propre (hauteur bornée par la place disponible, pas par un `vh` arbitraire),
retirer celui de la colonne, et sortir Fusion/Opacité des lignes vers un en-tête fixe
de la carte Calques (§2).

## 5ter. Écrêtage — OBSERVÉ (corrige une décision prise sur maquette)

Observé en créant un calque de réglage (Teinte/saturation) sur le document
d'Antoine, puis en lui appliquant « Créer un masque d'écrêtage » (menu
contextuel de la ligne), puis en revenant à l'état « Ouvrir » par l'Historique
— retour vérifié en capture.

1. **Un calque de réglage NON écrêté ne porte AUCUNE marque.** Ni indentation,
   ni flèche, ni filet, ni changement de fond. Sa ligne est identique à celle
   d'un calque pixel. Raison : s'appliquer à tout ce qui est en dessous est le
   comportement PAR DÉFAUT — Photoshop ne signale pas le cas normal.
2. **Une fois écrêté, il gagne une petite flèche coudée (↳) placée ENTRE l'œil
   et la vignette.** C'est la seule marque. **AUCUNE INDENTATION** : la ligne
   reste alignée sur les autres.
3. La commande vit dans le menu contextuel de la ligne, libellée « Créer un
   masque d'écrêtage ».

### Ce que ça corrige

Antoine avait tranché « indentation + flèche » le 2026-07-27, **sur une maquette
où j'avais présenté l'indentation comme la convention Photoshop — sans l'avoir
observée**. La référence réelle ne fait que la flèche.

Conséquence pour shaderlab : la signalisation livrée (indentation de 12-14 px +
flèche) doit perdre son indentation. Bénéfice collatéral : plus de perte de
largeur utile, et la marque de sélection (lavis + barre 2 px) couvre la ligne
entière sans décalage.

### Ce que ça répond à la question « quel effet est lié à quelle photo »

Rien ne le montre pour un effet LIBRE — parce qu'il n'est lié à rien en
particulier : il agit sur tout ce qui est en dessous. L'écrêtage EST le
mécanisme de liaison, la flèche en est la marque, et il n'existe aucun
affichage de « portée » dans Photoshop web. Toute proposition de filet, de
surlignage de portée ou d'accolade est une invention — écartée.

### Autres commandes relevées dans le menu contextuel de ligne

Utile au backlog calques, observé mais NON instruit : Verrouiller le calque ·
Dupliquer · Copier · Charger en tant que sélection · Associer/Dissocier ·
**Afficher/masquer les autres calques** (l'équivalent de notre isolation) ·
Convertir en objet dynamique · Fusionner avec le calque inférieur · Fusionner
les calques visibles.

## 6. NON OBSERVÉ — ne rien en déduire
- Nombre de panneaux ouverts par défaut sur une session vierge (celle-ci était déjà
  configurée).
- Photoshop **desktop** : non observé, seule la version web l'a été. Ne pas
  extrapoler de l'un à l'autre.
- **Lightroom, Capture One, Dehancer** : non observés. Capture One et Dehancer n'ont
  pas de version web ; toute affirmation à leur sujet exigerait des captures fournies
  par Antoine.
