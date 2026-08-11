# Ce que Photoshop et Lightroom rendent lisible que nous ne rendons pas

Type: research
Status: resolved
Parent: ../map.md

## Question

shaderlab porte **23 effets**, dont trois très chargés — `curves` (37
paramètres), `lensFlare` (30), `outlines` (26, avec deux modes d'encre et trois
modes de détection). Le chantier de rationalisation des contrôles est soldé
(2026-08-05) : chaque effet DÉCLARE ses sections et ses applicabilités. Mais
personne n'a jamais comparé le résultat à un outil que des photographes
utilisent tous les jours.

**Comment Photoshop et Lightroom rendent-ils navigable une surface de contrôles
de cette taille, et qu'est-ce qu'ils font que nous ne faisons pas ?**

## Ce qu'il faut chercher — mécanismes, pas impressions

Le livrable utile n'est pas « leur UI est plus claire ». C'est le **mécanisme
nommé** et l'endroit où il s'applique :

- **Nommer.** Comment nomment-ils un réglage pour qu'on devine son effet sans
  l'essayer ? Nos noms sont français, métier, souvent longs (« Contracter /
  dilater », « Rayon des contours », « Force du tramage »). Quelle est leur
  discipline — verbe, substantif, unité affichée, plage nommée ?
- **Grouper.** Nous avons six catégories éditoriales dans `effects/catalog.ts`
  et un vocabulaire de section FERMÉ (`liste` · `paire` · `grille` · `pose` ·
  `figure`). Comment groupent-ils, et sur quel critère — la fonction, l'ordre
  du geste, la fréquence d'usage ?
- **Révéler par étapes.** Basique / avancé, replier, « plus d'options ». Quel
  critère décide ce qui est visible d'emblée ? Nous masquons déjà par
  applicabilité (`EffectParam.appliesWhen`), ce qui n'est PAS la même chose :
  nous cachons ce qui est sans objet, pas ce qui est rare.
- **Trouver.** Y a-t-il une recherche de commande ou de réglage ? Comment
  Photoshop expose-t-il ses filtres, Lightroom ses panneaux ?
  ⚠️ **Correction du 2026-08-11** — ce ticket disait « à 23 effets nous n'avons
  ni recherche ni filtre ». C'est **FAUX** : `EffectPicker.tsx` porte un champ
  « Rechercher un effet » avec groupement par catégorie, état vide et remise à
  zéro à la fermeture. Ce qui manque est le filtre par nom dans **Presets** et
  **Textures**, dont le patron est donc déjà écrit à côté.
- **Montrer l'état.** Comment signalent-ils qu'un réglage n'est plus au
  défaut, qu'un calque est masqué, qu'un effet est écrêté ? Nous avons une
  bannière de dérive sur les presets et rien d'autre. (Confirmé sur pièce :
  aucun indicateur « hors défaut », et **aucun reset au défaut** dans
  `ParamPanel.tsx`.)
- **Le clavier.** Raccourcis, modificateurs pendant un geste (Alt pour
  échantillonner, Maj pour contraindre).
  ⚠️ **Correction du 2026-08-11** — ce ticket disait « nous en avons très peu ».
  Sous-estimé : `Ctrl+I` d'isolation (`App.tsx:1443`), Maj = pas large sur les
  cinq manipulateurs, Maj/Alt/Ctrl pendant un drag de transformation,
  Ctrl+molette sur le dernier contrôle touché.
- **Comparer.** Avant/après, aperçu au survol, historique visible.
  ⚠️ **Correction du 2026-08-11** — ce ticket disait « un undo/redo sans
  surface ». **FAUX** : `Toolbar.tsx:129-140` porte deux boutons Annuler /
  Rétablir avec leurs raccourcis. Restent absents : l'avant/après et une
  surface d'historique.

> **Leçon de ce ticket, plus utile que ses réponses.** Trois de ses six axes
> partaient d'une absence AFFIRMÉE et non MESURÉE — reconstruites de mémoire
> depuis le ROADMAP au lieu d'être grepées. C'est exactement la faute que les
> `## Notes` de la carte interdisent (« mesurer sur disque avant de
> conclure »), commise dans le geste qui l'écrivait. Un ticket de recherche
> énonce l'état du dépôt : cet état se mesure, il ne se rappelle pas.

## Contraintes dures — une réponse qui les viole est inutilisable

- **ADR-0001 (densité), règle permanente.** Un contrôle qui se répète sur
  chaque ligne d'une liste devient UN contrôle unique dans une zone fixe
  (en-tête OU pied, **hors du conteneur défilant**), agissant sur l'élément
  sélectionné. Liste défilante DANS le panneau, hauteur bornée, **jamais un
  défilement de colonne**. Une proposition qui ajoute un contrôle par ligne
  est refusée d'avance.
