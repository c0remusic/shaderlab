# Où vit l'état de repli de la pile, et que fait-il d'une sélection dedans

Type: grilling
Status: ready-for-human
Parent: ../map.md

## Question

Antoine a tranché la FORME du repli le 2026-08-15, devant trois wireframes :
la pile se replie par groupes (une photo et ses effets écrêtés), avec le filet
d'imbrication, et la ligne sélectionnée devient un **bloc décalé** dont la barre
bleue est l'arête — variante C, implantation c1, décalage porté à 20 px.

Deux choses qu'aucun wireframe ne peut trancher restent, et **elles bloquent la
première ligne de code** :

1. **Où vit l'état de repli ?** Dans le MODÈLE de document — donc persisté, donc
   dans `LayerState`, la couche la plus partagée du projet (`render/`, `mask/`,
   `export/`, `components/`, `application/`) — ou dans l'état d'INTERFACE, donc
   perdu à la réouverture du document ?
2. **Que fait le repli d'un groupe dont un enfant est SÉLECTIONNÉ ?** Replier en
   laissant la sélection sur une ligne invisible ramènerait exactement le défaut
   corrigé le 2026-08-14 (la sélection qui ne défile pas dans la vue). La
   réponse évidente est de faire remonter la sélection au parent — mais c'est
   une décision, pas une évidence : elle change ce que montrent les cartes
   Propriétés et Masque au moment où on replie.

## Ce que la réponse change

**Question 1.** Un repli dans `LayerState` se sauvegarde avec le document et se
retrouve à la réouverture : c'est ce qu'on attend d'un document de travail dont
la pile est longue. Mais il ajoute un champ à la couche la plus partagée du
projet, donc il touche les presets (`presetDocument.ts`), l'export et le
harnais de rendu — et `CLAUDE.md` demande un plan écrit avant la première ligne
dès qu'on touche `LayerState`. Un repli en état d'interface ne coûte rien de
tout ça et se perd à chaque ouverture.

⚠️ **Précédent utile dans le dépôt** : `maskOverlayLayerId` et `isolatedLayerId`
vivent sur le `Renderer` et pas dans le modèle, précisément parce que ce sont
des aides de visée et non des propriétés du document. La question est donc :
**un repli est-il une aide de visée, ou une propriété du document ?**

**Question 2.** Elle décide aussi de ce qui se passe à l'inverse — déplier un
groupe rend-il la sélection à l'enfant qu'on avait quitté, ou la laisse-t-elle
au parent ? Répondre « on remonte au parent » sans répondre à ça donne une
sélection qui se perd à chaque aller-retour.

## Partie AFK — à faire AVANT de solliciter Antoine

1. **Mesurer ce que coûte le champ dans `LayerState`** : combien de sites le
   lisent, combien de tests le figent, et si `presetDocument.ts` doit le
   porter (un preset décrit des effets, pas un état de vue — mais il porte
   déjà `enabled` et `locked`, qui sont de la même famille douteuse).
2. **Relire `pileModel.ts` / `layerTree.ts`** : le repli est une PROJECTION
   d'affichage, et ces deux modules sont déjà l'endroit où la profondeur
   d'imbrication est décidée. Le repli y a probablement sa place, quelle que
   soit la réponse à la question 1.
3. **Vérifier le comportement des trois autres logiciels** que le dépôt cite
   déjà (Photoshop web, dont les observations sont dans
   `docs/design-system/photoshop-web-observations-2026-07-27.md`) : un groupe
   replié y garde-t-il sa sélection ?

## Wireframes qui portent la décision de forme

- `docs/wireframes/pile-longue.html` — les quatre réponses au débordement ;
- `docs/wireframes/pile-longue-repli.html` — D avec le filet, trois traitements
  du groupe replié ;
- `docs/wireframes/pile-longue-hierarchie.html` — la barre et la profondeur,
  d'où sortent C/c1 et les 20 px.

## Ce qui rendrait ce ticket raté

Coder le repli en état d'interface « pour commencer », puis découvrir qu'Antoine
attendait qu'il survive à la réouverture : le champ arriverait alors dans
`LayerState` après coup, avec les presets et le harnais déjà écrits autour de
son absence.
