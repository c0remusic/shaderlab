# Ce que coûte un modèle de vision embarqué

Recherche du ticket [29](../issues/29-ce-que-coute-un-modele-de-vision-embarque.md),
menée le **2026-08-18**. Elle rapporte des chiffres et des licences ; **elle
n'arbitre rien** et ne recommande aucun modèle.

---

## Méthode et niveau de preuve — à lire avant de citer quoi que ce soit

Le dépôt a payé trois fois cette semaine pour des affirmations plausibles et
fausses. Chaque affirmation ci-dessous porte donc son **niveau de preuve**, et il
n'est pas le même partout :

| Niveau | Ce que ça veut dire | Marque |
|---|---|---|
| **BRUT** | Texte ou JSON récupéré par `curl`, lu tel quel, sans résumeur entre la source et moi | (aucune marque — c'est le défaut) |
| **RÉSUMÉ** | Passé par un extracteur qui résume. Plausible, pas relu sur la source brute | `[résumé]` |
| **CODE** | Lu dans ce dépôt, à la ligne citée | `[code]` |
| **NON VÉRIFIÉ** | Rapporté sans que j'aie pu confirmer sur une source primaire | `[non vérifié]` |

**Le choix de méthode qui porte tout ce document** : `curl` fonctionne depuis ce
harnais, donc **presque tout ici est du BRUT**. Les licences ont été lues dans le
fichier `LICENSE` réel ou dans l'en-tête YAML de la carte de modèle
(`https://huggingface.co/<repo>/raw/main/README.md`), jamais dans un article.
Les tailles de fichiers viennent de l'API Hugging Face
(`https://huggingface.co/api/models/<repo>?blobs=true`, champ `siblings[].size`),
donc ce sont des **octets réels sur le dépôt**, pas des tailles annoncées.

⚠️ **Deux pièges de méthode rencontrés, à ne pas repayer :**

1. **L'endpoint de LISTE de Hugging Face ne rend PAS la licence.**
   `…/api/models?author=depth-anything&full=true` rend `cardData` sans le champ
   `license` — les 48 modèles de l'organisation sont ressortis « (ABSENT) ».
   Seul l'appel **individuel** `…/api/models/<repo>` porte `cardData.license`.
   Conclure « pas de licence déclarée » depuis la liste serait faux sur les 48.
2. **La licence d'un ré-upload ONNX n'est PAS opposable à celle des poids
   d'origine.** Cas mesuré : `onnx-community/DepthPro-ONNX` se déclare
   `apple-ascl` (licence de code d'exemple, permissive) alors que les poids
   amont `apple/DepthPro` sont sous licence **Apple Machine Learning Research**,
   « exclusively for Research Purposes » (§1 ci-dessous). Un tiers ne peut pas
   élargir une licence amont. **Toujours remonter au dépôt d'origine.**

⚠️ **Troisième piège, celui qui a failli me faire écrire un chiffre faux** :
`curl` anonyme sur `api.github.com` est **rate-limité à ~60 requêtes/heure** et
rend un HTTP 403 dont le corps est un message, pas une erreur réseau — un script
qui ne lit pas le corps prend ça pour « dépôt absent ». La sortie est **`gh api`,
qui est authentifié dans ce dépôt** et n'a pas cette limite. Deux constats de ce
document (les tailles d'assets ONNX Runtime, le statut archivé de `wonnx`) n'ont
pu être établis que par cette voie.

**Ce que je n'ai PAS pu vérifier**, nommé une fois ici et rappelé sur place :
- Je n'ai **mesuré aucun temps d'inférence moi-même**. Tout chiffre de latence
  ici est rapporté d'une source, avec son matériel — jamais extrapolé.
- Je n'ai **pas d'avis juridique**. Là où une licence pose une question ouverte
  (§1.7, distillation depuis un enseignant non commercial), je pose la question
  et je m'arrête.
- La liste complète des trous est au **§7.6**, à lire avant de s'appuyer sur ce
  document pour trancher quoi que ce soit.

---

## §0. Le point de départ chiffré, côté dépôt

Pour que « ce que ça coûte » ait un dénominateur, mesuré sur disque le
2026-08-18 :

| Grandeur | Valeur mesurée | Source |
|---|---|---|
| `shaderlab.exe` en **release** | **9,1 Mo** | `src-tauri/target/release/shaderlab.exe` `[code]` |
| `shaderlab.exe` en debug | 10,9 Mo | idem |
| Dépendances Rust **directes** | **6** | `src-tauri/Cargo.toml` `[code]` |
| Paquets **verrouillés** (transitifs) | **482** | `grep -c '^\[\[package\]\]' src-tauri/Cargo.lock` `[code]` |

⚠️ **Le ticket dit « cinq crates » puis « six » ; les deux comptes sont justes et
tous deux trompeurs.** Il y a bien 6 dépendances directes, mais le `Cargo.lock`
en porte déjà **482** — l'essentiel venant de `tauri`. Un runtime d'inférence ne
se juge donc pas à « combien de crates il ajoute à une liste de six », mais à ce
qu'il ajoute à **9,1 Mo de binaire** et à **482 paquets**. C'est le seul cadrage
qui ne se périme pas.

Aucun bundle MSI/NSIS n'était sur disque : **la taille de l'installeur n'est pas
mesurée** — 9,1 Mo est l'exécutable, pas le paquet livré.

---

## §1. Les poids : tailles réelles et licences

### 1.1 Le résultat qui décide, en une phrase

**La famille Depth-Anything scinde sa licence par TAILLE de modèle, et le code
Apache-2.0 du dépôt ne dit rien des poids.** Le dépôt GitHub
`DepthAnything/Depth-Anything-V2` est sous Apache 2.0 (fichier `LICENSE` lu en
brut), et son README dit, ligne 180, mot pour mot :

> `Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license.`

Vérifié indépendamment sur les cartes de modèle (en-tête YAML `license:`) :
`Depth-Anything-V2-Small` → `apache-2.0` ; `-Base` → `cc-by-nc-4.0` ; `-Large` →
`cc-by-nc-4.0`. **Les deux sources primaires concordent.**

### 1.2 Tailles sur disque — poids d'origine

Octets réels lus via l'API HF le 2026-08-18. `maj` = `lastModified` du dépôt.

| Modèle | Fichier | Taille | Licence des POIDS | maj |
|---|---|---|---|---|
| Depth-Anything-**V2-Small** | `depth_anything_v2_vits.pth` | **94,6 Mo** | **apache-2.0** | 2024-07-08 |
| Depth-Anything-**V2-Base** | `depth_anything_v2_vitb.pth` | 371,9 Mo | **cc-by-nc-4.0** ⛔ | 2024-07-08 |
| Depth-Anything-**V2-Large** | `depth_anything_v2_vitl.pth` | 1 279,3 Mo | **cc-by-nc-4.0** ⛔ | 2024-07-08 |
| Depth-Anything-**V1** small-hf | `model.safetensors` | 94,6 Mo | **apache-2.0** | 2024-01-25 |
| Depth-Anything-**V1** base-hf | `model.safetensors` | 371,9 Mo | **apache-2.0** | 2024-01-25 |
| Depth-Anything-**V1** large-hf | `model.safetensors` | 1 279,2 Mo | **apache-2.0** | 2024-01-25 |
| Intel `dpt-hybrid-midas` | `pytorch_model.bin` | 467,0 Mo | apache-2.0 | 2024-02-09 |
| Intel `dpt-large` | `model.safetensors` | 1 304,1 Mo | apache-2.0 | 2024-02-24 |
| Intel `dpt-swinv2-tiny-256` | `model.safetensors` | 156,2 Mo | **mit** | 2024-06-21 |
| Apple `DepthPro` | `depth_pro.pt` | 1 816,2 Mo | **apple-amlr** ⛔ | 2025-02-28 |

⚠️ **Le fait le plus contre-intuitif de cette table : Depth-Anything V1 est
permissif à TOUTES ses tailles, V2 ne l'est qu'en Small.** À taille de fichier
identique au mégaoctet près (94,6 / 371,9 / 1 279 Mo — même architecture), V1
est Apache-2.0 partout et V2 bascule en CC-BY-NC dès Base. « Prendre la version
la plus récente » est donc, ici, le geste qui perd la licence.

⚠️ **Mais la preuve n'est pas de même force des deux côtés, et il faut le dire.**
Pour V2, la licence est écrite **deux fois** (README du dépôt *et* carte de
chaque modèle), et les deux concordent. Pour V1, elle n'est écrite **qu'une
fois** : le README du dépôt V1 ne contient **aucune** mention de licence
(recherche de `licen` : zéro occurrence), et les checkpoints bruts
(`LiheYoung/depth_anything_vitl14`) ne déclarent **aucune** licence sur leur
carte. Le `apache-2.0` de V1 vient uniquement des miroirs `-hf`
(`depth-anything-{small,base,large}-hf`) plus le fichier `LICENSE` Apache-2.0 du
dépôt. C'est cohérent et c'est probablement juste, mais **c'est une source
unique, pas un recoupement** `[incertitude nommée]`.

### 1.3 MiDaS — tout MIT, mais un projet à l'arrêt

`isl-org/MiDaS` : fichier `LICENSE` = **MIT License, Copyright (c) 2019 Intel
ISL**. Le README a une section `### License` qui dit `MIT License` et **ne
distingue pas les poids du code** ; les poids sont publiés comme *assets* des
releases du même dépôt, donc couverts par le même MIT (lecture de bon sens, pas
une clause explicite — `[incertitude nommée]`).

Tailles lues dans les assets de release via l'API GitHub :

| Release | Poids | Taille |
|---|---|---|
| **v3_1** (publiée 2022-12-24) | `dpt_swin2_tiny_256.pt` | 164,2 Mo |
| | `dpt_beit_large_512.pt` | 1 508,7 Mo |
| | `openvino_midas_v21_small_256.bin` | 31,6 Mo |
| **v3** (2022-12-15) | `dpt_hybrid_384.pt` | 469,9 Mo |
| | `dpt_large_384.pt` | 1 312,6 Mo |
| **v2_1** (2020-11-10) | `midas_v21_small_256.pt` | 81,8 Mo |
| | **`model-small.onnx`** | **63,7 Mo** |
| | `model_opt.tflite` | 63,3 Mo |

**Dernière release : 2022-12-24. Dernier commit : 2024-08-23.** MiDaS est le
choix le plus propre en licence et le plus ancien en état de l'art : c'est un
arbitrage, pas un détail.

### 1.4 Les variantes ONNX — c'est ce qui serait réellement livré

Un `.pth` PyTorch ne s'embarque pas ; ce qui se livre est un `.onnx`. Tailles
réelles, et **la licence est héritée du modèle amont** (les dépôts
`onnx-community` sont honnêtes là-dessus) :

| Dépôt ONNX | fp32 | **fp16** | int8/uint8 | q4f16 | Licence |
|---|---|---|---|---|---|
| `onnx-community/depth-anything-v2-small` | 94,5 Mo | **47,3 Mo** | 26,0 Mo | **18,2 Mo** | **apache-2.0** |
| `onnx-community/depth-anything-v2-base` | 370,9 Mo | 185,6 Mo | 97,6 Mo | 69,1 Mo | **cc-by-nc-4.0** ⛔ |
| `onnx-community/depth-anything-v2-large` | 1 275,0 Mo | 637,7 Mo | 331,3 Mo | 223,7 Mo | **cc-by-nc-4.0** ⛔ |
| `onnx-community/depth-anything-v3-small` | 99,9 Mo (`.onnx_data`) | — | — | — | apache-2.0 |
| `onnx-community/depth-anything-v3-base` | 393,0 Mo (`.onnx_data`) | — | — | — | apache-2.0 |
| `onnx-community/DepthPro-ONNX` | **3 626,7 Mo** | 1 814,6 Mo | 962,4 Mo | 572,5 Mo | `apple-ascl` ⚠️ voir §1.6 |
| MiDaS v2.1 `model-small.onnx` | 63,7 Mo | — | — | — | MIT |

**L'ordre de grandeur qui compte** : la seule option de profondeur à la fois
permissive et récente descend à **47,3 Mo en fp16** (ou 18,2 Mo en q4f16, avec
une perte de qualité que je n'ai pas mesurée). À comparer aux **9,1 Mo** de
l'exécutable actuel : le modèle serait **5 fois plus lourd que l'app**, et c'est
le cas le plus favorable.

⚠️ Les dépôts v3 utilisent le **format ONNX à données externes** : `model.onnx`
ne fait que 0,6 Mo et le poids réel est dans `model.onnx_data`. **Deux fichiers à
livrer, pas un** — un empaquetage qui n'embarquerait que le `.onnx` produirait un
modèle qui charge et ne prédit rien.

### 1.5 Depth Anything **V3** existe (nov. 2025), et sa licence est plus fine

Ce point corrige une hypothèse implicite du ticket, qui ne parle que de V1/V2.
`ByteDance-Seed/Depth-Anything-3` (dépôt GitHub sous Apache 2.0). Le README porte
une table de licences par modèle ; croisée avec les cartes HF :

| Modèle | Params | Taille | README GitHub | Carte HF | Capacités |
|---|---|---|---|---|---|
| `DA3-SMALL` | 0,08 B | 130,9 Mo | Apache 2.0 | apache-2.0 | prof. relative, pose |
| `DA3-BASE` | 0,12 B | 516,4 Mo | Apache 2.0 | apache-2.0 | prof. relative, pose |
| `DA3-LARGE` | 0,35 B | 1 567,7 Mo | CC BY-NC 4.0 | cc-by-nc-4.0 | prof. relative, pose |
| **`DA3-LARGE-1.1`** | 0,35 B | 1 567,7 Mo | **CC BY-NC 4.0** | **apache-2.0** | ⚠️ **contradiction** |
| **`DA3MONO-LARGE`** | 0,35 B | 1 274,8 Mo | **Apache 2.0** | **apache-2.0** | **prof. relative + segmentation du CIEL** |
| `DA3METRIC-LARGE` | 0,35 B | 1 274,8 Mo | Apache 2.0 | apache-2.0 | prof. métrique + ciel |
| `DA3-GIANT` | 1,15 B | 5 171,6 Mo | CC BY-NC 4.0 | cc-by-nc-4.0 | + splatting |

⚠️ **Contradiction entre deux sources primaires, à ne pas trancher ici.** Pour
`DA3-LARGE-1.1`, le README GitHub (ligne 221) dit **CC BY-NC 4.0** ; la carte HF
dit `apache-2.0` **à deux endroits** (en-tête YAML ligne 2, et table du corps
ligne 32 : `| **License** | Apache 2.0 |`). Les deux sont primaires et elles se
contredisent. `DA3-LARGE` (sans `-1.1`) est CC-BY-NC dans les deux, de façon
cohérente — l'écart ne porte que sur le `-1.1`. **Tant que ce n'est pas clarifié
en amont, s'appuyer dessus est un risque juridique, pas une lecture optimiste.**

⚠️ **Et l'anomalie est ISOLÉE, ce qui la rend plus suspecte, pas moins.** Les
deux autres modèles `-1.1` ont été vérifiés dans la foulée : `DA3-GIANT-1.1`
(5 171,6 Mo) et `DA3NESTED-GIANT-LARGE-1.1` (6 446,4 Mo) sont **cc-by-nc-4.0 sur
leur carte HF comme dans le README**. Le suffixe `-1.1` ne rouvre donc rien en
général ; seul `DA3-LARGE-1.1` diverge. La lecture la plus économique est une
**erreur de carte de modèle**, pas une re-licence délibérée — mais c'est une
inférence de ma part, pas une source `[incertitude nommée]`.

**Le modèle qui compte ici est `DA3MONO-LARGE`** : c'est la variante
*monoculaire* (les autres font de la pose multi-vues dont ce projet n'a que
faire), elle est **Apache-2.0 des deux côtés**, et sa carte HF déclare
explicitement, section `## Capabilities` :

> `- ✅ Relative Depth` / `- ✅ Sky Segmentation`

C'est **le seul point de convergence mesuré entre les deux capacités du ticket**
— voir §5. Prix : **1,27 Go de poids**, et pas de variante Small en mono
(`DA3-SMALL` fait de la pose, pas du ciel).

⚠️ **Et un second prix, qui tempère nettement l'enthousiasme : sa résolution
d'inférence par défaut est PLUS BASSE que celle de V2.** Lu dans son code
(`api.py:145-146`) : `process_res = 504` avec
`process_res_method = "upper_bound_resize"`, et `_resize_longest_side`
(`utils/io/input_processor.py:324`) met le **côté LONG** à 504 — soit
**504 × 336** sur une photo 3:2, contre **784 × 518** pour Depth-Anything V2
(§4.2). Le facteur d'agrandissement passe de 8,0× à **12,4×**. Sur le critère
qui décide de l'utilité d'un masque — la netteté du bord, §4.3 — **DA3MONO part
en retrait de V2**, malgré son millésime plus récent et ses 13 fois plus de
poids. Le « le plus récent est le meilleur » se trompe ici deux fois : sur la
licence (§1.2) et sur la résolution.

### 1.6 Apple Depth Pro — le cas d'école « code permissif, poids interdits »

C'est exactement le piège que le ticket annonce, et il est vérifiable à la ligne :

- **CODE** — `apple/ml-depth-pro`, fichier `LICENSE` : « Apple grants you a
  personal, non-exclusive license […] to use, reproduce, modify and redistribute
  the Apple Software, with or without modifications, in source and/or binary
  forms ». Permissif.
- **POIDS** — `apple/DepthPro`, fichier `LICENSE` du dépôt HF : « **This Apple
  Machine Learning Research Model** […] Apple hereby grants you a personal
  […] license […] **exclusively for Research Purposes**. You agree that any Model
  Derivatives You may create or that may be created for You **will be limited to
  Research Purposes** ».

**Poids disqualifiés pour une app distribuée.** Et le ré-upload
`onnx-community/DepthPro-ONNX` qui s'annonce `apple-ascl` ne change rien : un
tiers n'élargit pas une licence amont (§Méthode, piège 2).

### 1.7 Autres candidats sérieux relevés

| Modèle | Taille | Licence | maj | Note |
|---|---|---|---|---|
| `xingyang1/Distill-Any-Depth-Small-hf` | 94,6 Mo | **mit** | 2025-03-26 | voir avertissement ci-dessous |
| `xingyang1/Distill-Any-Depth-Large-hf` | 1 279,2 Mo | **mit** | 2025-03-26 | idem |
| `google/tipsv2-b14-dpt` | 602,8 Mo | **apache-2.0** | **2026-08-17** | publié la veille de cette recherche |
| `Ruicheng/moge-2-vitl-normal` | 1 262,5 Mo | mit | 2025-07-11 | |
| `Intel/zoedepth-nyu-kitti` | 1 316,4 Mo | mit | 2024-05-20 | profondeur métrique |
| `prs-eth/marigold-depth-v1-1` | **13 111,8 Mo** | openrail++ | 2025-05-20 | base diffusion, hors budget |
| `apple/coreml-depth-anything-v2-small` | 272,3 Mo | apache-2.0 | 2024-06-24 | CoreML, pas Windows |

⚠️ **Distill-Any-Depth : une question de licence ouverte que je ne tranche pas.**
Le dépôt est MIT, et les cartes HF déclarent `mit` — y compris pour la variante
Large, ce qui en ferait la seule profondeur « grande **et** permissive ». Mais le
README nomme ses **enseignants** dans sa table de modèles : `Dav2-small`,
`Dav2-base`, **`Dav2-large`** — c'est-à-dire Depth-Anything-V2-Large, qui est
**CC-BY-NC-4.0**. Le modèle Large est donc distillé depuis un enseignant non
commercial. Et le README écrit, section License : « **This sample code** is
released under the MIT license » — *sample code*, pas *weights*.

Savoir si un modèle distillé depuis les sorties d'un modèle CC-BY-NC est une
œuvre dérivée est une **question juridique non résolue**, et je n'ai pas
compétence pour la trancher. Je la signale parce qu'elle porte précisément sur la
seule option qui semblait lever la contrainte du §1.1.

---

## §2. Le runtime d'inférence côté Rust

Sauf mention contraire, les tailles d'exécutable de cette section ont été
**réellement construites et pesées** sur cette machine (cargo 1.96.0,
`x86_64-pc-windows-msvc`, profil release, le 2026-08-18) — ce ne sont pas des
tailles annoncées.

### 2.1 Le tableau d'état

| Runtime | Dernière version | Date | Licence | Pur Rust ? | GPU sous Windows | ONNX |
|---|---|---|---|---|---|---|
| **`ort`** | `2.0.0-rc.13` | 2026-07-28 | MIT OR Apache-2.0 (ONNX Runtime lui-même : **MIT**) | ❌ enveloppe C++ | ✅ DirectML, CUDA 13, TensorRT, **WebGPU** | ✅ natif, complet |
| **`tract`** | `0.23.4` | 2026-07-08 | MIT OR Apache-2.0 | ✅ **aucune DLL** | ⛔ **aucun** (Metal=Apple, CUDA=NVIDIA) | ✅ opsets **9 → 24** |
| **`candle`** | `candle-core 0.11.0` | 2026-06-26 | MIT OR Apache-2.0 | ✅ (CUDA via `cudarc`) | ⚠️ **CUDA seulement** | ⚠️ `candle-onnx`, ~80 ops |
| **`wonnx`** | `0.5.1` | **2023-09-30** | MIT OR Apache-2.0 | ✅ (wgpu) | ✅ Vulkan + DX12 | ⚠️ **82 / 170 ops** |

### 2.2 ⚠️ `wonnx` est MORT, et ce n'est pas une déduction depuis une date

**Le dépôt `webonnx/wonnx` est ARCHIVÉ** — drapeau `archived: true` de l'API
GitHub, pas une lecture d'activité. Vérifié **deux fois indépendamment** (c'est
le fait qui referme la question du ticket, il méritait un recoupement) :
`gh api repos/webonnx/wonnx` rend `{"archived": true, "pushed_at":
"2024-07-21", "open_issues_count": 40}`, et `crates.io/api/v1/crates/wonnx`
rend `max_version 0.5.1` publiée le **2023-09-30**, **18 596 téléchargements au
total et 483 sur 90 jours** — à comparer aux 5,9 M sur 90 jours d'`ort`.

Et même vivant il ne conviendrait pas : **82 opérateurs sur 170**, et les
absents comprennent **`Slice`, `Split`, `Where`, `ConvTranspose`, `Einsum`,
`InstanceNormalization`, `TopK`, `ArgMax`**. `Slice`, `Split` et `Where` à eux
seuls écartent tout transformeur de vision — donc Depth-Anything, MiDaS et
DINOv2. Les modèles que son README revendique comme éprouvés sont
**Squeezenet, MNIST et BERT**, et rien d'autre.

C'est la réponse au « via `wonnx` » du ticket, et elle est nette.

### 2.3 Ce que `ort` ajoute vraiment, mesuré des deux côtés

⚠️ **Le chiffre de 76 Mo qu'on lit sur la release ONNX Runtime est un piège, et
il se trompe d'un facteur 5.** J'ai téléchargé
`onnxruntime-win-x64-1.29.0.zip` (79 645 520 octets, md5
`2c8c116c147e1d7581bfec440bd87a1e`) et lu son catalogue :

| Fichier | Taille décompressée | Livré ? |
|---|---|---|
| `lib/onnxruntime.pdb` | **414 093 312 o (394,9 Mio)** | ⛔ symboles de débogage |
| **`lib/onnxruntime.dll`** | **16 149 344 o (15,40 Mio)** | ✅ **c'est ça, la charge réelle** |
| `lib/onnxruntime_providers_shared.dll` | 21 856 o | ✅ |
| en-têtes C/C++ | ~1 Mo | ⛔ compilation seulement |

**95 % de l'archive est du `.pdb`.** Annoncer « ONNX Runtime pèse 76 Mo » serait
faux ; la charge livrable est **15,4 Mio**.

*(Note de recoupement : une seconde mesure, prise indépendamment par lecture du
catalogue du ZIP à distance, avait donné 15,08 Mio pour cette DLL. L'écart est
tranché en faveur du chiffre ci-dessus — même archive vérifiée par taille **et**
md5, catalogue lu en local. Les deux mesures concordent en revanche exactement
sur `onnxruntime_providers_shared.dll` (21 856 o).)*

**Mais `ort` par défaut ne livre PAS cette DLL** : il lie ONNX Runtime
**statiquement**, depuis des binaires prébuild pyke. Exécutables réellement
construits :

| Configuration | Exécutable | DLL à côté | Démarre sans les DLL ? |
|---|---|---|---|
| témoin, zéro dépendance | 0,12 Mo | — | — |
| **`ort` par défaut** (ORT statique + DirectML) | **20,47 Mo** | `DirectML.dll` 17,67 Mo | ✅ **oui** (delay-load) |
| **`ort` feature `webgpu`** | **17,51 Mo** | `webgpu_dawn.dll` + `dxcompiler.dll` + `dxil.dll` = **22,67 Mo** | ⛔ **non** — `STATUS_DLL_NOT_FOUND` |

**Réponse à « faut-il livrer des DLL » : ça dépend du chemin, et l'écart est
tranché.** CPU/DirectML : rien d'obligatoire, l'exe démarre seul. WebGPU :
**trois DLL obligatoires, 22,67 Mo, en chargement immédiat**.

⚠️ **Nuance mesurée sur CETTE machine, et elle explique pourquoi le
redistribuable existe** : `C:\Windows\System32\DirectML.dll` **est bien
présente** sur ce Windows 10 Pro N 19045 — mais elle pèse **1 261 056 o
(1,2 Mo), datée de décembre 2023**, contre **17,67 Mo** pour celle que déposent
les binaires pyke. Ce ne sont pas les mêmes capacités : « DirectML est fourni
avec Windows » est vrai et ne dispense pas de redistribuer, si l'on veut les
opérateurs récents. **Je n'ai pas vérifié** quelle version de DirectML chacune
porte, ni laquelle suffirait à un transformeur de vision.

### 2.4 L'ordre de grandeur demandé par le ticket

Le ticket demande l'écart par rapport aux 6 crates actuelles. Mesuré par
`cargo tree` sur le vrai `Cargo.toml` du dépôt, **en distinguant ce qui est
réellement LIÉ de ce qui ne sert qu'au build** :

| Ajout | Crates liées | Δ **embarqué** |
|---|---|---|
| *(base du projet)* | 227 | — |
| **`ort` par défaut** | 234 | **+7** |
| `tract-onnx` | 289 | +62 |
| `wonnx` | 293 | +66 |
| `candle-onnx` | 302 | +75 |

⚠️ **Compter les crates ne mesure PAS le poids ici, et le classement s'inverse
selon l'unité.** `ort` est le plus **léger en crates** (+7) et le plus **lourd
en octets** (+20,3 Mo de C++ que `cargo tree` ne voit pas, parce que le poids
est dans une bibliothèque statique téléchargée, pas dans l'arbre Rust). Les 17
autres crates qu'`ort` tire (`ureq`, `native-tls`, `schannel`…) sont des
**build-dependencies** qui servent à télécharger l'archive et ne partent pas
dans le binaire. Juger sur `cargo tree` seul conclurait exactement à l'envers.

**Le cadrage honnête** : sur un exécutable de **9,1 Mo**, la voie `ort` par
défaut fait passer la part Rust/C++ à **~20-30 Mo**, avant le modèle.

### 2.5 Deux constats qui déplacent les options

- **`candle` n'a AUCUN backend WebGPU.** Vérifié dans `candle-core/Cargo.toml` :
  les features sont `cuda, cudnn, nccl, mkl, accelerate, metal, ug`. Ni WebGPU,
  ni Vulkan, ni DirectML. Sous Windows sans carte NVIDIA, c'est du CPU.
  Son exemple officiel `candle-examples/examples/depth_anything_v2/` **n'utilise
  pas ONNX** : il charge des safetensors dans un modèle **porté à la main en
  Rust** (`candle_transformers::models::depth_anything_v2`), entrée 518×518.
  C'est une voie réelle, mais c'est un portage, pas un chargement de modèle.
  `candle-onnx` exige par ailleurs **`protoc` installé sur la machine** au build.
- **`tract` est le seul pur Rust sans DLL avec une vraie couverture ONNX**
  (suite officielle ONNX, opsets 9 → 24 ; en production chez Sonos). Son prix
  est net : **aucun GPU sous Windows** — CPU seulement.

### 2.6 ONNX Runtime a un fournisseur d'exécution **WebGPU natif**

Relevé dans les notes de version (source : releases GitHub microsoft/onnxruntime) :

| Version | Date | Ce qui change |
|---|---|---|
| 1.20.0 | 2024-11-01 | premier EP WebGPU natif, Android/iOS, hors paquets |
| **1.22.0** | **2025-05-10** | « Enabled WebGPU when building from source for macOS, Linux, and **Windows** » |
| `plugin-ep-webgpu` v0.1.0 | **2026-05-29** | l'EP WebGPU devient un **plugin détachable**, versionné à part |
| `plugin-ep-webgpu` v0.2.1 | 2026-07-30 | **0 asset GitHub** (distribution NuGet/PyPI) — non mesuré |
| 1.29.0 | 2026-08-12 | « onnxruntime-web has announced the deprecation of WebGL and JSEP. **The native WebGPU EP is the recommended path going forward** » |

⚠️ **Ce WebGPU-là n'est PAS celui de la WebView2.** C'est Dawn compilé dans le
processus Rust, avec son propre adaptateur et son propre device — d'où les
22,67 Mo de DLL du §2.3. Il ne partage rien avec le `GPUDevice` de l'app. Voir §3.

⚠️ **Ce que je n'ai pas pu vérifier, et qui compte pour cette machine** : la doc
d'`ort` annonce pour Windows « Prebuilt binaries require a recent version of
Windows 11 », et un plancher CPU **x86-64-v3**. Cette machine est en
**Windows 10 Pro N 19045** ; le build a réussi et l'exécutable a démarré, mais
**aucune inférence réelle n'a été lancée, aucun EP enregistré, aucun modèle
chargé**. C'est le premier point à éprouver, pas un acquis.

## §3. La piste WebGPU : instruite, et elle se sépare en deux

Le ticket demande d'instruire sérieusement l'idée d'exécuter l'inférence dans le
`GPUDevice` que l'app tient déjà. **La réponse est « oui, mais pas du côté où on
la cherchait ».**

### 3.1 Le fait d'architecture qui tranche la moitié de la question

⚠️ **En Tauri v2, le Rust natif ne peut PAS voir le `GPUDevice` de la WebView2.**
Le `GPUDevice` de l'app vit dans le **processus GPU de Chromium** ; un runtime
Rust (wonnx, `ort` en mode WebGPU, `wgpu`) ouvre son propre `wgpu::Instance` et
son propre device D3D12/Vulkan dans le **processus Rust**. Ce sont deux
adaptateurs, deux devices, deux allocations de VRAM, sans ressource partagée.

**Toute voie Rust garantit donc le second contexte GPU que le ticket voulait
éviter** — ce n'est pas une limite d'implémentation à contourner, c'est la
frontière de processus. Corollaire direct : les 22,67 Mo de DLL du §2.3
(`webgpu_dawn.dll` + `dxcompiler.dll` + `dxil.dll`) paient un *second* Dawn, à
côté de celui que Chromium fait déjà tourner.

**« Dans le même device » n'est atteignable qu'en JavaScript, dans la WebView.**

### 3.2 Ce que le modèle contient RÉELLEMENT — mesuré, pas supposé

Le graphe ONNX de `onnx-community/depth-anything-v2-small` (`model.onnx`,
99 060 839 octets) a été **téléchargé et son protobuf parsé** : **823 nœuds,
25 types d'opérateurs**, `opset 14`, producteur `pytorch`, entrée
`pixel_values ['batch_size', 3, 'height', 'width']` (**formes dynamiques**).

```
150 Add · 90 Mul · 73 Gather · 72 MatMul · 50 ReduceMean · 42 Concat
42 Transpose · 41 Unsqueeze · 39 Div · 31 Conv · 30 Reshape · 26 Shape
25 Sub · 25 Pow · 25 Sqrt · 17 Relu · 12 Softmax · 12 Erf · 9 Slice
6 Resize · 2 ConvTranspose · 1 Equal · 1 Where · 1 Expand · 1 Squeeze
```

⚠️ **Ceci corrige une prémisse que j'avais moi-même posée en lançant la
recherche.** J'attendais `LayerNormalization`, `Gelu` et `Einsum` : **aucun des
trois n'est présent.** En opset 14 (antérieur à `LayerNormalization`, opset 17),
PyTorch **décompose** la normalisation en primitives — d'où les 50 `ReduceMean`
et les 25 `Pow`/`Sqrt` — et le GELU passe par `Erf`. Un ViT exporté n'a pas la
tête d'un ViT dans le graphe. **Raisonner sur l'architecture au lieu de lire le
graphe aurait donné la mauvaise liste d'opérateurs**, donc le mauvais verdict.

### 3.3 `wonnx` : le blocage est précis et chiffré

Croisement de la table du README de wonnx (170 opérateurs, 82 implémentés) avec
le graphe réel ci-dessus :

| Opérateur manquant | Occurrences dans le modèle |
|---|---|
| **`Slice`** | **9** |
| `ConvTranspose` | 2 |
| `Where` | 1 |
| `Expand` | 1 |
| `Erf` | 12 — présent **uniquement dans `master`** (PR #199, 2024-05-18), **absent de la 0.5.1 publiée** |

Vérifié dans `wonnx/src/compiler.rs` : `Slice`, `Where`, `ConvTranspose`,
`Einsum` → **zéro occurrence**. S'y ajoutent des contraintes rédhibitoires du
README : **formes statiques obligatoires** (le modèle est dynamique), entiers
64 bits non supportés, dimensions de `MatMul` divisibles par 2.

Et le partage de device est **impossible par construction** : tous les
constructeurs convergent vers `Session::from_model_with_config`, qui appelle
`resource::request_device_queue()` → laquelle crée son propre `wgpu::Instance`
puis `adapter.request_device(&DeviceDescriptor::default(), None)`. **Aucun
paramètre de device, module `gpu` privé.** Son API WASM ne rend que des tableaux
de nombres : **aucune interop `GPUBuffer`, tout transite par le CPU**.

### 3.4 ONNX Runtime Web : praticable, et le device SE PARTAGE vraiment

`onnxruntime-web`, dernière version **1.27.0 publiée le 2026-06-19**, MIT.

⚠️ **Le champ que la documentation suggère est un leurre.** `env.webgpu.device`
est décrit dans le JSDoc comme utilisable avant la première session ; c'est
**faux**, et l'équipe ORT l'écrit dans son propre document de migration
(`docs/design/onnxruntime_web_jsep_to_webgpu_ep_migration.md`, commit du
**2026-08-06**) :

> `env.webgpu.device` is output-only — both paths write it after init and neither reads it. Custom devices go through the per-session option instead

Vérifié sur le **code livré** (tarball npm 1.27.0, pas la branche `main`) :
`ort.webgpu.mjs:3284` fait `webgpuInit((device) => { env3.webgpu.device = device; })`
— le device est **écrit**, jamais lu.

**La voie qui marche** est l'option par session, présente dans le code distribué
(`ort.webgpu.mjs:1986-2019`) et typée dans `onnxruntime-common@1.27.0` :

```js
const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: [{ name: 'webgpu', device: monGPUDevice }]
});
```

Elle valide `device instanceof GPUDevice` puis enregistre le device auprès du
runtime. **Introduite en 1.22.0** (bissection sur les tarballs npm : absente en
1.21.0, présente en 1.22.0, publiée **2025-05-09**) — et **non documentée** sur
la page officielle du tutoriel WebGPU, qui ne montre que
`executionProviders: ['webgpu']`.

⚠️ **Le piège le plus coûteux : le bundle par défaut ignore l'option EN
SILENCE.** Dans `ort.all.mjs` — ce qu'on obtient en important `onnxruntime-web`
tout court, chemin JSEP — le bloc qui lit `device` est sous **`if (false)`**,
donc du code mort. Aucune erreur, aucun avertissement : ORT crée un second device
et tout repasse par le CPU. **Il faut importer
`onnxruntime-web/webgpu`.** (Le chemin JSEP est par ailleurs annoncé en
dépréciation par la version 1.29.0 du 2026-08-12.)

**Interop de tenseur GPU : réelle.** `Tensor.fromGpuBuffer(buffer, {dataType,
dims})` et `preferredOutputLocation` permettent d'entrer et de sortir en
`GPUBuffer` sans aller-retour CPU — **mais uniquement si le device est
partagé**, un `GPUBuffer` d'un device étant inutilisable par un autre. C'est
précisément l'intérêt que le ticket pressentait, et il tient.

**Couverture** : les 25 types d'opérateurs du modèle sont tous enregistrés dans
le WebGPU EP, `Where` et `Expand` compris.

**Poids à embarquer** (tarball 1.27.0 mesuré) : `ort-wasm-simd-threaded.jsep.wasm`
= **26 827 543 o (~25,6 Mio)**, plus ~113 Ko de glue JS. Fonctionnement hors
ligne assuré par `env.wasm.wasmPaths` (chemin local) ou `env.wasm.wasmBinary`.

`transformers.js` (`@huggingface/transformers` **4.2.0, 2026-04-22**, Apache-2.0)
sait faire `depth-estimation` et `device: 'webgpu'` depuis sa v3.0.0
(2024-10-22), et laisse passer un device personnalisé parce que son
`session_options.executionProviders ??= …` **ne surcharge pas** ce qu'on lui
fournit. ⚠️ Deux réglages obligatoires en WebView : `allowLocalModels` vaut
**`false` par défaut en navigateur** et `allowRemoteModels` **`true`** — il faut
inverser les deux, sans quoi l'app irait chercher les poids sur
`huggingface.co` au runtime, ce que le PRD interdit.

### 3.5 ⚠️ La conséquence directe sur `gpuContext.ts`, à ne pas manquer

ORT **lit les limites du device fourni et s'y adapte** (il sait segmenter un
buffer de 200 Mo en 128 + 72 Mo si `maxStorageBufferBindingSize` est bas) : un
device modeste **dégrade**, il ne bloque pas.

**Mais `requiredFeatures` est exact, et il se fige à la création.** Les limites
et les features d'un `GPUDevice` **ne peuvent PAS être élargies après coup** —
la spec W3C les place dans `GPUDeviceDescriptor`, donc au seul appel
`requestDevice()`.

Or `src/render/gpuContext.ts:123-126` `[code]` crée le device ainsi :

```
requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
requiredFeatures: featuresOptionnelles,   // ["timestamp-query"] ou []
```

**Une seule limite relevée, et aucune feature de calcul.** Conséquence concrète :
**un device créé sans `shader-f16` ne pourra JAMAIS exécuter le modèle en
fp16** — c'est-à-dire 47,3 Mo de poids au lieu de 94,5, et la variante que la
démo de référence choisit quand la feature est disponible. Partager le device
imposerait donc de **le recréer** avec les limites et features de l'inférence,
donc de coupler la création du contexte de rendu à un besoin d'inférence.

Rappel des défauts de la spec (W3C, lus le 2026-08-18) :
`maxStorageBufferBindingSize` **128 Mio**, `maxBufferSize` **256 Mio**,
`maxComputeWorkgroupStorageSize` **16 Kio**, `maxComputeInvocationsPerWorkgroup`
**256**. ⚠️ **Je n'ai pas mesuré** ce que l'adaptateur de cette machine expose
réellement, ni si `shader-f16` y est disponible — c'est une sonde CDP de
quelques lignes, et elle décide fp16 contre fp32 `[incertitude nommée]`.

Second effet, moins visible : `gpuContext.ts:127-135` `[code]` note que l'app
**n'a aujourd'hui aucun gestionnaire de perte de device**, et que des vidages
mémoire réels (2026-07-14/15) montrent **trois abandons OOM du rendu** pendant la
peinture de masque sur une grande photo. Faire allouer des centaines de Mo de
tenseurs par une inférence **dans ce même device** touche exactement ce point.

### 3.6 Qui le fait en production ? Personne de vérifiable

Le ticket demande explicitement la question. La réponse honnête :

- **Démos : en masse.** Le cas exact existe — `Xenova/webgpu-realtime-depth-estimation`
  charge `onnx-community/depth-anything-v2-small` avec `device: "webgpu"` et
  `dtype: fp16` si la feature est là (extrait verbatim de son bundle).
- **Produit distribué faisant de l'inférence vision en WebGPU : aucun cas
  trouvé.** Figma fait du WebGPU en production depuis le 2025-09-18, mais **pour
  le rendu** — zéro mention d'inférence ; leur article documente en revanche un
  repli WebGPU → WebGL sur perte de device. MediaPipe Web est en **WebGL2, pas
  WebGPU** (0 occurrence de « webgpu » dans `vision_bundle.mjs` de
  `@mediapipe/tasks-vision@1.0.1`, 2026-07-31 ; des liaisons WebGPU Emscripten
  existent dans le glue mais restent **dormantes**).

**« Des démos, pas de produit » est le résultat, et c'est un résultat.**

⚠️ **WebGPU dans WebView2 n'est documenté nulle part par Microsoft** : zéro
occurrence de « webgpu » dans les notes de version du runtime 112→120, dans
`browser-features.md`, et aucun drapeau WebGPU dans `webview-features-flags.md`.
Ça marche — cette app en est la preuve, sur le runtime **151.0.4129.86** installé
ici — mais **ce n'est pas contractuel**.

## §4. Résolution d'évaluation et coût sur les contours

### 4.1 À quelle résolution ces modèles tournent réellement — lu dans leur prétraitement

Ces valeurs viennent des `preprocessor_config.json` officiels, pas d'un article :

| Modèle | `size` | `ensure_multiple_of` | `keep_aspect_ratio` | `resample` |
|---|---|---|---|---|
| **Depth-Anything V2** (`-Small-hf`) | **518 × 518** | **14** | **true** | 3 (bicubique) |
| Intel `dpt-large` | 384 | 1 | false | 2 (bilinéaire) |
| Intel `dpt-hybrid-midas` | 384 × 384 | 1 | false | 2 (bilinéaire) |

Le `ensure_multiple_of: 14` de Depth-Anything n'est pas décoratif : le dorsal est
un ViT à **patchs de 14 px**, et 518 = 14 × 37. Toute taille d'entrée est
arrondie à un multiple de 14.

⚠️ **Je n'ai PAS pu établir la résolution d'entrée de Depth Anything V3** : le
dépôt ONNX n'a pas de `preprocessor_config.json` (« Entry not found ») et son
`config.json` ne porte que `{"model_type": "depth_anything",
"transformers.js_config": {"dtype": "fp32", "use_external_data_format": true}}`.
Le README GitHub de DA3 ne mentionne ni résolution, ni taille d'entrée
(recherche de `resolution|input_size|518|1024|patch` : zéro occurrence)
`[incertitude nommée]`. *(Ce même `config.json` confirme en revanche le
`use_external_data_format: true` du §1.4 — deux fichiers à livrer.)*

### 4.2 Ce que ça fait sur une photo de 26 Mpx — l'arithmétique

⚠️ **Ce paragraphe a d'abord porté des chiffres FAUX (× 143 en surface, × 12 en
linéaire), et la correction mérite d'être lue avant le résultat.** J'avais déduit
de `keep_aspect_ratio: true` que le **côté long** était ramené à 518. C'est
l'inverse. Le code de `DPTImageProcessor.get_resize_output_image_size`
(transformers, lu en brut) commente son test « **scale as little as possible** »
et retient le facteur d'échelle le plus proche de 1 — donc il ajuste le **côté
court** à 518 et laisse le côté long DÉPASSER. Sur une photo 3:2, l'entrée
effective n'est pas 518 × 350 mais **784 × 518**, soit **2,2 fois plus de
pixels** que ce que j'avais écrit. *Lire la doc a donné la mauvaise réponse ;
exécuter l'algorithme a donné la bonne.*

Sur 6 240 × 4 160 = **25 958 400 px**, en faisant tourner l'algorithme réel :

| Grandeur | Depth-Anything V2 (518) | MiDaS / DPT (384) |
|---|---|---|
| Entrée effective | **784 × 518 = 406 112 px** | 384 × 384 = 147 456 px |
| `keep_aspect_ratio` | **true** — cadrage conservé | **false** — image écrasée en carré |
| Facteur de ré-échantillonnage **linéaire** | **× 8,0** | × 16,2 |
| Facteur en **surface** | **× 64** | × 176 |
| Un pixel inféré couvre | **64 pixels photo** | 176 pixels photo |
| Une erreur de **1 px** sur le bord inféré vaut | **8 px sur la photo** | 16 px |

**C'est le chiffre qui répond à la question du ticket.** L'inférence voit **1,6 %**
des pixels de la photo, et le masque qui en sort doit être étiré **64 fois en
surface**. Une frontière juste à un pixel près dans le modèle arrive sur la photo
avec **huit pixels d'incertitude** — sur une image où le dépôt refuse toute
distinction prévisualisation/export et rend en résolution native.

⚠️ **Et la différence entre les deux colonnes n'est pas qu'une question de
finesse** : DPT/MiDaS a `keep_aspect_ratio: false`, donc il **déforme** la photo
en carré avant de l'analyser, puis on ré-étire le résultat. Depth-Anything
conserve le cadrage. Ce n'est pas le même geste.

*(Ces valeurs ont été obtenues deux fois indépendamment — en exécutant
`get_resize_output_image_size` de transformers, et en exécutant le `get_size()`
du dépôt officiel Depth-Anything V2. Les deux donnent 784 × 518.)*

### 4.3 ⚠️ Le coût sur les contours a une borne PUBLIÉE, et elle est basse

C'est le chiffre le plus important de cette section, et il ne vient pas d'une
estimation. **Depth Pro** (arXiv 2410.02073v2, annexe B.1, table 7) fait
exactement l'expérience que pose le ticket : prendre la **vérité terrain**, la
sous-échantillonner à une résolution R, la ré-agrandir, et mesurer. **Aucune
erreur de modèle n'entre là-dedans — c'est le coût du ré-échantillonnage seul.**

| Résolution de sortie | Correspond à | **F1 de frontière ↑** |
|---|---|---|
| 1536 × 1536 | Depth Pro | **0,311** |
| 768 × 768 | Marigold | 0,131 |
| **518 × 518** | **Depth-Anything V2** | **0,065** |
| 384 × 384 | DPT / MiDaS | 0,044 |

Verbatim : « *doubling the resolution may improve boundary accuracy by a factor
of 3* », et « *these results represent an upper bound* ».

**Ce que ça dit pour ce dépôt** : le facteur d'agrandissement de leur banc
(4K → 518) est ~7,4×, presque exactement le nôtre (8,0×). **Même avec une carte
de profondeur PARFAITE à 518, le F1 de frontière plafonne à 0,065.** C'est le
plafond de toute solution à 518, quel que soit le modèle — un meilleur modèle ne
le franchit pas, seule une résolution plus haute le déplace.

Et sur données réelles (Depth Pro, table 2, précision de frontière zéro-shot) :

| Méthode | Sintel F1 | iBims F1 | **DIS-5K rappel** |
|---|---|---|---|
| DPT (2021) | 0,181 | 0,113 | 0,018 |
| Depth-Anything v1 | 0,261 | 0,127 | 0,023 |
| **Depth-Anything v2** | 0,228 | 0,111 | 0,056 |
| **Depth Pro** | **0,409** | **0,176** | **0,077** |

⚠️ **À lire avec la bonne échelle.** DIS-5K est un jeu de silhouettes découpées —
le cas le plus proche d'un masque de retouche. **Le meilleur rappel toutes
méthodes confondues y est 0,077**, soit moins de 8 % des contours de silhouette
attrapés. L'avance « d'un facteur 2 » de Depth Pro se joue entre des valeurs
toutes très basses. ⚠️ Et elle n'est **pas universelle** : sur l'erreur de
complétude des bords d'iBims-1 (`ε^comp_DBE`, plus bas = mieux),
**Depth-Anything v2 (8,350) bat Depth Pro (10,138)**.

⚠️ **Les rappels de frontière ne se comparent JAMAIS d'un papier à l'autre** :
PatchFusion vaut 0,206 dans une table et 0,068 dans une autre, protocoles
différents.

### 4.4 ⚠️ Un défaut d'aliasing dans le prétraitement officiel, mesuré

Trouvaille non anticipée, et actionnable en une ligne. **MiDaS, Depth-Anything V1
et V2 réduisent tous l'image avec `cv2.INTER_CUBIC`** (`dpt.py:205`,
`run.py:47`, `model_loader.py:221`) — alors que leur propre classe `Resize` a
`cv2.INTER_AREA` en défaut (`transform.py:17`), surchargé à l'appel.

`cv2.INTER_CUBIC` échantillonne un voisinage **4 × 4 fixe** quel que soit le
facteur : à 8× de réduction, il **saute 60 pixels sur 64**. Mesuré sur une mire
de bruit blanc 1560 × 1040 réduite × 8, référence = moyenne de bloc exacte :

| Méthode | Écart-type | RMSE vs référence |
|---|---|---|
| référence (moyenne de bloc idéale) | 9,22 | 0 |
| **`cv2.INTER_CUBIC`** — ce que font MiDaS / DA V1 / DA V2 | **52,77** | **51,94** |
| `cv2.INTER_AREA` — leur propre défaut de classe | 9,22 | **0,29** |
| `PIL BICUBIC` — le chemin Hugging Face | 7,51 | 4,63 |

**La variance sort à 5,7 fois la valeur correcte.** Toute texture fine —
feuillage, tissu, cheveux, grain — arrive au réseau en **moiré**, avant qu'il
calcule quoi que ce soit. Ce dépôt a déjà tout ce qu'il faut pour l'éviter : la
chaîne de mipmaps de `src/render/mipmapGenerator.ts` `[code]` fait exactement le
filtrage d'aire qui manque. *(Le chemin Hugging Face / `DPTImageProcessor`
n'a pas ce défaut : Pillow adapte le support du filtre au facteur.)*

### 4.5 Ce qu'on peut faire contre : le filtrage guidé

Références primaires vérifiées (DOI Crossref) :

| Méthode | Référence | Coût | Rayon |
|---|---|---|---|
| **Joint bilateral upsampling** | Kopf & al., *ACM TOG* 26(3) art. 96, 2007 — `10.1145/1276377.1276497` | O(N r²) | dépendant |
| **Guided image filter** | He, Sun, Tang — ECCV 2010 `10.1007/978-3-642-15549-9_1` ; TPAMI 35(6):1397, 2013 | **O(N)** exact | **indépendant** |
| **Fast guided filter** | He & Sun — arXiv:1505.00996, 2015 | **O(N/s²)** + O(N) final | indépendant |
| **Fast bilateral solver** | Barron & Poole — ECCV 2016 `10.1007/978-3-319-46487-9_38` | 15-25 itérations PCG | — |

Qualité publiée sur un banc de **super-résolution de profondeur** (Fast Bilateral
Solver, table 3 ; Err plus bas = mieux) : Bicubic 5,91 · GuidedFilter 3,47 ·
FastGuidedFilter 3,41 · **JBU 3,14** · **Solveur bilatéral 2,70**.

**La forme qui correspond à ce dépôt est le `fast guided filter`**, pour une
raison structurelle : ses coefficients `a` et `b` se calculent **à la résolution
de la carte de profondeur** (0,41 Mpx), ne sont ré-agrandis que bilinéairement,
et **la seule opération à 26 Mpx est un `a·I + b` par pixel** — soit **deux
`textureSample` et un MAD, en une passe**. Le filtre guidé complet demanderait
~12 passes box séparables à 26 Mpx.

⚠️ **Trois contraintes WGSL vérifiées en spec, qui décident de la faisabilité :**
- **Aucune atomique flottante en WGSL** (spec W3C : `T must be either u32 or
  i32`). Toute grille bilatérale (splat = dispersion accumulée) est donc un
  chantier. **Ni le guided filter ni JBU ne sont concernés** — aucune dispersion.
- **Image intégrale en `f32` impossible à 26 Mpx** : 2²⁴ = 16 777 216 <
  25 958 400, la mantisse ne représente plus les incréments unitaires en fin de
  balayage. D'où les passes box séparables, ou le box sur grille
  sous-échantillonnée du fast guided filter.
- **Aucune implémentation WGSL/WebGPU publique** d'aucune de ces méthodes n'a été
  trouvée. Le seul code d'auteur portable est un shader GLSL (`google/bgu`,
  Apache-2.0).

### 4.6 Temps d'inférence — et le trou dans les sources

⚠️ **Il n'existe AUCUN chiffre publié et fiable pour du matériel grand public
sous Windows**, ni pour Depth-Anything ni pour MiDaS. Recherché explicitement
(RTX 3060/4060/4070, Intel Arc, iGPU, DirectML). Tout le corpus utilisable est
Linux, WSL ou macOS. **Aucun temps A100 n'a été extrapolé vers une RTX ici.**
Les benchmarks officiels OpenVINO ne portent ni `midas`, ni `dpt`, ni `dinov2`
(comptage : zéro occurrence).

Le seul tableau **homogène** (Depth Pro, table 5, toutes méthodes reproduites sur
**V100-32G**), en ms, pour une entrée VGA / HD / 4K :

| Méthode | Résolution native | t_VGA | t_HD | **t_4K** |
|---|---|---|---|---|
| DPT | 0,15 Mpx | 33,2 | 30,6 | 27,8 |
| **Depth-Anything v2 (ViT-L)** | **0,27 Mpx** | **90,9** | **91,1** | **91,2** |
| Depth Pro | 2,36 Mpx | 341,3 | 341,3 | 341,3 |
| PatchFusion | native (tuilé) | 84 012 | 84 030 | 84 454 |

Quelques points grand public, avec leur réserve :

| Matériel | Modèle | Précision | Runtime | Temps |
|---|---|---|---|---|
| RTX 4090 | DA V1 S/B/L | FP16 | TensorRT 10 | 3 / 6 / 12 ms ⚠️ meilleur cas après 10 frames, **contesté à 13 ms** |
| RTX 4080 Laptop | DA V2 S/B/L | non déclarée | ORT-GPU CUDA, WSL | 13,3 / 29,3 / 83,2 ms ⚠️ **contesté à ~98 ms** |
| MacBook M3 Max | DA V2 Small | Float16 | CoreML, Neural Engine | **24,58 ms** ✅ source la mieux spécifiée |
| Core i7-1185G7, **Windows 10** | `midas_v21_small_256` | — | OpenVINO | **22 FPS** ✅ seule mesure Windows, sur le plus faible du registre |

⚠️ **Le README de Depth-Anything V1 annonce 13 ms pour le Large sur A100 ; deux
articles relus donnent 60 ms et 83 ms sur le même matériel — facteur 6,4.** Le
chiffre du README est le seul sans précision, sans résolution et sans protocole.
Ne pas s'en servir comme budget. ⚠️ Et **le README de V2 ne porte aucun tableau
de temps** — celui qu'on cite souvent est celui de V1.

**Signal indirect pour Windows**, sur un modèle analogue (encodeur ViT de Segment
Anything, matériel identique des deux côtés) : Linux + CUDA ~370 ms, **Windows +
DirectML ~780 ms**, Windows + PyTorch/CUDA ~500 ms. Ce n'est pas Depth-Anything,
mais ça suggère que **sur Windows l'écart entre runtimes peut dépasser l'écart
entre deux tailles de modèle**.

### 4.7 ⚠️ Le point qui renverse l'intuition : 26 Mpx ne coûte PAS plus cher

Vérifié dans le code, pas déduit : le prétraitement ramène le **côté court** à
518 quelle que soit la photo. Une photo de 24, 26 ou 45 Mpx donne toujours
**2 072 tokens**. **Toutes les latences ci-dessus, mesurées à 518², s'appliquent
telles quelles à 26 Mpx** — le surcoût est un ré-échantillonnage et un tampon.

C'est ce qui désamorce la crainte du ticket sur l'absence de mode dégradé : une
inférence de profondeur **ne devient pas plus lente parce que la photo est
grande**. En revanche, monter `input_size` pour gagner du bord coûte cher — le
coût d'attention est quadratique en tokens :

| `input_size` | Entrée réelle | Coût attention | 1 texel = |
|---|---|---|---|
| **518** (défaut) | 784 × 518 | ×1,0 | **8,0 px photo** |
| 1036 | 1554 × 1036 | **×15,7** | 4,0 px |
| 1918 | 2884 × 1918 | ×185,5 | 2,2 px |

*(Coûts dérivés du nombre de tokens, pas mesurés. Seule courbe mesurée trouvée
pour la famille : DA3-SMALL en ONNX Runtime **CPU** sur M4 — 224² : 92,4 ms →
840² : 2 207 ms.)*

**Le mur n'est donc pas la latence, c'est le détail** — et l'acheter coûte un
facteur quadratique.

⚠️ **Et la contrainte « pas de mode dégradé » du ticket coupe dans les deux
sens** : elle interdit de cacher une inférence lente derrière un aperçu, mais
elle n'oblige pas le masque à être calculé à 26 Mpx — un masque *dose* un effet,
il n'est pas l'image. Ce que l'arithmétique ci-dessus établit, c'est le coût en
**netteté de bord**, pas un coût en temps.

## §5. Segmentation : même runtime, autres poids, et un paysage de licences pire

Le ticket 08 supposait « même famille, même nature de dépendance » sans le
vérifier. **La supposition est à moitié juste, et la moitié fausse est celle qui
coûte.**

### 5.1 Même runtime : OUI, et c'est vérifié

L'écosystème `onnx-community` publie les deux tâches dans le même format ONNX,
consommables par le même moteur. Relevé le 2026-08-18 sur
`…/api/models?author=onnx-community&pipeline_tag=image-segmentation` :
`ormbg-ONNX`, `BiRefNet_lite-ONNX`, `BEN2-ONNX`,
`mediapipe_selfie_segmentation`, `ISNet-ONNX`, `maskformer-swin-large-ade`,
`modnet-webnn`, `MVANet-ONNX`, `segformer-b3-finetuned-ade-512-512-ONNX`…

**Un seul runtime d'inférence sert les deux capacités.** Le coût du §2 (moteur,
DLL, binaire) se paie **une fois**, pas deux.

