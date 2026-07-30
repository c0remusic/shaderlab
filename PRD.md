# shaderlab — PRD

> Cadré via `interview` le 2026-07-24/25. Premier PRD projet-entier de
> shaderlab (aucun n'existait avant — le PRD précédent, scopé à la migration
> shadcn/ui, est déplacé sans perte vers
> [`docs/prd-shadcn-migration.md`](docs/prd-shadcn-migration.md)). Rétro-cadré
> depuis l'état réel du projet (`CLAUDE.md`, `CONTEXT.md`) pour le socle
> existant ; interviewé en direct pour les deux features neuves (presets,
> double exposure). Prochaine étape : `superpowers:brainstorming` (le COMMENT)
> puis l'agent `architect` (`ARCHITECTURE.md`), à lancer quand ce document est
> validé.
>
> **Mise à jour 2026-07-30 — round-trip Lightroom déposé.** Ce PRD a été cadré
> quand shaderlab servait d'éditeur externe Lightroom. Le round-trip est
> abandonné ([ADR-0002](.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md),
> code retiré le 2026-07-30) : shaderlab est un éditeur autonome et tout export
> écrit une copie. Ce qui SURVIT est l'ouverture d'un fichier passé en argument
> de lancement (« Ouvrir avec » de Windows) — ouvrir, pas écraser. Les passages
> ci-dessous qui nommaient le round-trip sont corrigés sur place ; les
> contraintes qu'il imposait (« pas de round-trip avec un double exposure »)
> tombent d'elles-mêmes, sans rien changer aux exigences des features.

## Contexte

shaderlab est une app desktop Windows (Tauri v2 + React/TS + WebGPU/WGSL brut)
d'effets visuels shader temps réel sur photos JPEG, éditée en calques
non-destructifs avec masque au pinceau par calque. Elle a été cadrée comme
éditeur externe Lightroom (round-trip : Lightroom exporte une copie → shaderlab
l'écrase → Lightroom réimporte) ; ce positionnement est abandonné (ADR-0002,
voir le bandeau) et shaderlab est un éditeur autonome. Née d'une frustration : aucun plugin
Lightroom natif ne peut faire d'effets shader GPU (pipeline RAW fermé).
Positionnement outil perso vs produit partageable : pas encore tranché,
faisabilité d'abord (voir `CLAUDE.md`).

Deux besoins neufs motivent ce PRD : (1) refaire la même pile de calques à
chaque photo est répétitif — un système de **presets** manque ; (2) certaines
références visuelles (style "serifa" observé sur Instagram) utilisent un
**double exposure** — silhouette d'une photo superposée sur une autre — que le
modèle actuel (un document = une seule photo source) ne permet pas.

## Objectif

Étendre shaderlab avec (a) un système de presets pour réutiliser une pile de
calques d'une photo à l'autre, et (b) un mode double exposure pour composer
deux photos (sujet isolé + fond) — sans casser le modèle de calques
non-destructif existant.

## Comportements (quand X → Y)

### Socle existant (rétro-cadré, déjà livré)

- Quand un effet est ajouté à un calque → il est traité par un module shader
  autonome du registry (`glow`, `chromatic bleed`, `warp`, `grain`, `duotone`,
  `posterize`), avec version pipeline puis upgrade qualité obligatoire (jamais
  un rendu "filtre Photoshop 2005").
- Quand un calque a un masque → celui-ci dose l'effet pixel par pixel
  (`opacity * maskValue`), peint au pinceau à falloff radial, jamais une
  modification de l'image elle-même.
