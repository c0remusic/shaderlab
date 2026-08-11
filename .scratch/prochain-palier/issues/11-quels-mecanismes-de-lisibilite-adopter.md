# Quels mécanismes de lisibilité adopter

Type: grilling
Status: open
Blocked by: 09
Parent: ../map.md

## Question

[Ce que Photoshop et Lightroom rendent lisible](09-ce-que-photoshop-et-lightroom-rendent-lisible.md)
a rendu **31 mécanismes** sourcés, chacun avec son point d'accroche dans notre
code et son coût — voir
[`research/09-lisibilite-photoshop-lightroom.md`](../research/09-lisibilite-photoshop-lightroom.md).

**Lesquels adopter, et lesquels refuser ?**

Le fichier de recherche n'arbitre rien, c'est ce ticket qui le fait. Il ne se
lit pas en entier avant de commencer : prendre les cinq à meilleur rapport
d'abord, puis la question de fond ci-dessous.

## Les cinq à trancher en premier

Tous à accrochage existant, aucun ne demande de nouvelle architecture :

1. **Retour au défaut** — double-clic sur le nom d'un curseur, Alt-clic pour
   tout le groupe. Donnerait enfin une fonction à `EffectSection.label`,
   aujourd'hui purement décoratif.
2. **Avant/après par touche maintenue** — `framePipelineExecutor.ts:313` filtre
   déjà sur `layer.enabled`, donc ni passe ni shader nouveau.
3. **Mode Solo des cartes** — borne le NOMBRE de cartes ouvertes, là où
   ADR-0001 ne borne que leur hauteur. C'est un complément à la règle, pas un
   contournement.
4. **Un œil par section** — quatre fonctions (lire, comparer, éteindre,
   remettre au défaut) sur une seule case.
5. **Filtre par nom dans Presets et Textures** — le patron est déjà écrit dans
   `EffectPicker`. Mesuré le 2026-08-11 : `PresetPanel.tsx:110` n'a qu'un champ
   de SAISIE (« Nom du preset »), `TextureLibrary.tsx` n'a rien.

## La question de fond, qui vaut plus que les cinq

Lightroom **fane et met en italique** un preset inapplicable au lieu de le
retirer — et fait du retrait une PRÉFÉRENCE de l'utilisateur. Nous avons
choisi l'inverse : `EffectParam.appliesWhen` masque.

Le chantier des contrôles a été soldé le 2026-08-05 sur ce choix, et ses
corollaires sont écrits dans `CLAUDE.md` (masquer ne borne pas ; un paramètre
qu'aucune section ne cite n'est pas un défaut). **Une troisième voie existe et
n'a jamais été instruite.** Faner au lieu de masquer garde la découvrabilité —
on voit qu'un réglage existe et pourquoi il dort — au prix de la densité, que
ADR-0001 protège. Ce ticket est le bon endroit pour la peser, une fois, plutôt
que de la redécouvrir dans six mois.

## Contraintes dures

- **ADR-0001** : un contrôle qui se répète par ligne devient UN contrôle dans
  une zone fixe hors du conteneur défilant. Jamais un défilement de colonne.
- **Le dock est content-sized, sans splitter.** `react-resizable-panels` a été
  RETIRÉ le 2026-07-21 ; ne rien proposer qui le suppose.
- **`components/` ne porte aucune logique métier.** Cette frontière ne bouge
  pas pour ajouter un geste.
- **`test:render` doit rendre zéro écart** après tout travail de panneau —
  c'est le gate discriminant : un écart prouve qu'on a touché au rendu en
  croyant toucher à l'affichage.

## Trois choses où nous faisons MIEUX qu'eux

À ne pas dégrader en copiant, et à vérifier avant d'adopter un mécanisme qui
les toucherait : un masque **par effet** (Photoshop n'en a qu'un pour toute sa
chaîne de Smart Filters), une applicabilité **déclarée et relue** par
`validateEffect`, et `EffectParam.maxFrom`, dont Spectrum n'a pas d'équivalent.
