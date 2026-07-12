# shaderlab — design MVP

> Nom de projet provisoire (placeholder, jamais tranché, même logique que
> track-finder). Repo créé le 2026-07-12 sur `C:\Users\LEETJ\Desktop\shaderlab`.

## Quoi

App desktop Windows pour appliquer des effets visuels type "shader" (glow,
aberration chromatique, déplacement/warp liquide, grain) sur des photos
JPEG, empilables en calques comme des calques Photoshop, avec rendu temps
réel et masquage au pinceau. Née d'une frustration : aucun plugin Lightroom
natif ne permet ce type d'effet (pipeline RAW non-GPU de Lightroom), et le
studio de référence repéré (Serifa, sur Instagram) ne convient pas comme
solution clé-en-main.

Positionnement : pas encore tranché entre outil perso et produit à
partager (voir section Décisions). Le detourage/masquage manuel est dans
le scope v1 ; le détourage automatique par IA est noté en backlog.

## Contexte / origine

Recherche d'un équivalent "plugin Figma" pour Lightroom → aucun plugin
natif ne peut faire ça (Lightroom Classic n'expose pas de panneau shader
GPU tiers en live). Étude du fonctionnement réel de Dehancer : ce n'est
pas un plugin "dans" Lightroom mais un round-trip via **External
Editing** (Lightroom exporte une copie → l'app externe s'ouvre avec son
propre rendu GPU → sauvegarde → retour automatique dans la grille
Lightroom). C'est exactement le modèle qu'on reproduit : shaderlab EST
l'option "plugin", sans SDK Adobe propriétaire.

## Décisions actées pendant le brainstorm

- **Objectif** : pas encore tranché entre outil perso et produit
  partageable — on explore la faisabilité technique d'abord, la décision
  d'ambition (packaging, distribution) se fera après un premier
  prototype fonctionnel.
- **Rendu temps réel obligatoire** — feedback instantané en ajustant les
  curseurs, pas de calcul différé façon "appliquer puis attendre".
- **Bibliothèque d'effets intégrée + calques**, PAS un système de plugins
  ouvert façon marketplace Figma (SDK tiers, publication communautaire).
  Un vrai système de plugins ouvert est un projet à part entière, hors
  scope.
- **Plateforme** : Windows uniquement pour le v1.
- **Pas de distinction preview/export** — un seul pipeline de rendu, à la
  résolution native du JPEG source, en toutes circonstances (décision
  explicite de l'utilisateur : pas de downscale pour la preview). Le
  risque VRAM identifié en recherche est accepté sans mitigation
  préventive — à mesurer empiriquement une fois l'app codée, pas
  d'optimisation prématurée. Chiffre de référence : ~96 Mo est le coût
  d'**une seule** texture RGBA8 pour un JPEG 24MP (calcul brut, pas une
  mesure) ; le pipeline réel en consomme plusieurs multiples simultanément
  (ping-pong 2 render targets + une texture de masque par calque actif),
  donc l'usage VRAM réel est un multiple de ce chiffre, pas ce chiffre
  lui-même — d'où la mesure empirique plutôt qu'un budget théorique figé.
- **Historique** : undo/redo en mémoire pendant la session uniquement,
  pas de persistance disque, pas d'historique par photo consultable après
  fermeture.
