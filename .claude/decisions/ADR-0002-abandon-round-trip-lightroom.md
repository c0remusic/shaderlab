---
id: ADR-0002
status: active
date: 2026-07-27
---

# Abandon du round-trip Lightroom : shaderlab devient un éditeur autonome

## Contexte

Le projet est né comme **éditeur externe Lightroom**, sur le modèle Dehancer :
Lightroom exporte une copie, lance l'app avec le chemin en argument, l'app écrase
ce même fichier, Lightroom réimporte. C'était le positionnement d'origine
(`docs/superpowers/changes/2026-07-12-shaderlab-mvp/design.md`) et il a façonné
trois mécanismes qui vivent encore dans le code.

En six semaines, l'app a dépassé ce cadre. Elle a désormais : une pile de calques
réordonnables avec opacité et modes de fusion, un masquage non destructif à
sources combinables (pinceau, dégradé, luminosité, plage de couleur) avec filtre
edge-aware, six effets GPU à qualité photographique, la double exposure avec
transform, l'écrêtage par photo, des presets exportables, l'isolation, la
duplication. Verbatim d'Antoine le 2026-07-27 :

> « Je pense qu'au niveau où on est, on peut abandonner Lightroom, notre app est
> beaucoup trop avancée pour être au niveau d'un plugin Lightroom. »

Le déclencheur immédiat : le round-trip est l'une des trois raisons pour
lesquelles la photo de fond a un statut spécial et ne peut pas être traitée comme
un calque ordinaire (voir Conséquences).

## Décision

**Le round-trip Lightroom est abandonné.** shaderlab est un éditeur autonome.

Ce que ça retire :
- Le mode « lancement » où l'app reçoit un chemin en argument et **écrase ce
  fichier précis** à l'export (`isLaunchFile`, `roundTripActive`).
- La bascule à deux modes de l'export, et la désactivation d'« Exporter sous… »
  en mode round-trip.
- La désactivation du round-trip dès qu'un calque photo existe.

Empreinte mesurée le 2026-07-27 : **31 occurrences dans 4 fichiers de code**
(`src/App.tsx`, `src/export/exportImage.ts`, `src/launch.ts`,
`src-tauri/src/lib.rs`). La trace documentaire est plus large — le round-trip
est le positionnement affiché dans `CLAUDE.md`, `ARCHITECTURE.md`, `CONTEXT.md`,
`PRD.md` et plusieurs design docs.

**Le retrait n'est PAS immédiat.** Cet ADR acte la décision ; la suppression du
code et la mise à jour des documents se font dans une tranche dédiée, pour ne pas
mêler un changement de positionnement à un chantier en cours.

## Conséquences

**Ce que ça libère, et c'est la raison d'être de cette décision :**

Le document de fond détermine aujourd'hui trois choses : les dimensions
(`imageSize`, repère de tous les masques et transforms), la cible d'export
(`sourcePath`), et le contrat d'écrasement Lightroom (`isLaunchFile`). La
troisième disparaît. Restent deux contraintes techniques, plus aucune contrainte
d'intégration externe.

Cela débloque le chantier que la question d'Antoine appelait — « on devrait
pouvoir utiliser n'importe quelle photo importée comme document de fond » —
et sa forme aboutie : **le document a sa propre taille de toile, et TOUTES les
images sont des calques**, y compris la première. C'est le modèle Photoshop,
celui vers lequel toutes les décisions du 2026-07-27 convergent (la photo est un
calque de plein droit, la pile s'affiche dans le sens Photoshop, l'arrière-plan
figure dans la liste).

**Ce qui reste à trancher, et n'est PAS décidé ici :**
- L'export garde-t-il le dossier dédié `Images/shaderlab-export` (chantier du
  2026-07-24) comme seul comportement ? A priori oui : il était déjà le mode
  « autonome » des deux.
- Que devient l'ouverture par argument de ligne de commande ? Elle peut rester
  comme simple « ouvrir ce fichier », sans le contrat d'écrasement.

**Ce que ça coûte :**
- Un utilisateur qui passait par Lightroom perd l'aller-retour automatique. Il
  exporte depuis shaderlab et réimporte à la main.
- Les documents ouverts par lancement n'écrasent plus leur source — changement de
  comportement visible, à annoncer si le produit est partagé un jour.

## Alternatives écartées

- **Garder le round-trip en plus du mode autonome.** C'est l'état actuel, et
  c'est précisément ce qui impose la bascule à deux modes, la désactivation
  d'« Exporter sous… », et le statut spécial du fond. Le coût est permanent et
  payé par des features qui n'ont rien à voir avec Lightroom.
- **Attendre que le chantier « toutes les images sont des calques » impose la
  décision.** Rejeté : la décision serait alors prise en passant, au milieu d'une
  tranche technique, sans être visible ni révisable.

## Croyances révisées

- Croyance : « shaderlab est un plugin Lightroom qui fait aussi éditeur
  autonome ».
  Réfutée par : l'état réel du produit au 2026-07-27 (calques, masquage
  non destructif, effets GPU, double exposure, écrêtage, presets) — le mode
  autonome est devenu le produit, le round-trip une contrainte résiduelle.
  Ce que ça change : le positionnement s'inverse dans toute la documentation, et
  le fond cesse d'avoir un statut protégé par un contrat externe.

Voir [ADR-0001](ADR-0001-densite-ui-controles-repetes.md) pour la règle de densité
posée le même jour.