- Quand une photo est ouverte par argument de lancement (« Ouvrir avec » de
  Windows) → shaderlab l'ouvre comme n'importe quel autre document, et son
  export écrit une copie dans le dossier d'export. Il n'écrase JAMAIS le
  fichier reçu (l'écrasement était le round-trip Lightroom, déposé — ADR-0002).
- Quand un mode de fusion est appliqué → il combine la sortie du calque avec
  le résultat des calques du dessous (11 modes réels, pipeline linéaire strict
  sRGB, jamais de gamma manuel).

### Presets (nouveau, cadré 2026-07-24)

- Quand l'utilisateur sauvegarde un preset → toute la pile de calques actifs
  (effet, params, opacity, blendMode, ordre) est capturée, SANS les masques
  (spécifiques à chaque photo).
- Quand un preset est appliqué sur une photo dont la pile de calques n'est pas
  vide → une confirmation est demandée avant de remplacer la pile existante
  (les masques déjà peints seraient perdus sinon silencieusement).
- Quand l'utilisateur sauvegarde sous un nom déjà existant → confirmation
  avant d'écraser. Renommer un preset se fait par double-clic sur son nom
  dans la liste.
- Quand des params sont modifiés après application d'un preset → le système
  propose "mettre à jour le preset" (overwrite) ou "créer une copie"
  (nouveau preset), jamais une perte silencieuse de la modification.
- Quand un preset référence un effet supprimé/renommé du registry (dérive du
  code entre deux sessions) → le calque correspondant est ignoré à
  l'application (le reste du preset s'applique), avec un avertissement visible
  — jamais un échec bloquant total ni un silence complet.
- Quand l'utilisateur veut transporter un preset → un bouton Exporter écrit un
  fichier JSON sur disque, un bouton Importer le relit (partage par
  email/clé USB/dossier, pas de réseau).
- Placement UI : une carte dockée dédiée "Presets", **première de la colonne**
  (avant Calques/Réglages/Masques) — même mécanique que les cartes existantes
  (repliable, réorganisable). Voir `docs/wireframes/presets.html` (option 2
  retenue).
- **Dépendance de séquencement** : un chantier parallèle introduit un rail
  d'icônes manuel (`PanelRail`) + affichage contextuel des cartes (Calques/
  Réglages/Masque) — voir
  `docs/superpowers/specs/2026-07-24-shaderlab-contextual-panels-design.md`
  (direction confirmée par Antoine, **relecture du design doc encore en
  attente** au moment de ce PRD, pas encore implémenté). Si ce chantier passe
  avant Presets, la carte Presets devrait s'intégrer au même mécanisme
  (`useContextualPanel` + item `PanelRail`) plutôt que rester une carte
  toujours-visible isolée — point à trancher en `brainstorming`/`architect`
  selon l'ordre réel d'exécution des deux chantiers.

### Double exposure (nouveau, cadré 2026-07-24)

- Quand l'utilisateur importe une deuxième photo (silhouette) en plus de la
  photo de base (fond) → elle devient un **calque de photo**, positionnable/
  redimensionnable/rotatable manuellement sur le fond.
- Quand le sujet de la silhouette doit être isolé (fond effacé) → l'utilisateur
  peint le masque à la main avec l'outil pinceau existant (`MaskPainter`),
  aucune segmentation automatique en v1.
- Quand un calque de photo existe → il reçoit les mêmes effets/masques/modes
  de fusion qu'un calque d'effet classique (même modèle `LayerState`, étendu
  d'une source d'image propre + transform position/échelle/rotation).
- Limite dure : 2 photos sources maximum par document (silhouette + fond),
  pas de généralisation N-photos en v1.
  > **Amendement 2026-07-26 (tranche T5 « N photos », design
  > `docs/superpowers/specs/2026-07-26-shaderlab-photo-layer-parity-design.md`
  > §3.5)** — cette limite a été levée : le plafond livré est
  > `MAX_PHOTO_LAYERS = 4` calques photo par document (`src/layers/photoLayer.ts`),
  > soit au plus 5 photos sources (le fond + 4). L'exigence « limite dure
  > NOMMÉE et vérifiable, jamais codée en dur » reste, elle, entièrement
  > valable — seule la VALEUR change. Elle est elle-même provisoire : borne de
  > sécurité VRAM non encore mesurée, critère de révision écrit sur la
  > constante. Les mentions « 2 photos » ci-dessous (hors-scope, risques,
  > critères de fin) se lisent avec cet amendement.