- **Export** : toujours une copie, jamais d'écrasement du fichier source
  (cohérent avec le rôle d'éditeur externe Lightroom).
- **Masquage v1** : masque au pinceau (peint à la souris, niveaux de
  gris, comme un masque de calque Photoshop). Le détourage automatique
  par IA (sélection sujet, U²-Net/MobileSAM/AI Masks) est backlog post-v1
  — confirmé gratuit et exécutable 100% en local (pas d'API payante), mais
  complexité de dev jugée trop élevée pour un v1.

## Stack technique

**Tauri (coquille Rust minimale) + frontend React/TS + moteur de rendu
WebGPU (WGSL).**

- Rust/Tauri : uniquement la coquille — fenêtre, accès fichier
  (ouvrir/exporter), gestion des arguments de lancement (chemin d'image
  passé par Lightroom en éditeur externe). Aucune logique métier côté
  Rust.
- React/TS : toute l'UI (pile de calques, panneaux de réglages,
  historique) — réutilise les patterns déjà rodés sur track-finder.
- Moteur de rendu WebGPU : module dédié, indépendant de React, qui prend
  une image source + une liste de calques d'effets et produit une
  texture finale.

### Comparatif des approches (recherché et chiffré)

| Approche | Poids/RAM | Perf rendu | Réutilisation compétences | Verdict |
|---|---|---|---|---|
| **Tauri + WebGPU** | WebView2 (déjà sur Windows) : 20-100 Mo idle | WebGPU "map" directement sur D3D12/Vulkan/Metal — quasi natif pour ce type de charge (quelques passes shader/calque, pas des milliers de draw calls) | Élevée (React/TS/GLSL-like) | **Retenu** |
| Electron + WebGL | Chromium embarqué : 200-400 Mo idle | WebGL = couche OpenGL vieillissante, réelle perte de perf par rapport à WebGPU | Élevée | Écarté (poids + perf) |
| Natif (C++/D3D) | 10-20 Mo idle | Perf de référence | Nulle (aucun lien avec le stack actuel) | Écarté (courbe d'apprentissage, v1 trop lente à sortir) |

Sources : [Tauri vs Electron 2026 — tech-insider.org](https://tech-insider.org/tauri-vs-electron-2026/),
[Tauri vs Electron performance — gethopp.app](https://www.gethopp.app/blog/tauri-vs-electron),
[WebGPU vs WebGL — mashblog.com](https://mashblog.com/posts/webgpu-vs-webgl),
[WebGPU vs WebGL industry — openreplay.com](https://blog.openreplay.com/webgpu-vs-webgl-industry-moving/)

**Risque identifié** : le support WebGPU dans Tauri "n'est pas garanti
uniformément selon la plateforme" — dépend du WebView par défaut. Comme
le scope est Windows-only (WebView2/Edge, qui supporte WebGPU
nativement), ce n'est pas un blocage, mais c'est le **premier spike
technique à valider avant tout le reste** (voir Testing). Source :
[tauri-apps/tauri#6381](https://github.com/tauri-apps/tauri/issues/6381).

### Espace colorimétrique (trouvé en audit — non négociable)

Le glow/bloom, le grain et l'aberration chromatique sont mathématiquement
faux s'ils sont calculés directement sur les valeurs sRGB (gamma) du
JPEG décodé — hautes lumières cramées, dégradés de flou ternes. Pipeline
obligatoire : décodage JPEG → upload en texture flottante (f16) →
conversion sRGB→linéaire à l'entrée → tous les calculs de shader en
espace linéaire → conversion linéaire→sRGB uniquement à l'encodage final
avant écriture JPEG. Ce n'est pas une optimisation future, c'est un
prérequis correct dès le premier effet implémenté (le spike technique
doit inclure cette conversion, pas juste "afficher une image").

**Hypothèse assumée sur les profils couleur** : JPEG d'entrée traité
comme sRGB, sans lecture ni conversion de profil ICC embarqué (pas de
gestion Adobe RGB / ProPhoto RGB en v1). Si Lightroom exporte dans un
profil plus large via ses réglages d'éditeur externe, un décalage de
couleur est possible — accepté comme limitation connue du v1, pas
traité silencieusement.

## Architecture

### Système d'effets extensible

Chaque effet est un module autonome :
```
{ id, nom, schéma de paramètres (sliders/couleurs), source WGSL, apply() }
```
Les 4 effets v1 sont les 4 premiers modules enregistrés dans un registre.
Ajouter un 5e effet plus tard = un nouveau fichier, aucune modification du
moteur de rendu ni de l'UI de pile de calques.

**Effets v1** : Glow (bloom), Chromatic bleed (aberration chromatique),
Warp (déplacement liquide), Grain (bruit film).

**Backlog d'effets futurs — priorité confirmée par l'utilisateur** (dans
cet ordre) : Gooey merge, Channel mixer, Outlines, Pixel stretch, Slice
shift, Gradient map. (Warp est déjà couvert par le v1.)

**Backlog complet de référence** (catalogue officiel "Built by Figma",
Config 2026, pour inspiration/priorisation future — non développé au v1) :
- *Effects* : Bloom, Bokeh blur, Channel mixer, Chromatic metal, Color
  adjustment, Colored edges, Dither, Filter presets, Gooey merge,
  Gradient map, Halftone, Hatching, Lens distortion, Outlines, Pattern
  refraction, Pixel stretch, Pixelate, Slice shift, Warp.
- *Fills* (génèrent une texture, moins directement pertinents pour de la
  photo mais utilisables en overlay) : Clouds, Concentric patterns,
  Fractal noise, Glowing wave, Mesh gradient, Moire, Nebula, Pattern
  grid, Water caustic.

Sources shaders/effets pour l'implémentation : [LYGIA Shader Library](https://lygia.xyz/distort/grain)
(fonctions WGSL réutilisables, dont grain via bruit 3D), [geeks3d.com —
chromatic aberration GLSL](https://www.geeks3d.com/20101008/shader-library-chromatic-aberration-demo-glsl/)
(portable en WGSL), [Figma — Built by Figma shaders](https://help.figma.com/hc/en-us/articles/41409034424215-Built-by-the-Figma-team-shaders-and-plugins).

### Composants

- **Layer stack** : liste ordonnée `{ effectId, params, enabled, mask }[]`,
  réorganisable par glisser-déposer, chaque calque togglable on/off sans
  suppression.
- **Masque au pinceau** : chaque calque peut avoir un masque peint à la
  souris (niveaux de gris). Outils de base : pinceau (taille/dureté),
  gomme, remplissage plein/vide. Stocké comme texture WebGPU séparée par
  calque, mélangée à l'effet via une passe de composition. Référence de
  conception (pas de réutilisation de code, WebGL pas WebGPU, mais logique
  transposable) : [glbrush.js design](https://github.com/Oletus/glbrush.js/wiki/glbrush.js-design).
- **Rendu** : pipeline unique, toujours à la résolution native de l'image
  source.
- **Historique** : pile undo/redo en mémoire sur l'état de la layer stack
  + masques, perdue à la fermeture.
- **Export** : écrit toujours une copie ; si lancé depuis Lightroom
  (éditeur externe), écrit au chemin attendu par Lightroom pour le
  round-trip automatique — voir contrat précis ci-dessous (trouvé flou en
  audit, maintenant explicite).

### Contrat de round-trip avec Lightroom (précisé en audit)

Mécanisme réel de l'"External Editing" de Lightroom (celui que Dehancer
utilise, voir Contexte/origine) : Lightroom rend une copie de la photo
(ici un JPEG, vu que l'utilisateur travaille en JPEG) vers un chemin
temporaire ou choisi, puis lance l'app externe en lui passant **ce chemin
exact en argument de ligne de commande**. Pour que Lightroom détecte le
retour et réimporte automatiquement l'image modifiée dans le catalogue,
l'app doit **écraser ce même fichier, au même chemin, dans un format
compatible** (JPEG) — pas créer un fichier à côté avec un autre nom.

Ceci contredit en apparence la règle "Export = toujours une copie, jamais
d'écrasement" (section Décisions) : la résolution est que la copie se
fait **en amont**, par Lightroom lui-même au moment de lancer l'éditeur
externe (le fichier source original dans la bibliothèque Lightroom n'est
jamais touché) — shaderlab, lui, écrase bien le fichier temporaire qu'on
lui a passé, ce qui est le comportement attendu du round-trip, pas une
exception à la règle.

Ce contrat est une hypothèse basée sur le fonctionnement documenté de
Dehancer, **pas vérifié empiriquement sur shaderlab** — à confirmer dans
le spike technique (voir Testing) avant d'écrire le code d'export
définitif : lancer shaderlab avec un chemin de fichier en argument
(simulant Lightroom), vérifier qu'un simple écrasement au même chemin
suffit à ce que Lightroom réimporte correctement.

### Flux de données

```
Ouverture (drag&drop, dialogue fichier, ou lancement via éditeur externe
Lightroom avec chemin en argument)
  → décodage JPEG → upload texture GPU (résolution native)
  → layer stack vide par défaut (image brute)

Édition
  → ajout d'un calque d'effet (registre) → params par défaut
  → ajustement des params (sliders) et/ou peinture d'un masque
  → à chaque changement : re-rendu de la pile complète (multi-pass
    WebGPU, ping-pong entre 2 render targets) → affichage canvas
  → chaque changement d'état pousse un snapshot sur la pile undo/redo

Export
  → même pipeline de rendu, résolution native (identique à l'édition)
  → encodage JPEG → écriture sur disque en tant que COPIE
  → si lancé depuis Lightroom : écrit au chemin attendu pour le
    round-trip automatique
```

### Gestion d'erreurs

- Image non supportée/corrompue au chargement → message d'erreur clair,
  pas de crash, retour à l'état "aucune image chargée".
- WebGPU indisponible (GPU/driver trop ancien) → détection au démarrage,
  message explicite. Pas de fallback WebGL prévu (scope Windows-only,
  matériel récent supposé — YAGNI).
- Échec à l'export (disque plein, chemin protégé) → toast d'erreur,
  l'état d'édition en mémoire n'est jamais perdu.
- Limites de taille texture GPU (image extrême dépassant les limites
  WebGPU) → message d'erreur explicite au chargement plutôt qu'un
  plantage silencieux.

### Tests

- Tests unitaires (Vitest, comme track-finder) sur la logique pure :
  sérialisation de la layer stack, undo/redo, registre d'effets
  (ajout/suppression/réordonnancement). Pas de test unitaire du rendu GPU
  lui-même (non fiable/pertinent).
- Vérification visuelle manuelle pour la justesse des shaders (nature
  subjective de l'effet, pas de comparaison pixel-perfect automatisée en
  v1 — YAGNI).
- **Spike technique en tout premier**, avant tout le reste : prototype
  minimal Tauri + WebGPU affichant une image avec un seul shader, sur
  Windows réel — valide l'hypothèse technique risquée (support WebGPU
  dans Tauri/WebView2) avant d'investir dans le reste de l'architecture.
  Ce spike doit aussi couvrir, pour ne pas devoir réécrire le pipeline
  ensuite : (1) la conversion sRGB↔linéaire décrite ci-dessus, dès le
  premier shader, et (2) une validation basique du contrat de round-trip
  Lightroom (lancement avec un chemin de fichier en argument, écrasement
  au même chemin, vérification que Lightroom réimporte bien le résultat).

## UI (v1)

Layout 3 panneaux, inspiré de Dehancer Desktop et Nik Collection
(références visuelles étudiées) :

- **Gauche** : pile de calques — liste réordonnable par glisser-déposer,
  chaque calque avec icône œil (visibilité) et nom de l'effet.
- **Centre** : canvas plein écran + barre d'outils haute (undo/redo,
  bascule comparaison avant/après, bouton Export).
- **Droite** : panneau de réglages du calque sélectionné — sliders des
  paramètres + bouton reset, et outils de masque (pinceau, taille,
  dureté, gomme) quand un masque est actif sur ce calque.
- **Superposition de masque visualisable** (inspiré de Nik Collection) :
  bouton pour voir le masque en rouge semi-transparent par-dessus
  l'image, plutôt que de deviner sa forme.

Backlog UI post-v1, aligné avec le masquage IA déjà noté : Masques IA
(clic sur le sujet, façon Nik Collection AI Masks), Masques de profondeur
(carte de profondeur IA pour cibler par distance — plus ambitieux, à
revoir si pertinent).

Références étudiées : [Dehancer Desktop](https://www.dehancer.com/shop/desktop),
[Nik Collection — nouveautés (Masques de profondeur, Masques IA)](https://www.dxo.com/fr/nik-collection/whats-new/).

## Hors scope v1 (différé, pas écarté)

- Système de plugins ouvert (SDK tiers, marketplace) — déclencheur de
  réouverture : si un vrai besoin de contributions externes émerge après
  usage du v1.
- Détourage/sélection automatique par IA (U²-Net, MobileSAM) — gratuit et
  techniquement validé, mais complexité de dev trop élevée pour le v1.
  Déclencheur : une fois le masque au pinceau manuel jugé trop lent à
  l'usage réel.
- Masques de profondeur (façon Nik Collection) — plus ambitieux qu'un
  détourage sujet simple. Déclencheur : si le besoin de cibler par
  distance dans la scène se confirme à l'usage.
- Effets au-delà des 4 de base (voir backlog priorisé ci-dessus).
- Cross-platform Mac — déclencheur : décision de partager/distribuer
  l'app au-delà d'un usage perso.
- Distinction preview basse résolution / export haute résolution —
  écartée explicitement par l'utilisateur ; à reconsidérer seulement si
  la perf réelle mesurée s'avère insuffisante sur de grosses images.
