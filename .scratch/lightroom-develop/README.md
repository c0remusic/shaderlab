# L'éditeur complet de Lightroom — pré-carte (à charter par `/wayfinder`)

**Énoncé d'Antoine, 2026-09-11** : « Je veux l'éditeur complet de Lightroom
ensuite » — « avec toutes les options » — « il est dispo en local si tu veux
voir le code, ou l'app ».

Ce dossier n'est PAS encore une carte : c'est ce qu'un wayfinder doit avoir
sous les yeux avant de grillager. Il contient l'INVENTAIRE mesuré du module
Développement de Lightroom Classic **14.5.1** (installé sur cette machine —
chaînes françaises `Resources/fr/TranslatedStrings.txt`, 973 presets XMP
intégrés, 541 clés `crs:` distinctes, module `Develop.lrmodule` miné) face à ce
que shaderlab porte déjà, et un instrument pour MESURER les bornes de chaque
curseur dans l'app elle-même (plugin Lua `assets/shaderlab-dump.lrdevplugin`).

## Ce que « complet » veut dire ici, et ce qu'il ne peut pas vouloir dire

- **Notre chaîne est JPEG sRGB 8 bits, un seul pipeline, résolution native**
  (CLAUDE.md). Lightroom en mode JPEG (pas RAW) est donc la référence exacte :
  balance des blancs RELATIVE (`IncrementalTemperature` / `IncrementalTint`,
  ±100), pas de profil d'appareil ni de Kelvin, pas de récupération de hautes
  lumières au-delà du blanc. C'est ce que Lightroom fait lui-même sur un JPEG.
- **Ce qui n'a pas de sens sans RAW ni catalogue** : profils d'appareil et
  étalonnage des primaires (Calibration), profils d'objectif par marque/modèle
  (Optics), HDR, débruitage IA (`AIDenoise`, ModelZoo), suppression générative,
  Upright automatique (détection de lignes par ML), correction des yeux rouges,
  épreuvage écran. À écarter explicitement, ou à porter en version MANUELLE
  (distorsion/vignettage manuels, perspective manuelle).
- **Notre modèle est en CALQUES**, le sien est une pile de réglages globaux +
  masques locaux. Question de conception centrale : un « calque de réglage »
  unique qui porte tout le module (comme un `curves` géant), ou un effet par
  panneau (Réglages de base, Courbe, HSL, Color Grading, Détail, Optique,
  Transformation, Effets) ? Le registre a déjà `curves`, `channelMixer`,
  `gradientMap`, `nettete`, `grain`, `lensDistortion`, `lensBlur` — des morceaux
  du module, dispersés, avec des index de presets gelés.
- **Ordre du pipeline** : Lightroom applique ses réglages dans un ORDRE FIXE
  (Optics → Transform → Basic → Curve → HSL → Grading → Detail → Effects), en
  lumière linéaire pour le ton. Chez nous, l'ordre est celui de la pile, choisi
  par l'utilisateur. Un « module complet » impose-t-il un ordre ?
- **16 bits** : le ton de Lightroom travaille en flottant linéaire ; notre
  invariant sRGB-par-le-format exclut un chemin flottant (`prochain-palier`
  ticket 02). Sur 8 bits, six curseurs de ton empilés POSTÉRISENT. C'est la
  contrainte qui peut faire ou défaire le chantier, et elle est mesurable
  avant une ligne (histogramme de sortie sur un dégradé).

## Périmètre tranché par Antoine le 2026-09-11 (avant la carte)

- **Optique : HORS** (« je m'en branle ») — profil d'objectif, distorsion et
  vignettage manuels, aberration, frange. 8 curseurs sortent.
- **Transformation : HORS, sauf le recadrage** — Upright, perspectives,
  rotation/échelle/aspect/décalage sortent. Le recadrage est livré (ticket 32
  de `retour-usage-execution`) ; ce qui lui manque encore par rapport à
  « Recadrer et redresser » de Lightroom : l'**angle** (redressement, ±45°) et
  la règle de redressement. À confirmer comme seul reste de ce panneau.
- Reste donc : **Réglages de base (15) · Courbe (9) · HSL / N&B (33) · Color
  Grading (14) · Détail (9) · Effets (vignettage 6 — le grain est livré) ·
  Étalonnage (7)** = **93 curseurs**, dont 4 existent tels quels. Plus les
  masques locaux (chaque réglage en version locale) et ce qui entoure le
  module (histogramme, avant/après, presets dosés) — à trancher au grilling.

## Décisions du 2026-09-11 (Antoine, sur mesure)

- **Étalonnage : GO** (« ok pour étalonnage ») — `issues/01`, en cours.
- **8 bits, le TON en un seul effet** (« fais comme tu peux », sur la mesure
  `research/02-huit-bits-mesure.md` : un effet par curseur perd 25 % des
  niveaux et creuse des trous de 7 ; un effet unique en flottant rend ce que
  Lightroom rend, à 8 bits, sans toucher l'invariant). `issues/02` = Réglages
  de base + courbe paramétrique, 22 curseurs, un effet. Le reste (HSL, Color
  Grading, Détail, Vignettage) reste un effet chacun.
- Reste à charter (`/wayfinder`) : HSL / N&B (33), Color Grading (14), Détail
  (9), Vignettage (6), l'angle du recadrage, masques locaux, entourage.

## Ce que le dépôt a DÉJÀ tranché sur ce sujet (ne pas rouvrir)

- `.scratch/prochain-palier/issues/10-quelles-fonctions-completeraient-les-notres.md`
  (2026-08-11) : « shaderlab n'a pas vocation à refaire Photoshop ». Les quatre
  modes non séparables, la netteté, la carte de déplacement, la courbe libre
  en sont sortis — livrés depuis. **L'énoncé du 2026-09-11 RENVERSE ce cadrage**
  pour Lightroom : c'est le module entier qui est demandé. À acter en ADR.
- Ordre des fonctions à ajouter, tranché le 2026-08-18 (`docs/ROADMAP.md`
  § 2bis) — à réconcilier.
- `docs/design-system/photoshop-web-observations-2026-07-27.md` et la carte
  `hybride-lightroom-photoshop` : la référence d'interaction est déjà les deux
  outils ; ce chantier ajoute la référence de FONCTION.

## Instrument : mesurer les bornes DANS Lightroom

Les bornes ne sont ni dans les XMP (des valeurs, pas des plages) ni lisibles
dans `Develop.lrmodule` (miné le 2026-09-11 : les défauts y sont, les `min/max`
non). Le SDK Lua les expose : `LrDevelopController.getRange(param)`.
`assets/shaderlab-dump.lrdevplugin/` est un plugin minimal qui écrit
`Documents/shaderlab-lightroom-ranges.txt` (clé, min, max, valeur courante) —
installation : Fichier → Gestionnaire de modules externes → Ajouter → ce
dossier ; puis, dans le module Développement avec une photo JPEG sélectionnée,
Fichier → Modules externes → « shaderlab : exporter les bornes ». Le fichier
produit se colle dans `research/01-…` à la place des bornes « usuelles ».

## Fichiers

- `research/01-inventaire-module-developpement.md` — le module, panneau par
  panneau : clé, libellé français mesuré, borne, et ce que nous avons.
- `assets/shaderlab-dump.lrdevplugin/` — l'instrument.
- `map.md` et `issues/` — n'existent pas encore : c'est le travail de
  `/wayfinder`, qu'Antoine frappe lui-même.