### 5.2 Mêmes poids : NON — trois familles distinctes, à ne pas confondre

C'est là que le ticket 08 se trompe. « Segmentation » recouvre trois choses qui
ne rendent pas le même objet :

| Famille | Ce qu'elle rend | Répond à « sujet / ciel / arrière-plan » ? |
|---|---|---|
| **Sémantique** (ADE20K, Cityscapes) | une CLASSE par pixel parmi N | **Oui** — c'est la seule qui nomme |
| **Promptable** (SAM, SAM2, SAM3) | un masque pour *ce qu'on désigne* | Non — elle **ne nomme rien** |
| **Objet saillant / détourage** (BiRefNet, RMBG, BEN2, ISNet) | sujet contre fond, binaire | Partiellement — sujet/fond, **jamais le ciel** |

Vérifié que le vocabulaire demandé existe bien côté sémantique : la config de
`facebook/maskformer-swin-large-ade` porte **150 classes**, dont `id 2 → sky`,
`id 1 → building`, `id 4 → tree`, `id 12 → person`. **« sujet / ciel /
arrière-plan » est exactement une lecture d'ADE20K.**

⚠️ **SAM ne répond PAS à la demande du PRD**, malgré sa réputation : il segmente
ce qu'on lui **désigne**, il n'attribue aucune étiquette. Le confondre avec de la
sémantique ferait construire une sélection interactive là où le PRD demande une
carte « ciel ».

