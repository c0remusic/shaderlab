# Ce dont le 16-bit a besoin hors du dépôt

Type: research
Status: resolved
Parent: ../map.md

## Question

`PRD-print-export.md` suppose trois choses qui vivent toutes HORS de ce dépôt.
Aucune n'a jamais été vérifiée — le PRD les range lui-même en « Annexe — Choix
techniques déduits (à valider) », et il dort depuis le 2026-07-20. Établir les
faits, sans rien décider :

1. **`rgba16float` comme cible de rendu dans WebView2.** Le pipeline actuel
   configure le canvas par `navigator.gpu.getPreferredCanvasFormat()` avec la
   variante srgb en `viewFormats` (`gpuContext.ts:64-78`). Une passe de rendu
   hors écran en `rgba16float` est-elle disponible dans le Dawn embarqué par
   WebView2 sur Windows/D3D12 — comme format `RENDER_ATTACHMENT`, et en
   lecture par `mapAsync` pour l'export ? Le filtrage linéaire sur une texture
   16-bit flottante y est-il garanti, ou demande-t-il une extension ? Citer la
   spécification WebGPU et l'état réel de Dawn, pas un souvenir.
2. **Écrire un TIFF 16-bit/canal avec profil ICC embarqué depuis Rust.** Quelle
   crate le fait réellement (pas « supporte le TIFF », mais : 16 bits par canal
   ET écriture d'un bloc ICC) ? Sa licence est-elle compatible avec ce projet ?
   Vérifier la licence est une règle de ce dépôt, pas une politesse —
   `webgpu-image-filter` n'en a AUCUNE et a été écarté pour ça.
3. **La matrice sRGB → Adobe RGB (1998).** Les primaires, le point blanc et la
   fonction de transfert exacts, depuis une source primaire (spécification
   Adobe, ou ICC), pas depuis un billet de blog. Le PRD insiste : étiqueter des
   valeurs restées en primaires sRGB avec un profil Adobe RGB décale les
   couleurs — donc la matrice doit être juste, pas plausible.

## Ce qui rendrait cette recherche fausse

Une réponse qui dit « oui c'est possible » sans citer de source vérifiable, ou
qui confond « le format existe dans la spécification WebGPU » avec « Dawn
l'expose dans WebView2 sur cette machine ». Le second se mesure ; le premier se
lit. Les deux sont demandés, et distinctement.

## Livrable

Un fichier Markdown de findings dans le dépôt, une source primaire par
affirmation. Il n'arbitre rien : il fournit les faits que
[Ce que coûte d'attendre le 16-bit](02-cout-d-attendre-le-16-bit.md) attend.

## Answer

Résolu le 2026-08-11. Findings :
[`research/01-16-bit-hors-du-depot.md`](../research/01-16-bit-hors-du-depot.md)
— 804 lignes, une URL par affirmation.

**Les trois questions posées, répondues OUI** :

1. **`rgba16float`** passe comme `RENDER_ATTACHMENT`, en blending, en
   `copyTextureToBuffer` + `mapAsync`, et **en filtrage linéaire**, sur un
   device demandé **sans aucune feature**. Établi trois fois séparément : spec
   W3C §26.1.1 (table extraite cellule par cellule), source Dawn à commit
   épinglé, et mesure live. `float32-filterable` ne vise que les formats
   **32 bits** ; contrôle négatif : `rgba32float` échoue sur le même device.
2. **TIFF 16 bits + ICC embarqué** : la crate `image` **0.25.10**
   (`MIT OR Apache-2.0`) fait les deux — et **elle est déjà une dépendance de
   ce dépôt**. `set_icc_profile` y est un vrai override, là où le défaut du
   trait renvoie `UnsupportedError`. Coût : un flag de feature et une
   transitive (`tiff` ^0.11.2, MIT). Le gate licence a mordu : `libtiff-sys`
   écarté (« non-standard »).
3. **Matrice sRGB → Adobe RGB** : seulement **4 coefficients non triviaux** —
   les deux espaces partagent exactement leurs primaires rouge et bleue et
   D65, donc aucune adaptation chromatique et canal vert identique.
   Recalculée en double précision, concordante à moins de 1e-15.

### Trois faits qu'on ne demandait pas, et qui pèsent plus que les réponses

- **`rgba16float` n'est PAS 16 bits uniformes** : ~11 bits utiles près du
  blanc, soit 32 à 64× plus grossier qu'un 16 bits ENTIER — alors que la
  sortie visée par le PRD *est* un TIFF 16 bits entier. Le plan du PRD porte
  donc une tension interne que personne n'avait vue.
- **Aucun format flottant n'a de variante `-srgb`.** L'invariant du projet
  « chaîne de couleur en sRGB par le FORMAT, jamais par un gamma manuel en
  WGSL » (7 modules de `src/render/`, décision verrouillée de `CLAUDE.md`)
  **ne peut pas s'appliquer** à un chemin 16-bit — en tension directe avec une
  clause « inacceptable » du PRD, qui exige justement de ne pas contourner ce
  principe.
- **`MAX_CANVAS_PIXELS = 64 Mpx`** (`src/render/limits.ts:88`, calibré par
  ADR-0007 sur des mesures VRAM) dépasse les limites par défaut du device en
  16 bits. Relevables sur demande explicite, mais plus gratuitement.

### Indéterminé, écrit tel quel

La mesure a été prise dans **Edge 151.0.4129.72, pas dans le WebView2 de
shaderlab** (aucun binaire construit sur disque) — trou déclaré, avec le
snippet pour le refermer. Backend D3D12 non mesuré ; un seul GPU (NVIDIA
Turing) ; aucun TIFF n'a été produit ni relu, donc l'écart de type de champ ICC
trouvé (`BYTE` au lieu de `UNDEFINED`, partagé par les deux crates) reste non
tranché ; IEC 61966-2-1 est payante et non lue.

### La leçon de méthode, qui vaut au-delà de ce ticket

Conclure du **seul code Dawn** aurait donné un fait **FAUX** sur
`rgba16unorm` : le code suggère filtrable, la mesure dit `UnfilterableFloat`.
C'est la spécification qui l'emporte, et c'est la mesure qui a tranché entre
les deux. Même famille que la règle déjà écrite ici — une conclusion tirée du
code seul n'est pas une preuve.
