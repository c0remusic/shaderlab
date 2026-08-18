# Ce que coûte un modèle de vision embarqué

Type: research
Status: open
Parent: ../map.md

## Question

Ouvert le 2026-08-18 par l'arbitrage d'Antoine sur le
[ticket 08](08-lesquels-des-cinq-differes-de-masquage.md) : la décision produit
« embarque-t-on un modèle de vision ? » ne peut pas se prendre, personne n'ayant
les chiffres. Cette recherche les rapporte ; **elle ne tranche pas**.

Deux capacités différées par le PRD de masquage en dépendent, et d'une seule et
même façon — **depth mask** (masque par profondeur) et **segmentation
sémantique** sujet / ciel / arrière-plan. Le PRD est explicite sur le moyen : un
modèle de vision monoculaire **LOCAL**, type MiDaS / Depth-Anything, **PAS un
LLM**, et pas un service distant.

**Que coûte réellement d'embarquer un tel modèle dans cette app ?**

## Ce qu'il faut rapporter, et sous quelle forme

Des chiffres et des sources, pas une recommandation. Chaque réponse doit porter
sa source et sa date — un chiffre de modèle sans version ni date ne vaut rien.

1. **Les poids.** Pour les familles citées et leurs concurrents sérieux :
   taille sur disque des variantes réellement utilisables (pas seulement la plus
   petite), et **la LICENCE de ces poids**. ⚠️ C'est la question bloquante :
   beaucoup de modèles de vision ont un code permissif et des poids en licence
   non commerciale, et shaderlab est distribué. Distinguer explicitement licence
   du CODE et licence des POIDS.
2. **Le runtime d'inférence côté Rust.** État réel de `ort`/ONNX Runtime,
   `candle`, `tract`, `wonnx` : maturité, cible Windows, ce que chacun ajoute au
   binaire, et s'il faut livrer des DLL à côté de l'exécutable. Les dépendances
   actuelles sont **cinq crates** (`serde`, `serde_json`, `tauri`, `rfd`,
   `percent-encoding`, plus `image`) — dire l'ordre de grandeur de l'écart.
3. **⚠️ La piste que ce dépôt a et que les autres n'ont pas : WebGPU.**
   L'app tient déjà un `GPUDevice` et une chaîne WGSL. Une inférence exécutée
   dans CE device (via `wonnx`, ou par des passes WGSL écrites à la main)
   éviterait un second runtime et un second contexte GPU. Question à instruire
   sérieusement, pas à écarter : est-ce praticable aujourd'hui, sur quels
   opérateurs ça bute, et est-ce que quiconque le fait en production ?
4. **Le temps d'inférence, et à quelle résolution.** Les photos ici font 26 Mpx.
   Un modèle de profondeur travaille en pratique sur une entrée bien plus petite
   puis on ré-échantillonne : dire **à quelle résolution ces modèles sont
   réellement évalués**, et ce que le ré-échantillonnage coûte en qualité de
   bord — un masque de profondeur flou sur les contours est inutilisable pour
   doser un effet.
5. **Segmentation : même famille ou autre chantier ?** Le ticket 08 supposait
   que oui sans le vérifier. Est-ce le MÊME runtime et le MÊME genre de poids,
   ou deux intégrations distinctes ? La réponse décide si les deux capacités se
   jugent ensemble ou séparément.

## Contraintes dures du dépôt, à ne pas contourner

- **Un masque DOSE un effet, il ne touche jamais les pixels.** C'est la frontière
  que le PRD de masquage pose, et c'est pourquoi il a ÉCARTÉ (pas différé) la
  décontamination de couleur de bordure. Un modèle qui produirait une image
  retouchée est hors sujet ; on veut une carte scalaire 0..1.
- **Le contrat de source de masque est étroit** : `MaskSourceModule`
  (`src/mask/sources/types.ts`) est une union FERMÉE à trois entrées, dont le
  WGSL reçoit `params: array<f32, 8>` et rend un flottant. Une source qui
  dépend d'une TEXTURE calculée hors shader n'entre pas dans ce contrat tel
  qu'il est — dire ce que ça implique, sans le concevoir ici.
- **Pas de distinction preview/export**, résolution native toujours. Une
  inférence lente n'a pas de mode dégradé où se cacher.
- **Aucune dépendance réseau à l'exécution.** Le PRD dit LOCAL.

## Ce que cette recherche ne fait PAS

Elle ne choisit pas de modèle, ne prototype rien, et ne dit pas si ça entre dans
le palier. Elle rapporte de quoi qu'Antoine tranche — et « le coût rend la
question sans objet » est un résultat parfaitement valide.

## Sortie attendue

Un document sous `.scratch/prochain-palier/research/`, sur le modèle des trois
recherches déjà résolues (09, 10, 18) : chaque affirmation sourcée et datée,
les incertitudes nommées comme telles, et une table de synthèse chiffrée.