### 5.3 Le paysage de licences de la segmentation est PLUS mauvais que celui de la profondeur

| Modèle | Taille poids | Licence | Verdict distribution |
|---|---|---|---|
| `nvidia/segformer-b0…b5-finetuned-ade` | 28,7 → 244,9 Mo | `other` → **NVIDIA Source Code License** | ⛔ **recherche seulement** |
| `briaai/RMBG-1.4` | 799,6 Mo | `bria-rmbg-1.4` | ⛔ non commercial |
| `briaai/RMBG-2.0` | 5 114,3 Mo | lien → **CC BY-NC 4.0** | ⛔ non commercial |
| `facebook/mask2former-*-ade-semantic` | 181,4 Mo (tiny) | `other`, **sans lien** | ⚠️ **ambigu** |
| `facebook/maskformer-swin-large-ade` | 811,2 Mo | `other`, sans lien | ⚠️ ambigu |
| `shi-labs/oneformer_ade20k_swin_tiny` | 454,9 Mo | **mit** | ✅ |
| `shi-labs/oneformer_ade20k_swin_large` | 838,8 Mo | **mit** | ✅ |
| `openmmlab/upernet-convnext-tiny` | 459,8 Mo | **mit** | ✅ |
| `ZhengPeng7/BiRefNet` | 423,9 Mo | **mit** | ✅ (détourage, pas sémantique) |
| `onnx-community/BiRefNet-ONNX` | 927,6 fp32 / **467,0 fp16** | mit | ✅ |
| `PramaLLC/BEN2` | — | **mit** | ✅ (détourage) |
| `facebook/sam-vit-base` / `-huge` | 715,3 / 4 891,4 Mo | **apache-2.0** | ✅ (promptable) |
| `facebook/sam2.1-hiera-small` | 351,6 Mo | **apache-2.0** | ✅ (promptable) |
| `facebook/sam3` | 6 570,8 Mo | **« SAM License »** (19 nov. 2025) | ⚠️ voir ci-dessous |
| `onnx-community/mediapipe_selfie_segmentation` | **0,21 → 0,44 Mo** | **apache-2.0** | ✅ (personnes seulement) |

