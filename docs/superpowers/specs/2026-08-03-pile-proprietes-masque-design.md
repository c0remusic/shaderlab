# Pile, propriétés et masque — design UX

> Statut : **implémenté et vérifié techniquement**, 2026-08-04 ; verdict
> esthétique humain final différé pour permettre la poursuite autonome.
> Référence visuelle interactive : `docs/wireframes/effect-controls.html`.
> Ce document remplace la lecture fragmentée « Effets / Photo / Réglages /
> Masque » par un flux unique centré sur l'objet sélectionné.

## Problème

Le dock actuel distribue l'état d'un même calque dans quatre cartes. La sélection
vit dans « Effets », mais ses conséquences vivent plus bas dans Photo, Réglages
et Masque. Le panneau « Effets » contient pourtant aussi des photos, et le masque
apparaît comme un outil global alors qu'il appartient à un calque précis.

La conséquence n'est pas seulement visuelle : l'utilisateur doit mémoriser le
contexte pendant qu'il cherche l'action, et ne peut pas lire d'un coup la relation
photo → effets → masques.

## Décision

Le dock principal porte deux zones persistantes :

1. **Pile** — structure du document et navigation.
2. **Propriétés** — inspecteur contextuel de la cible sélectionnée.

Les cartes autonomes Photo, Réglages et Masque disparaissent de ce flux. Le rail
peut toujours masquer/afficher le dock, mais il ne sépare plus artificiellement
les facettes d'un même objet.

## Pile

### Hiérarchie visible

- Un calque photo est une racine visuelle avec vignette.
- Les calques d'effet qui lui sont rattachés se lisent comme enfants.
- La hiérarchie affichée reste une projection du modèle réel ; elle ne crée pas
  de groupe de compositing inexistant.
- Le libellé devient « Pile », car elle contient photos et effets.

### Anatomie d'une ligne

Une ligne ne garde que les états comparables entre objets : visibilité, nature,
nom, masque, verrou éventuel et menu secondaire. Opacité, fusion, remplacement,
duplication et suppression vivent dans Propriétés ou le menu contextuel.

### Deux cibles sur une ligne d'effet

- Cliquer le corps sélectionne **l'effet**.
- Cliquer la vignette de masque sélectionne **son masque**.
- Un masque absent rend un `+` dans la même case ; l'activer crée/ouvre le masque.
- La sélection se distingue par une barre latérale sur la ligne et un contour
  autour de la vignette quand le masque est la cible.

## Propriétés

L'en-tête nomme toujours l'objet : `Propriétés · Lens flare`, puis la cible
`· Masque` si nécessaire.

Pour un effet, deux onglets locaux :

- **Effet** : contrôles spatiaux, paramètres, opacité, fusion, activation.
- **Masque · N** : aperçu, session peinture, sources, combinaison et affinage.

Pour une photo, l'inspecteur rend ses transformations et actions propres sans
onglet Effet artificiel.

Changer de ligne conserve le dernier onglet uniquement s'il existe sur la cible
suivante ; sinon Propriétés choisit la première cible valide, sans panneau vide.

## Ajout et réordonnancement

`+ Ajouter un effet` agit relativement à la sélection. Le menu est recherché et
groupé par intention (Lumière, Optique, Couleur, Texture, Graphique), classification
déclarée à côté du registre plutôt que codée dans le menu.

Le drag réordonne la pile. Les zones de dépôt disent si l'effet reste dans la
même chaîne ou se rattache à une autre photo. Un dépôt interdit reste visiblement
interdit ; aucun reclassement silencieux.

## Politique d'icônes

Les actions fréquentes et conventionnelles se compactent en boutons icône avec
nom accessible et tooltip : ajouter, importer, visibilité, verrou, dupliquer,
supprimer, replier et plus d'actions. Les actions rares d'une ligne ou d'une
source vivent derrière `•••`.

Les icônes ne remplacent jamais ce qui porte le modèle mental : noms de calques,
onglets Effet/Masque, catégories du menu d'ajout et modes
Ajouter/Soustraire/Intersection restent écrits. Un symbole seul n'est accepté que
si son sens est stable sans apprentissage local ; sinon texte ou icône + texte.

Tous les boutons reprennent `IconButton` et les tokens existants : 28 px compact,
rayon contrôle, hover neutre, focus bleu Spectrum. Aucun nouveau langage visuel
parallèle n'est créé par le wireframe.

## Session masque

`Peindre sur l'image` ouvre un mode explicite :

- la ligne et sa vignette restent sélectionnées ;
- Propriétés reste sur Masque ;
- l'overlay et le curseur de pinceau apparaissent ;
- les contrôles spatiaux de l'effet disparaissent temporairement ;
- la barre contextuelle porte taille, dureté, flux et effacement ;
- Échap quitte la session ; changer de calque la ferme proprement.

Les sources restent ordonnées et combinées par Ajouter/Soustraire/Intersection.
L'affinage s'applique au résultat global et se place après la liste.

## Non-objectifs

- Aucun changement immédiat du modèle de compositing ou du format de document.
- Pas de groupes de calques réels dans cette tranche.
- Pas de miniatures GPU recalculées à chaque frame ; une stratégie bornée doit
  précéder leur implémentation.
- Pas de menu contextuel exhaustif avant validation du flux principal.

## Critères d'acceptation

- Depuis une ligne, un clic suffit pour atteindre soit l'effet soit son masque.
- Le nom de la cible est visible en permanence dans Propriétés.
- Aucun panneau global Masque ne peut afficher le masque d'un objet différent de
  celui nommé par l'inspecteur.
- Ajouter un effet à une photo donnée ne demande pas de réparer son rattachement.
- Entrer et sortir du mode peinture ne laisse aucun overlay ou outil armé.
- La pile permet de distinguer photo, effet, masque présent, visibilité et verrou
  sans sélectionner chaque ligne.
- Le flux complet est démontré dans le wireframe puis sur vraie WebView2.
