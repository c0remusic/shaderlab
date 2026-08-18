# Ce que coûte un modèle de vision embarqué

Type: research
Status: resolved
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

---

## Answer — RENDUE le 2026-08-18

[`research/29-modele-de-vision-embarque.md`](../research/29-modele-de-vision-embarque.md)
— 1135 lignes, provenance marquée par affirmation (**BRUT** / `[résumé]` /
`[non vérifié]`), 63 incertitudes nommées, dix trous listés en un endroit.
**Elle rapporte, elle ne tranche pas** — la décision produit reste entière.

### Ce qui décide, et ce n'est pas ce qu'on attendait

**Le mur n'est pas le coût. C'est la NETTETÉ DE BORD, et elle est plafonnée
avant qu'un modèle entre en jeu.** Ces modèles n'évaluent pas la photo : ils
voient **784 × 518**, soit **1,6 %** d'une photo 26 Mpx, et on ré-échantillonne
×64 en surface. Conséquence chiffrée : une erreur d'**1 pixel inféré vaut 8
pixels sur la photo**, et le **F1 de frontière plafonne à 0,065 même avec une
profondeur PARFAITE** (oracle, vérité terrain).

Or l'usage visé est de doser un effet par la distance. Un masque flou sur les
contours ne le fait pas.

Le seul modèle qui déplace ce plafond (Depth Pro, 0,311 — il voit 1536²) a des
poids « **exclusively for Research Purposes** », code permissif compris. **Le
plafond et la licence sont donc corrélés**, et c'est ça le vrai résultat.

### La licence des poids : le piège est réel, et il est contre-intuitif

⚠️ **Depth-Anything V2 scinde sa licence PAR TAILLE** : Small en `apache-2.0`,
**Base / Large / Giant en `cc-by-nc-4.0`** (README + cartes HF, deux sources
primaires concordantes). Et **V1 est permissif à toutes les tailles**.

**Donc « prendre le plus récent » est exactement le geste qui perd la licence.**
Une intuition normale de développeur produit ici le mauvais choix.

Existe aussi **Depth Anything V3** (nov. 2025), dont `DA3MONO-LARGE` est annoncé
Apache-2.0 et sort **profondeur + segmentation du ciel d'un seul modèle** — mais
la recherche relève une **contradiction de licence non résolue** sur
`DA3-LARGE-1.1` (README CC-BY-NC contre carte HF Apache-2.0) et refuse de
trancher. À vérifier en amont avant de s'en servir.

### Segmentation : même runtime, poids distincts, licences PIRES

Le ticket 08 supposait « même famille » sans le vérifier. Réponse : même
runtime, mais poids séparés — et **SegFormer, la famille dominante, est
recherche seulement**. SAM ne nomme rien. Les deux options MIT n'ont **aucun
export ONNX trouvé** (absence non prouvée).

### Le coût, une fois les mythes retirés

- `onnxruntime.dll` = **15,40 Mio mesuré**. Les « 76 Mo » qui circulent sont à
  **95 % du `.pdb`** — les reporter se trompait d'un facteur 5.
- `ort` par défaut : exécutable **20,47 Mo, aucune DLL obligatoire**. En
  WebGPU : **22,67 Mo de DLL obligatoires**. Contre **9,1 Mo** aujourd'hui.
- ⚠️ **Le « six crates » que ce ticket donnait comme ancrage est faux** : six
  sont les dépendances DIRECTES, le lockfile en porte **482**. L'écart réel est
  donc plus petit que le cadrage ne le suggérait.
- **Le temps ne dépend PAS des 26 Mpx** (91 ms sur V100 pour V2), puisque
  l'entrée est fixe. La contrainte « pas de distinction preview/export » ne mord
  donc pas ici — contrairement à ce que le brief supposait.

### La piste WebGPU : à moitié fermée, et pas du côté prévu

**En Tauri v2, le Rust natif ne voit PAS le `GPUDevice` de la WebView2**
(frontière de processus) : toute voie Rust *garantit* le second contexte GPU que
le ticket espérait éviter. `wonnx` est **archivé**, et il lui manque `Slice`.

La seule voie qui réalise l'idée est **en JavaScript** :
`executionProviders: [{ name: 'webgpu', device }]` depuis ORT Web 1.22.0 — non
documentée, et le bundle par défaut **l'ignore en silence** (`if (false)`).

✅ **Trou n°2 comblé le jour même, par sonde CDP sur la vraie fenêtre** :
`shader-f16` **est présente** sur cet adaptateur (19 features, 2 Gio de binding,
32 Kio de stockage de groupe, 1024 invocations). Donc fp16 est possible — 47 Mo
de poids au lieu de 94.
⚠️ **Mais l'adaptateur n'est pas le device** : `gpuContext.ts:120-125` ne demande
que `timestamp-query`, jamais `shader-f16`, et une feature ne s'ajoute pas après
création. Le device actuel ne peut donc pas faire de fp16 — ce n'est **pas une
limite du matériel, c'est une ligne de notre code**, et ce qui manque est
demandable.

### Ce qui reste à décider, et qui n'est pas dans ce ticket

La question produit — **embarque-t-on un modèle ?** — est entière et revient à
Antoine. Le trou n°1 de la recherche est celui qui pèse le plus sur elle :
**aucun chiffre de latence Windows grand public n'existe** pour ces modèles, et
il ne se comble que par une mesure locale.