**Le constat qui compte : la famille la plus utilisée de la segmentation
sémantique est interdite.** Le fichier `LICENSE` de `NVlabs/SegFormer`, lignes
38-39, dit mot pour mot :

> `non-commercially. Notwithstanding the foregoing, NVIDIA and its affiliates may use the Work and any derivative works commercially. As used herein, "non-commercially" means for research or evaluation purposes only.`

Or SegFormer occupe **cinq des vingt-huit** premières places du classement HF par
téléchargements en `image-segmentation` (b0 à b5). Le modèle sémantique le plus
naturel à prendre est celui qu'on ne peut pas livrer — et le ré-upload
`onnx-community/segformer-b3-…-ONNX` hérite honnêtement du `other`.

**Précisions à ne pas approximer :**

- **SAM 1 et SAM 2 : les POIDS sont explicitement Apache-2.0**, pas seulement le
  code. SAM 1 README : « The model is licensed under the Apache 2.0 license ».
  SAM 2 README : « The SAM 2 **model checkpoints**, SAM 2 demo code […] and SAM 2
  training code are licensed under Apache 2.0 ». C'est rare et c'est écrit.
- **SAM 3 change de régime** : licence maison « SAM License », datée du
  19 novembre 2025. Elle **n'interdit PAS le commercial** — elle accorde un droit
  « non-exclusive, worldwide, non-transferable and royalty-free » d'utiliser,
  reproduire, distribuer et dériver. Ses contraintes réelles : propager
  l'accord à tout tiers, créditer en publication, respecter les contrôles à
  l'export, et **« not involve or encourage others to reverse engineer, decompile
  or discover the underlying components »** — une clause qu'aucune licence OSI ne
  porte. Utilisable, sous accord maison qui se propage.
