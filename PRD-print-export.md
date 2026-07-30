# PRD — Export print (vente de tirages via labo)

> Cadré via `interview` le 2026-07-20. Nommé `PRD-print-export.md` (pas
> `PRD.md`) car `PRD.md` porte déjà un autre chantier concurrent (migration
> shadcn/ui, non consommé par `brainstorming`) — ne pas fusionner les deux.

## Contexte

> **Mise à jour 2026-07-30.** Ce PRD a été écrit quand l'export JPEG servait le
> round-trip Lightroom. Celui-ci est déposé (ADR-0002, code retiré) : l'export
> JPEG existe toujours et reste inchangé, mais il écrit désormais TOUJOURS une
> copie, jamais par-dessus la source. Les contraintes de non-régression
> ci-dessous portent donc sur « l'export JPEG existant », pas sur un contrat
> d'écrasement — elles restent valables, leur justification change.

shaderlab a un pipeline de rendu 8-bit sRGB et un seul export (JPEG, copie dans
un dossier d'export). Antoine veut à terme vendre des tirages physiques
de ses œuvres. Le tirage est réalisé par un **labo/imprimeur externe**, pas par
Antoine lui-même. Le pipeline 8-bit actuel n'est pas armé pour ça : les effets
qualité (bloom, halation, courbes de contraste) produisent des dégradés larges
qui **bandent visiblement en 8-bit**, bien plus sur un tirage qu'à l'écran.

Delta noté en parallèle, hors scope de ce PRD (à rouvrir en interview quand le
chantier effets reprendra) : **motion blur** et un **étage color grade**
(courbe + bleach bypass + split-tone) comme nouveaux effets créatifs.

## Objectif

Permettre l'export d'un fichier maître fidèle, sans banding et exploitable
sans ambiguïté par un labo photo externe, pour toute œuvre destinée à la
vente en tirage physique.

## Comportements

- Quand une œuvre est prête pour la vente, Antoine choisit **« Exporter pour
  impression »** (distinct de l'« Exporter sous » JPEG existant).
- Quand cet export s'exécute, le pipeline de rendu calcule en **16-bit float**
  (au lieu du 8-bit actuel) pour tous les effets et le compositing de calques,
  afin d'éliminer le banding sur les dégradés. Le calcul reste en **primaires
  sRGB** (même espace de travail que l'écran, `CLAUDE.md` § Stack) — seule la
  profondeur change, pas le gamut de calcul.
- Quand le fichier est écrit, une **conversion de gamut explicite sRGB →
  Adobe RGB (1998)** (primaires + fonction de transfert Adobe RGB) est
  appliquée aux pixels avant écriture — étiqueter directement des valeurs en
  primaires sRGB avec un profil Adobe RGB sans les reprojeter décalerait les
  couleurs. Le fichier produit est un **TIFF 16-bit/canal, profil ICC Adobe
  RGB (1998) embarqué** — jamais CMYK (conversion faite par le RIP du labo,
  pas par shaderlab).
- Quand l'export se fait, la **résolution native** de l'image source est
  conservée telle quelle — aucun upscale, aucun resampling.
- Avant de confirmer l'export (pas après), Antoine saisit une **taille de
  tirage cible** (ex. largeur en cm) ; le **DPI résultant** à cette taille
  s'affiche immédiatement, pour qu'il sache AVANT de lancer l'export jusqu'à
  quelle taille le tirage restera net — sans que shaderlab décide une taille
  à sa place, et sans bloquer l'export si le DPI est bas (juste informer).
- Quand un fichier existant serait écrasé, la même règle d'écriture atomique
  (tmp+rename) que l'export JPEG s'applique.

## Hors-scope explicite

- **Soft-proofing dans l'app** (simulation papier+imprimante à l'écran) —
  pas nécessaire tant que le tirage passe par un labo externe qui gère son
  propre profil.
- **Upscale / super-résolution** — aucune tentative d'agrandir au-delà de la
  résolution native de la photo source.
- **CMYK** — jamais produit par shaderlab ; c'est un format offset, pas
  fine-art/labo photo.
- **Gestion de plusieurs profils ICC cibles** (imprimante perso, autre
  gamut) — un seul profil de sortie (Adobe RGB) pour cette itération ; à
  rouvrir si Antoine passe un jour à l'impression perso.
- **Motion blur / color grade** (nouveaux effets créatifs) — différés,
  cadrage séparé prévu.
- **Modification du flow d'export JPEG existant** — il n'est ni remplacé ni
  touché.

## Contraintes d'inacceptable

**Inacceptable (projet, déjà figé)** :
- Rupture du pipeline linéaire strict / conversion sRGB↔linéaire automatique
  par le format (`CLAUDE.md` § Stack) — le nouveau chemin 16-bit reste sur ce
  principe, il ne le contourne pas.
- Régression de l'export JPEG existant (chemin JPEG inchangé).

**Inacceptable (feature print)** :
- **Banding visible** sur un dégradé produit par bloom/halation/courbe sur le
  fichier exporté — c'est précisément ce que le 16-bit doit éliminer ; s'il
  bande encore, le fork n'a pas atteint son but.
- **Fichier sans profil ICC embarqué, ou mal taggé** — le labo interpréterait
  les couleurs au hasard, le tirage ne correspondrait plus à ce qui a été vu
  à l'écran.
- **Résolution silencieusement insuffisante** — un export qui descend sous un
  DPI net à la taille visée sans qu'Antoine en soit informé à l'avance.

## Terminé = démontrable

- Sur une fixture synthétique dont les valeurs sont choisies **hors grille
  8-bit** (aucun échantillon aligné sur un multiple de 256, pour qu'une
  quantification intermédiaire soit forcée de produire un écart mesurable),
  la sortie TIFF est comparée numériquement à une référence calculée
  indépendamment en haute précision (même dégradé, même conversion de gamut,
  jamais quantifiée en 8-bit) avec une **tolérance strictement inférieure à
  l'erreur minimale qu'une quantification 8-bit produirait** — un comptage de
  niveaux ou une détection de paliers seuls ne suffit pas : la conversion de
  gamut peut redistribuer les valeurs hors des multiples de 256 même si le
  pipeline a quantifié en 8-bit avant, donc seule une comparaison à une
  référence float indépendante prouve l'absence de quantification
  intermédiaire.
- Une œuvre réelle avec un dégradé fort (bloom+halation empilés) exportée en
  « Exporter pour impression » ne montre aucun banding visible à un zoom
  100% sur le TIFF résultant.
- Le TIFF produit s'ouvre dans un visualiseur qui affiche son profil ICC
  (ex. Photoshop, ou `exiftool`) et rapporte bien Adobe RGB (1998), 16
  bits/canal — et un jeu de valeurs de référence connues (rouge pur, vert
  pur, bleu pur, gris neutre, une couleur mixte) retombe, une fois converti
  par ce profil, sur les valeurs Adobe RGB attendues pour chacune (pas
  seulement le rouge, pour couvrir toute la matrice de conversion — pas la
  valeur sRGB brute mal étiquetée).
- Avant de lancer l'export, en saisissant une taille de tirage cible (ex.
  A3), le DPI résultant s'affiche immédiatement.
- L'export JPEG existant (« Exporter » et « Exporter sous ») continue de
  fonctionner sans changement de comportement observable.

## Annexe — Choix techniques déduits (à valider)

- **Pipeline de calcul en 16-bit float** (textures internes/ping-pong en
  `rgba16float` plutôt que `bgra8unorm-srgb`) pour l'export print — seul
  moyen d'éliminer le banding sur les dégradés d'effets empilés. Impact
  transversal (gpuContext, renderer, chaque effet) ; probablement une passe
  de rendu séparée dédiée à ce mode, pour ne pas alourdir le rendu temps réel
  écran qui reste 8-bit.
- **TIFF 16-bit, Adobe RGB (1998), ICC embarqué** comme format de sortie —
  standard accepté universellement par les labos fine-art, gamut suffisant
  sans exiger la rigueur ProPhoto (qui, elle, imposerait 16-bit strict sous
  peine de banding sévère).
- **Conversion de gamut explicite sRGB → Adobe RGB avant écriture** (matrice
  de primaires + fonction de transfert Adobe RGB), pas un simple tag ICC sur
  des valeurs restées en primaires sRGB — sinon le profil ment sur ce que
  contiennent réellement les pixels et le labo restitue des couleurs fausses.
- **Pas de resampling** — la résolution native reste la seule vérité ; le DPI
  est une donnée dérivée (résolution ÷ taille physique visée), jamais un
  paramètre d'export qui déclencherait un upscale.
- **Second point d'entrée d'export** plutôt qu'un flag sur l'export existant
  — isole tout risque de régression sur le chemin JPEG, dont le comportement
  (copie vers le dossier d'export, jamais d'écrasement) est déjà verrouillé
  par des tests.

---

**PRD prêt.** Prochaine étape : `superpowers:brainstorming` pour concevoir le
COMMENT (découpage en tranches, où insérer la passe 16-bit dans le renderer
existant) — à lancer quand Antoine valide ce document.