- ~~Le round-trip Lightroom n'est PAS supporté en présence d'un double
  exposure en v1~~ — contrainte SANS OBJET depuis la dépose du round-trip
  (ADR-0002) : tout export est une copie, quel que soit le contenu de la pile.
  Le double exposure n'a plus rien à désactiver.

## Hors-scope explicite

- **Presets** : organisation par dossiers/tags (liste plate uniquement) ;
  bibliothèque de presets fournis par défaut avec l'app (seulement ceux créés
  par l'utilisateur).
- **Double exposure** : plus de 2 photos sources ; segmentation automatique du
  sujet (voir différé nommé dans `CONTEXT.md` — fast-follow, pas ce PRD).
  L'exclusion « round-trip Lightroom en présence d'un double exposure » qui
  figurait ici est sans objet depuis la dépose du round-trip (ADR-0002).
- Unifier visuellement shaderlab avec Sift ou Tuple, migrer Sift, toucher
  Tuple — inchangé depuis `docs/prd-shadcn-migration.md`, toujours hors-scope.

## Contraintes d'inacceptable

**Inacceptable (projet)** :
- Pas de rendu "filtre Photoshop 2005" sur un effet — barre de qualité déjà
  en vigueur, s'applique aussi aux calques de photo (double exposure).
- Pas de gamma manuel en WGSL — pipeline linéaire strict sRGB partout, y
  compris pour la seconde source image du double exposure.
- Pas de fallback silencieux sur une erreur de chargement (photo, preset,
  effet manquant) — toujours un signal visible, jamais un état qui se dit
  fini alors qu'il ne l'est pas.

**Inacceptable (presets)** :
- Aucune perte silencieuse de masques peints à l'application d'un preset —
  la confirmation est un plancher dur, pas une option désactivable.

**Inacceptable (double exposure)** :
- Pas d'appel réseau/cloud pour l'isolation du sujet, même en v2 (segmentation
  ML strictement locale, cohérent avec le différé `CONTEXT.md`).
- Le VRAM avec 2 photos pleine résolution chargées simultanément est un risque
  ouvert (déjà noté projet-large dans `CLAUDE.md` pour 1 photo — untested à 2)
  — à mesurer à l'usage réel avant de considérer la feature terminée, pas de
  budget théorique figé par avance.

## Terminé = démontrable

**Presets** : carte "Presets" dockée en tête de colonne, opérationnelle
(sauvegarder/appliquer/renommer/écraser/exporter/importer), confirmation de
remplacement vérifiée sur une pile non vide, effet manquant géré sans crash,
vérifié visuellement (Storybook + app réelle) et par tests sur la logique pure
(capture/application de pile).

**Double exposure** : import d'une 2e photo, transform manuel fonctionnel,
masque peint isolant le sujet, effets/blend applicables sur le calque de
photo, limite 2 photos respectée (le critère « absence de round-trip Lightroom
en présence de la feature » est tombé avec la dépose du round-trip, ADR-0002 :
il n'y a plus d'écrasement à constater absent) — vérifié visuellement (fenêtre réelle, CDP —
canvas WebGPU non capturable par Playwright, cf. `CLAUDE.md` § Moyen de
preuve) sur au moins une composition réelle bout en bout.

## Annexe — Choix techniques déduits

*(à affiner en phase de déduction avec Antoine avant `brainstorming` — liste
de travail, pas encore validée)*

- **Presets = fichier JSON** sérialisant `LayerState[]` sans `maskData` —
  format texte lisible/versionnable, cohérent avec "pas de réseau, transport
  par fichier".
- **Stockage local** des presets (dossier de config app, à confirmer via
  `@tauri-apps/api/path`) — pas de dépendance à un backend.
- **Calque de photo = extension de `LayerState`** (source d'image + transform
  optionnels) plutôt qu'un type de calque parallèle — réutilise tout le
  pipeline de rendu/masque/blend existant au lieu de dupliquer l'archi.
- **Isolation manuelle en v1 = `MaskPainter` existant**, zéro nouvelle
  dépendance — la segmentation ML est repoussée précisément parce qu'elle
  introduirait une inconnue technique non validée (voir différé `CONTEXT.md`).