- `onnx-community/maskformer-swin-large-ade` (2 589,2 Mo) n'a **aucune licence
  déclarée**. Un ré-upload sans licence n'est pas une licence permissive.
- **Je n'ai pas vérifié** si les termes du *jeu de données* ADE20K se propagent
  aux poids entraînés dessus. Les licences ci-dessus couvrent le modèle publié ;
  la question amont reste ouverte `[incertitude nommée]`.

⚠️ **Et il y a un trou entre « permissif » et « prêt à embarquer », que je
signale sans le combler.** Les deux options sémantiques MIT (`oneformer_ade20k_*`,
`upernet-*`) n'ont **pas d'export ONNX que j'aie su trouver**. Le seul export
ONNX d'un sémantique ADE20K dans `onnx-community` est
`segformer-b3-finetuned-ade-512-512-ONNX` — qui hérite du `other` non commercial
de NVIDIA — plus `maskformer-swin-large-ade`, **sans licence déclarée**. La voie
permissive supposerait donc d'**exporter soi-même** le modèle en ONNX (via
Optimum), travail supplémentaire dont je n'ai vérifié ni la faisabilité ni le
résultat. ⚠️ **Je n'affirme pas qu'aucun export n'existe** : le filtre
`library=onnx` de l'API HF a rendu des dépôts PyTorch, donc il ne filtre pas ce
que son nom annonce, et mon absence de résultat n'est pas une preuve d'absence
`[incertitude nommée]`.

