# PRD — Dossier d'export dédié (export manuel)

## Contexte

Aujourd'hui, l'export manuel (bouton "Exporter") écrit toujours à côté de la
photo source, avec un suffixe `-edited`/`-edited-2`/... en cas de collision de
nom. Antoine a suggéré, lors du checkpoint visuel `document-export-safety`
(2026-07-24), qu'un dossier d'export dédié serait préférable — les fichiers
exportés s'accumulent aujourd'hui dans le même dossier que les originaux, ce
qui les mélange avec la photothèque source.

Le round-trip Lightroom (Lightroom exporte une copie → lance l'app → l'app
écrase ce même fichier → Lightroom réimporte) est un contrat séparé, documenté
dans `CLAUDE.md`, et reste **hors-scope** : il continue d'écraser le fichier de
lancement au même endroit, sans changement.

## Objectif

L'export manuel écrit par défaut dans un dossier dédié (`Images/shaderlab-export`)
plutôt qu'à côté de la photo source, avec une option pour choisir un autre
dossier au cas par cas.

## Comportements

- Quand l'utilisateur clique **"Exporter"** → le fichier est écrit dans
  `Images/shaderlab-export` (dossier utilisateur Images), silencieusement, sans
  dialogue de confirmation.
- Quand `Images/shaderlab-export` n'existe pas encore → il est créé
  automatiquement et silencieusement au moment de l'export.
- Quand l'utilisateur clique **"Exporter sous..."** (bouton séparé, à côté
  d'"Exporter") → un dialogue de choix de dossier s'ouvre, permettant de
  choisir un autre emplacement pour cet export précis uniquement (pas de
  changement du dossier par défaut).
- Le nom de fichier dans `Images/shaderlab-export` reprend le nom de la photo
  source sans suffixe `-edited` — le dossier étant déjà séparé de la source, ce
  suffixe ne sert plus qu'en cas de collision réelle DANS ce dossier (deux
  exports de photos différentes portant le même nom de fichier source) ; dans
  ce cas, le suffixe `-edited-N` existant s'applique comme aujourd'hui.
- Une erreur d'écriture (permissions, disque plein, dossier introuvable)
  affiche toujours un message visible à l'utilisateur — jamais un échec
  silencieux.

## Hors-scope explicite

- Le dossier d'export n'est **pas configurable** dans un écran de réglages —
  emplacement fixe (`Images/shaderlab-export`), seul l'override ponctuel via
  "Exporter sous..." permet un autre chemin.
- Les fichiers déjà exportés avant ce changement (à côté de leur photo source)
  ne sont **pas migrés** — aucune détection, aucun déplacement automatique.
  Le nouveau comportement ne s'applique qu'aux exports futurs.
- Le round-trip Lightroom (écraser le fichier de lancement au même endroit)
  n'est **pas touché** par cette feature.

## Contraintes d'inacceptable

**Inacceptable (projet)** :
- Perdre un export sans le signaler à l'utilisateur.
- Casser silencieusement le contrat round-trip Lightroom.

**Inacceptable (feature)** :
- Écraser un export précédent sans que ce soit voulu par l'utilisateur — la
  logique de collision (suffixe `-edited-N`) doit rester active et fiable dans
  le nouveau dossier.
- Échouer silencieusement à créer `Images/shaderlab-export` ou à y écrire.

## Terminé = démontrable

- Un export via "Exporter" produit un fichier visible dans
  `Images/shaderlab-export` (créé automatiquement s'il n'existait pas), sans
  suffixe `-edited` sauf collision réelle.
- Le bouton "Exporter sous..." ouvre un dialogue de choix de dossier
  fonctionnel et écrit l'export à l'emplacement choisi, sans changer le
  dossier par défaut des exports suivants.
- Un export en échec (dossier protégé, disque plein simulé) déclenche un
  message d'erreur visible, pas un échec silencieux.
- Le round-trip Lightroom (test manuel documenté dans `CLAUDE.md`) continue de
  fonctionner sans régression.

## Annexe — Choix techniques déduits (à valider)

- **Résolution du dossier `Images/shaderlab-export`** : passer par l'API
  répertoires standards de Tauri v2 (`@tauri-apps/api/path`, `pictureDir()` +
  join) plutôt que coder un chemin en dur — cohérent avec le pattern déjà
  utilisé pour `get_launch_path`/`pick_image_file` (commandes Rust dédiées,
  jamais `tauri-plugin-dialog` — bug connu documenté dans `CLAUDE.md`).
- **Création automatique du dossier** : équivalent `create_dir_all` côté Rust
  avant l'écriture, dans la même commande que l'écriture atomique
  tmp+rename déjà en place (`buildCopyPath`/`resolveExportTargetAsync` dans
  `src/export/exportImage.ts`) — réutilise le mécanisme existant, change
  seulement la résolution du dossier cible.
- **"Exporter sous..."** : dialogue de choix de DOSSIER (pas de fichier) —
  nécessite une commande Rust dédiée équivalente à `pick_image_file` mais pour
  un dossier (`rfd::FileDialog::pick_folder`), même contournement que le bug
  `tauri-plugin-dialog` déjà documenté.
- **Suffixe de collision simplifié** : la logique de génération de nom dans
  `buildCopyPath` reste la même fonction, seul l'input change (dossier cible
  différent) — pas de nouvelle logique de collision à écrire.

PRD prêt → lancer `superpowers:brainstorming` pour concevoir la solution
(le COMMENT : découpage en tranches, modules touchés, séquencement).