- **Le dock est content-sized, sans splitter** (`PanelColumn` /
  `DockedPanelCard`) — `react-resizable-panels` a été RETIRÉ le 2026-07-21.
  Ne pas proposer un layout qui le suppose.
- **`components/` ne contient aucune logique métier** : aucun composant ne
  connaît `LayerStack` ni le renderer. Cette frontière ne bouge pas pour
  ajouter une carte au dock.
- **L'index d'un paramètre est persisté dans les presets** : une réponse qui
  demande de réordonner `params[]` est fausse. La catégorie et la section sont
  de l'AFFICHAGE.
- Le flux **Pile / Propriétés / Masque** est livré (2026-08-04) et remplace la
  navigation fragmentée d'avant. Comparer à CE flux, pas à celui des specs
  antérieures.

## Pièges de méthode, déjà payés dans ce dépôt

- **WebFetch hallucine et tronque sur les grandes tables de référence.** Pour
  toute extraction exhaustive (liste de panneaux, de raccourcis, de réglages),
  passer par une lecture de contenu brut, pas par le résumeur.
- **Une capture d'écran ne dit pas le mouvement.** Ne jamais inférer un
  comportement d'animation ou de transition depuis une image fixe — erreur
  déjà commise ici, actée comme règle permanente.
- `docs/design-system/photoshop-web-reference-tokens.md` existe déjà (valeurs
  relevées en direct sur photoshop.adobe.com le 2026-07-20). Le lire avant de
  re-relever quoi que ce soit, et signaler ce qui a changé plutôt que de
  l'écraser.

## Livrable

Un Markdown cité dans `.scratch/prochain-palier/research/`, structuré par
mécanisme. Pour chacun : ce qu'ils font, où ça s'appliquerait chez nous
(fichier concret), et ce que ça coûterait. **Il n'arbitre rien** — il fournit
la matière d'un grilling ultérieur.

## Answer

Résolu le 2026-08-11. Findings :
[`research/09-lisibilite-photoshop-lightroom.md`](../research/09-lisibilite-photoshop-lightroom.md)
— **31 mécanismes**, sourcés sur l'aide Photoshop, l'aide Lightroom Classic et
Spectrum, chacun avec son point d'accroche (fichier + ligne) et son coût.

**Les cinq à meilleur rapport, tous à accrochage existant** : retour au défaut
par double-clic sur le nom d'un curseur, Alt-clic pour tout le groupe (ce qui
donnerait enfin une FONCTION à `EffectSection.label`, aujourd'hui purement
décoratif) ; avant/après par touche maintenue (`framePipelineExecutor.ts:313`
filtre déjà sur `layer.enabled`, donc ni passe ni shader nouveau) ; mode Solo
des cartes, qui borne le NOMBRE de cartes ouvertes là où ADR-0001 borne leur
hauteur ; un œil par section portant quatre fonctions sur une case ; filtre
par nom dans Presets et Textures, dont le patron est déjà écrit dans
`EffectPicker`.

**Le plus intéressant conceptuellement** : Lightroom *fane et met en italique*
un preset inapplicable au lieu de le retirer, et fait du retrait une
PRÉFÉRENCE. Nous avons choisi l'inverse avec `EffectParam.appliesWhen`. Ça ne
dit pas que nous avons tort — ça dit qu'une troisième voie existe et n'a
jamais été instruite.

**Trois choses où nous faisons MIEUX**, à ne pas dégrader en copiant : un
masque PAR EFFET (Photoshop n'en a qu'un pour toute sa chaîne de Smart
Filters), une applicabilité déclarée ET relue par `validateEffect`, et
`maxFrom`, dont Spectrum n'a pas d'équivalent.

**Confirmés absents** : reset au défaut, indicateur « hors défaut »,
avant/après, surface d'historique, filtre dans Presets et Textures.

⚠️ Deux limites de la recherche, à ne pas oublier en la relisant : l'observation
directe de `photoshop.adobe.com` a ÉCHOUÉ (interface en Shadow DOM ; la percer
demandait d'exécuter du JS dans la session Photoshop authentifiée d'Antoine —
non fait, à raison). Et la section « Constat structurel majeur » de
`docs/design-system/photoshop-web-reference-tokens.md` est périmée DE NOTRE
CÔTÉ : elle met en garde contre un dock empilé au nom de `FloatingPanel`, qui
n'existe plus depuis le 2026-07-21. Signalée, pas écrasée.

Suite : [Quels mécanismes de lisibilité adopter](11-quels-mecanismes-de-lisibilite-adopter.md).