### 5.4 Le seul endroit où les deux capacités convergent réellement

**`DA3MONO-LARGE` rend la profondeur ET la segmentation du ciel dans un seul
modèle Apache-2.0** (§1.5) — un seul fichier de 1,27 Go, une seule inférence,
deux sorties. C'est le seul cas mesuré où « juger les deux capacités ensemble »
correspond à quelque chose de concret plutôt qu'à une supposition.

Mais il ne rend **que** le ciel : « sujet » et « arrière-plan » n'en sortent pas,
et il faudrait soit les dériver de la profondeur, soit ajouter un second modèle.
**Je n'ai pas pu vérifier la forme exacte de cette sortie ciel** (tenseur, canal,
seuil) : la recherche de code sur l'API GitHub a été bloquée par le rate limit,
et le README ne documente la capacité que par une colonne de table
`[incertitude nommée]`.

**Réponse à la question 5 du ticket** : **même runtime, poids distincts, et deux
paysages de licences différents — celui de la segmentation étant le plus
contraint.** Les deux capacités se jugent donc **ensemble sur le coût
d'intégration** (§2, payé une fois) et **séparément sur les poids et les
licences**.

---

## §6. Ce que le contrat de source de masque de ce dépôt implique

Le ticket demande de dire ce que ça implique, sans le concevoir. Lu dans le code
le 2026-08-18 :

**L'union `MaskSourceModule` que le ticket cite n'est pas la seule frontière, et
ce n'est pas celle qui bloquerait.** `src/mask/sources/types.ts` `[code]` ferme
bien `id` à `"gradient" | "luminosity" | "colorRange"`, avec un `wgsl` de
signature `fn fs_generate(uv, colorLinear, params: array<f32, 8>) -> f32` — aucun
binding de texture, donc **une source calculée hors shader n'entre effectivement
pas dans CE contrat**.

Mais `src/mask/types.ts` `[code]` montre que le modèle porte **déjà** un
transport de raster, sur une autre branche de l'union :

```
export type MaskSource = BrushMaskSource | ParametricMaskSource;
```

où `BrushMaskSource` porte `raster: Uint8Array` et `params: null`, et
`ParametricMaskSource` l'inverse. `MaskSourceModule` ne décrit que la branche
**paramétrique**.

**Conséquence factuelle** : une carte de profondeur est, structurellement, un
`Uint8Array` à la taille de la photo — c'est-à-dire **la forme exacte d'un
`BrushMaskSource`**, pas d'un `ParametricMaskSource`. Et l'invariant anti-OOM est
déjà générique : `src/layers/displayProjection.ts` `[code]` documente que
« **CHAQUE `raster` de CHAQUE source** doit être vidé, pas seulement un champ
unique », et `stripRasters` teste `s.raster !== null && s.raster.length > 0` sans
regarder le `type`. Un raster produit par un modèle emprunterait donc la
machinerie anti-OOM existante sans la modifier.

⚠️ **Ce n'est pas une conception, c'est un constat de forme**, et il coupe dans
les deux sens : le transport existe, mais `MaskSourceType` est une union fermée
de quatre chaînes dont `"brush"` est aujourd'hui le seul porteur de raster —
ajouter un porteur touche le modèle, pas seulement le registre. Ordre de
grandeur du raster : **26 Mo pour 26 Mpx** à un octet par pixel (le commentaire
de `maskPainter.ts:71` `[code]` dit « sur une photo 24MP c'est 24 Mo »).

---

## §7. Table de synthèse chiffrée

Tout ce qui suit porte sa date dans le corps du document. « ⛔ » = disqualifiant
pour une app **distribuée**, ce qui est le cas de shaderlab.

### 7.1 Les poids, si l'on ne garde que ce qui est livrable

| Capacité | Meilleur candidat permissif | Poids ONNX fp16 | Licence | Ce qu'on perd |
|---|---|---|---|---|
| **Profondeur** | Depth-Anything **V2-Small** | **47,3 Mo** | apache-2.0 | Base/Large sont ⛔ CC-BY-NC |
| Profondeur (plus grand, permissif) | Depth-Anything **V1-Large** | ~640 Mo (est. fp16) | apache-2.0 | modèle de janvier 2024 |
| Profondeur + **ciel** | **DA3MONO-LARGE** | 1,27 Go (fp32) | apache-2.0 | pas de variante Small |
| Profondeur (le plus léger) | MiDaS v2.1 small | 63,7 Mo (fp32) | MIT | projet figé depuis 2022 |
| **Segmentation sémantique** | OneFormer / UperNet ADE20K | 455-840 Mo | mit | **aucun export ONNX trouvé** |
| Détourage sujet/fond | BiRefNet | 467,0 Mo | mit | ne donne pas le ciel |
| Sélection désignée | SlimSAM (2 fichiers) | **19,8 Mo** | apache-2.0 | ne nomme rien |

### 7.2 Le coût d'intégration, mesuré

| Poste | Chiffre | Mesuré comment |
|---|---|---|
| Exécutable actuel | **9,1 Mo** | sur disque |
| Paquets Rust verrouillés actuels | **482** | `Cargo.lock` |
| `ort` par défaut : exécutable | **20,47 Mo** | build release réel |
| `ort` par défaut : DLL obligatoires | **0** (DirectML en delay-load) | exe démarré sans |
| `ort` WebGPU : DLL obligatoires | **22,67 Mo**, 3 fichiers | `STATUS_DLL_NOT_FOUND` sans elles |
| `onnxruntime.dll` officielle | **16 149 344 o (15,40 Mio)** | catalogue du zip v1.29.0 |
| ⚠️ Le même zip annoncé | 76 Mo — dont **394,9 Mio de `.pdb`** | 95 % non livrable |
| Voie JS : `ort-wasm-…jsep.wasm` | **26 827 543 o (~25,6 Mio)** | tarball npm 1.27.0 |
| Crates liées ajoutées : `ort` / `tract` / `candle` | **+7** / +62 / +75 | `cargo tree` |

**Ordre de grandeur** : le moteur seul pèse **2 à 3 fois l'app actuelle**, et le
plus petit modèle permissif **5 fois**. Un « +47 Mo » n'existe pas : le plancher
réaliste est **moteur + modèle**, soit ~**45 Mo (voie JS, fp16 partagé)** à
~**70 Mo (voie Rust `ort`)** ajoutés à 9,1 Mo.

### 7.3 Les quatre runtimes, en un coup d'œil

| | `ort` | `tract` | `candle` | `wonnx` |
|---|---|---|---|---|
| Version / date | 2.0.0-rc.13, 2026-07-28 | 0.23.4, 2026-07-08 | 0.11.0, 2026-06-26 | **0.5.1, 2023-09-30** |
| Vivant ? | oui (jamais stable) | oui (push d'hier) | oui | **⛔ dépôt ARCHIVÉ** |
| Pur Rust / sans DLL | non | **oui** | oui | oui |
| GPU sous Windows | DirectML, CUDA, WebGPU | **aucun** | CUDA seul | Vulkan/DX12 |
| ONNX | complet | opsets 9→24 | ~80 ops | **82/170, `Slice` absent** |
| Peut prendre le device de l'app | non (autre processus) | — | — | **non, par construction** |

### 7.4 La question du device partagé, tranchée

| Voie | Même `GPUDevice` que l'app ? | Praticable ? |
|---|---|---|
| `wonnx` (Rust) | **Non** — crée le sien, module privé | **Non** (archivé, `Slice` manquant) |
| `ort` WebGPU (Rust) | **Non** — Dawn dans le processus Rust | Oui, mais second contexte GPU |
| **ORT Web (JS)** | **OUI** — `executionProviders: [{name:'webgpu', device}]` ≥ 1.22.0 | **Oui**, 3 pièges non documentés |
| **transformers.js** | **OUI** — via `session_options` | Oui, + 2 réglages hors-ligne |

**La seule voie qui réalise ce que le ticket espérait est en JavaScript, dans la
WebView** — pas en Rust. Et elle impose de **recréer le `GPUDevice`** avec les
limites et `shader-f16` (§3.5).

### 7.5 Résolution, contours et temps

| | Depth-Anything V2 | MiDaS / DPT | Depth Pro |
|---|---|---|---|
| Entrée sur une photo 6240×4160 | **784 × 518** | 384 × 384 (déformé) | 1536 × 1536 |
| Part de la photo réellement vue | **1,6 %** | 0,6 % | 9,1 % |
| Ré-échantillonnage en surface | **× 64** | × 176 | × 11 |
| Erreur de bord de 1 px inféré | **8 px sur la photo** | 16 px | 4 px |
| **Plafond de F1 de frontière** (oracle, GT parfaite) | **0,065** | 0,044 | 0,311 |
| F1 de frontière réel (Sintel) | 0,228 | 0,181 | 0,409 |
| Rappel sur silhouettes (DIS-5K) | 0,056 | 0,018 | **0,077** |
| Latence (V100-32G, **indépendante de la taille photo**) | **91 ms** | 28-33 ms | 341 ms |
| Licence des poids | Small ✅ / Base-Large ⛔ | ✅ MIT | ⛔ recherche |

**Les deux lignes à retenir ensemble** : le temps ne dépend PAS des 26 Mpx
(§4.7), et la netteté de bord est plafonnée par la résolution d'inférence
**avant même** qu'un modèle entre en jeu (§4.3). Le seul modèle qui déplace ce
plafond est celui dont les poids sont interdits.

### 7.6 Ce qui n'a PAS pu être vérifié — la liste, en un endroit

À traiter comme des trous, pas comme des détails :

1. **Aucun chiffre de latence Windows grand public** pour aucun de ces modèles.
   C'est le trou le plus important, et il se comble par une mesure locale.
2. ~~**Les limites et features réellement exposées par l'adaptateur WebGPU de
   cette machine**~~ — ✅ **MESURÉ le 2026-08-18**, par sonde CDP sur la vraie
   fenêtre, dans la foulée de cette recherche :

   | Grandeur | Valeur mesurée |
   | --- | --- |
   | `shader-f16` | **PRÉSENTE** — donc fp16 possible, 47 Mo au lieu de 94 |
   | Nombre de features de l'adaptateur | 19, dont `subgroups` et `timestamp-query` |
   | `maxStorageBufferBindingSize` | 2 147 483 644 (≈ 2 Gio) |
   | `maxBufferSize` | 2 147 483 648 (2 Gio) |
   | `maxComputeWorkgroupStorageSize` | 32 768 (32 Kio) |
   | `maxComputeInvocationsPerWorkgroup` | 1 024 |

   ⚠️ **Mais l'ADAPTATEUR n'est pas le DEVICE, et c'est là que ça se joue.**
   `gpuContext.ts:120-125` ne demande que `timestamp-query`, et
   conditionnellement — jamais `shader-f16`, ni aucune feature de calcul :

   ```ts
   const featuresOptionnelles: GPUFeatureName[] = adapter.features.has("timestamp-query")
     ? ["timestamp-query"] : [];
   const device = await adapter.requestDevice({
     requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
     requiredFeatures: featuresOptionnelles,
   });
   ```

   Une feature ne s'ajoute pas après création. Le device que l'app tient
   aujourd'hui **ne peut donc pas faire de fp16**, et le §3.5 a raison : la voie
   ORT Web impose de **recréer le `GPUDevice`**. Ce n'est pas une limite du
   matériel — la machine sait le faire — c'est une ligne de notre code.
   Bonne nouvelle pour le reste : ce qui manque est demandable, pas absent.
3. **La contradiction de licence sur `DA3-LARGE-1.1`** (README CC-BY-NC contre
   carte HF Apache-2.0) — non résolue en amont.
4. **La licence effective d'un modèle distillé depuis un enseignant CC-BY-NC**
   (Distill-Any-Depth Large) — question juridique, hors de ma compétence.
5. **La forme exacte de la sortie « ciel » de DA3MONO-LARGE** — la recherche de
   code a été bloquée par le rate limit de l'API GitHub.
6. **La résolution d'entrée de Depth Anything V3 en ONNX** — absente du dépôt et
   du README.
7. **`ort` n'a jamais exécuté d'inférence réelle ici** : le binaire a été
   construit et démarré sur Windows 10, mais aucun modèle chargé, aucun EP
   enregistré — alors que la doc annonce « recent version of Windows 11 ».
8. **Aucune implémentation WGSL publique** d'un filtrage guidé à reprendre.
9. **Les tailles d'exécutable de `tract`, `candle` et `wonnx`** n'ont pas été
   mesurées (seul `ort` l'a été).
10. **Aucun export ONNX trouvé** pour les deux modèles sémantiques permissifs —
    absence non prouvée (§5.3).

*(Note d'unité : toutes les tailles de ce document sont en **Mio** — octets
divisés par 1 048 576. Certaines sources publient en Mo décimaux, ce qui les
fait paraître ~5 % plus grosses : 94,5 Mio = 99,1 Mo.)*
