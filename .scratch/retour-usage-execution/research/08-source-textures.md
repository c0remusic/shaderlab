# 08 — Source de textures pour l'effet `Texture` (+ licences)

Recherche du ticket `08-chercher-source-textures.md`. Question d'Antoine :
« il faut chercher une source pour plus de textures ». Cible : enrichir le
catalogue de l'effet `Texture` (`src/render/effects/texture.ts`, ADR-0018), qui
échantillonne une image de bibliothèque par le binding 7 (rang trié + pyramide de
mipmaps).

**Règle du projet, non négociable** : le dossier `src-tauri/textures/` part dans
l'installateur, donc **tout ce qu'il contient est REDISTRIBUÉ** — seul du CC0 (ou
domaine public équivalent) peut y aller (`src-tauri/textures/README.md`,
design 2026-08-05 §D4). Précédent cité : `webgpu-image-filter` sans licence =
inspiration seulement, jamais de reprise. Le positionnement « produit
partageable » n'est pas tranché (CLAUDE.md § Quoi), donc on exige une licence qui
autorise la **redistribution commerciale** — ce qui écarte tout NonCommercial et
tout copyleft viral.

---

## 0. Ce que le dépôt a DÉJÀ tranché (ne pas re-décider)

Trois faits acquis qui cadrent la recherche — mesurés, pas supposés :

1. **Le dossier de ressources reste minuscule ou vide.** Le jeu CC0 déjà
   téléchargé (44 matières ambientCG 8K) pèse **2,64 Go** ; posé dans
   `bundle.resources`, il repart dans l'installateur ET se recopie à chaque build
   (`tauri dev` compris). Les gros jeux vivent dans la bibliothèque utilisateur
   `Images/shaderlab-textures`, **jamais** dans les ressources
   (`2026-08-05-textures-scans-design.md` §D4).
2. **Le chemin « Dossier… » existe déjà** (`TexturePicker`) : l'utilisateur
   désigne un dossier quelconque de sa machine, son chemin est retenu, **rien
   n'est copié ni redistribué**. C'est la porte des packs payants (Fox Rockett
   Surface Supply, True Grit, RetroSupply) — licence d'utilisation, pas de
   redistribution.
3. **⚠️ La meilleure licence n'est pas le meilleur contenu.** Les cartes CC0
   d'ambientCG / Poly Haven sont des **albédos PBR dé-éclairés** : le dépôt a
   mesuré une étendue tonale moyenne de **10 niveaux sur 255** (Paper005 : UN
   seul niveau) — `texture.ts` a dû ajouter un curseur `Contraste` allant
   jusqu'à ×24 pour les rendre visibles. Un albédo PBR répété rend un aplat.
   Pour un overlay de post-prod photo, il faut du contenu **avec la lumière
   cuite dedans** (plis, vignetage, grain), c.-à-d. des scans photographiques,
   pas des cartes de moteur 3D.

Le ticket 08 n'est donc pas « où trouver du CC0 » (résolu : ambientCG /
Poly Haven), c'est « où trouver du CC0 **utilisable pour un overlay photo** », et
« le procédural peut-il remplacer une partie du pack ».

---

## 1. Recommandation — les DEUX, avec un partage précis

**Embarquer un petit pack CC0 curé + ajouter un générateur procédural.** Ni l'un
ni l'autre seul ne couvre les deux besoins.

### 1a. Pack embarqué — petit, curé, CC0 photographique

Remplir le dossier `<ressources>/textures` (aujourd'hui vide) que l'app résout
déjà en dernier recours — ce qui répond littéralement à la demande d'Antoine
« il faudrait qu'on ait des textures déjà chargées ». Contrainte : **~15–25
images, en 2K–4K, ≈ 20–40 Mo au total** (pas les 8K du jeu de 2,64 Go).

- **Source principale : Texture Ninja (CC0, 5000+ scans photographiques).** C'est
  le seul candidat qui coche licence propre ET contenu à lumière cuite : papier,
  carton, béton, tissu, rouille, bois — la matière que l'effet attend. Voir §2.
- **Complément : ambientCG / Poly Haven**, mais **uniquement les cartes Color
  dont l'étendue tonale est réelle** (mesurer avant de retenir — la plupart sont
  plates, cf. §0.3).
- **Fournir un `PROVENANCE.md`** listant, par fichier, source + licence + URL.
  CC0 n'exige aucune attribution, mais la preuve protège contre le seul point
  faible de Texture Ninja (licence déclarée par l'auteur, pas de deed CC0 par
  fichier au téléchargement — cf. §2).

### 1b. Générateur procédural — WGSL, zéro Mo, familles régulières

Un générateur qui synthétise papier / toile / craquelure / mouchetis en shader,
à partir de bruit **MIT/WTFPL** (§3). Il couvre exactement les familles que le
cahier nomme (papier, tissu, grain argentique, craquelure) et que le procédural
rend **bien par construction** — non-tuilant, indépendant de la résolution,
tonalité pleine (donc pas le problème d'aplat du §0.3).

**Intégration recommandée : pré-cuire le procédural dans une texture GPU qui
alimente le binding 7 existant**, plutôt qu'un effet qui calcule le bruit dans
`fs_main`. Raison : `texture.ts` échantillonne derrière un `fract` et **dépend
de la pyramide de mipmaps** (sinon scintillement en minification — c'est écrit
noir sur blanc dans `textureLibraryStore.ts:216` et le commentaire mip de
`texture.ts`). Un bruit calculé par pixel sans band-limiting ré-introduirait
exactement l'aliasing que la pyramide corrige. En pré-cuisant une fois (2K–4K),
on **réutilise tout le chemin existant** — mipmaps, section *Niveaux*,
*Placement*, éviction VRAM — et le coût GPU est payé **une seule fois à la
génération**, pas par frame. Bonus : c'est la **même boîte à outils de bruit**
dont les tickets 06/07 (encre procédurale) auront besoin — un seul chantier de
fonctions WGSL sert les deux.

### 1c. Garder « Dossier… » comme échappatoire

Déjà construit. C'est la voie des packs payants et des bibliothèques perso :
rien n'est redistribué, aucune licence à respecter côté produit.

### Pourquoi pas un seul des deux

- **Pack seul** : coûte du disque, tuile (un scan répété se lit comme un filtre),
  et le CC0 photographique de qualité est rare et hétérogène.
- **Procédural seul** : ne sait pas fabriquer le **caractère macro** d'un vrai
  scan — bord déchiré, tache de café, tissage d'une toile réelle, pli de papier.
  Le bruit fait des familles régulières, pas des accidents.

---

## 2. Sources candidates — licence exacte et verdict d'embarquement

Verdict = « peut-on **redistribuer les fichiers dans l'installateur** ? »
(l'usage sur une photo est toujours permis ; c'est la redistribution du fichier
source qui se juge ici).

| Source | Licence exacte | Contenu / résolution | Embarquable ? | Note |
|---|---|---|---|---|
| **Texture Ninja** (Joost Vanhoutte) | **CC0 1.0** (domaine public), 5000+ images | Scans **photographiques** : papier, carton, béton, tissu, rouille, bois, pierre — lumière cuite | ✅ **OUI** | **Meilleur rapport licence/contenu.** Seul bémol : CC0 **déclaré par l'auteur** (page + article CGPress), pas un deed par fichier au download → archiver la déclaration comme preuve. |
| **ambientCG** (Lennart Demes) | **CC0 1.0**. Doc explicite : « include the raw files in your project », commercial, sans attribution | Matières PBR jusqu'à 8K, JPG/PNG | ✅ **OUI** | ⚠️ Cartes **Color = albédo dé-éclairé, plates** (§0.3). Ne retenir que celles à étendue tonale réelle. Cartes Normal/Rough/Displ. inutiles en overlay. |
| **Poly Haven** | **CC0**. « redistribute them… or even in a product you sell » | Textures/HDRI/modèles, 8K min | ✅ **OUI** | Même réserve albédo plat. ⚠️ L'**API** publique est *non-commerciale* — sans objet si on télécharge les fichiers à la main. |
| **Kenney** | **CC0** (toutes les pages d'assets) | Assets de jeu : sprites, tuiles, quelques packs grunge/patterns | ✅ **OUI** | Contenu surtout ludique (2D/3D game-ready), **faible fit** pour un overlay photo. Marginal. |
| **Wikimedia Commons** | **Par fichier** : PD / CC0 / CC-BY / CC-BY-SA | Scans variés, dont vieux papiers, parchemins | 🟡 **Au cas par cas** | Seuls **PD/CC0** embarquables sans condition. CC-BY = attribution obligatoire ; **CC-BY-SA = copyleft viral → éviter**. Vérifier CHAQUE fichier. |
| **OpenGameArt** | **Par fichier** : CC0, CC-BY, CC-BY-SA, GPL, OGA-BY | Textures/tuiles de jeu | 🟡 **Filtrer CC0** | N'embarquer que les items **CC0**. Le reste impose attribution/sharealike. |
| **Rawpixel** (collections « public domain ») | Œuvre sous-jacente PD/CC0, **mais** ToS Rawpixel restreint le téléchargement en masse et la redistribution de LEURS fichiers curés | Vieux papiers, textures scannées | 🟡 **Prudence** | Propre si l'œuvre est réellement PD **et** qu'on respecte leurs conditions de download. Pas de tirage en masse. Préférer la source PD d'origine. |
| **textures.com** (ex-CGTextures) | **Redistribution INTERDITE** par défaut (ToS Rev3-21) ; sous-licence seulement dans un livrable client | PBR, scans haute qualité | ❌ **NON** | **Le piège du ticket.** Inspiration / usage dans un rendu final seulement. Jamais dans l'installateur. Voie « Dossier… » possible côté utilisateur. |
| **Unsplash** | Licence Unsplash : interdit « to compile photos… to replicate a similar or competing service » et la redistribution « as-is » | Photos, dont textures | ❌ **NON (pour un pack)** | Embarquer leurs images comme bibliothèque de textures = redistribution « as-is » / compilation d'une collection = exactement ce qui est interdit. OK en dossier utilisateur. |
| **Pexels** | Idem : interdit la revente « as-is » du contenu standalone et la réplication d'un service concurrent | Photos, textures | ❌ **NON (pour un pack)** | Même raisonnement. Usage perso oui, redistribution du fichier non. |
| **Pixabay** | Content License (depuis 2019, **plus du CC0 pur**) : interdit de redistribuer/vendre le contenu « as-is » et de répliquer un service concurrent | Photos, textures | ❌ **NON (pour un pack)** | N'est plus CC0. Ne pas embarquer. |
| **Lost & Taken** (Caleb Kimbrough) | **Déclaré** « royalty-free, commercial OK, sans attribution » — **pas** un deed CC0/PD formel | Grunge, vieux papiers | 🟡 **Avec preuve** | Termes de site, pas de licence standard, redistribution-en-pack non explicitement adressée. Acceptable un cran SOUS le CC0 : archiver les termes actuels comme preuve, ou préférer Texture Ninja. |

**Tranché** : embarquables sans réserve = **Texture Ninja, ambientCG, Poly Haven,
Kenney** (CC0). Au cas par cas = **Wikimedia/OpenGameArt (CC0 uniquement)**.
**Inspiration seulement (jamais dans l'installateur)** = **textures.com,
Unsplash, Pexels, Pixabay**. Rawpixel et Lost & Taken = tolérés avec preuve, mais
Texture Ninja les rend inutiles.

---

## 3. Textures procédurales réalistes en WGSL — familles et licences du code

Le procédural couvre les familles **régulières** nommées par le cahier. Ce qui
suit s'écrit sans aucune donnée embarquée, à partir de fonctions de bruit dont la
licence est **explicitement permissive**.

### 3a. Familles réalistes et leur mécanisme

| Famille visée | Mécanisme WGSL | Réaliste en procédural ? |
|---|---|---|
| **Grain de papier / fibre** | fBm de bruit de valeur/gradient, basse-moyenne fréquence, léger anisotrope | ✅ Oui — c'est le cas d'usage canonique du fBm |
| **Toile / tissu (weave)** | Deux crêtes sinusoïdales orthogonales (trame/chaîne) modulées par un bruit d'irrégularité de fil | ✅ Oui — motif périodique + bruit |
| **Mouchetis / taches / plâtre** | fBm à **domain warp** (déplacer les coordonnées par un second fBm) | ✅ Oui — le warp casse la régularité et fait les coulures |
| **Craquelure / réseau de fissures** | **Voronoi/Worley**, arêtes F2−F1 (frontières de cellules) = réseau de fentes | ✅ Oui — cellular noise, mécanisme dédié |
| **Béton / grunge** | fBm + Voronoi superposés, contraste étiré | ✅ Oui |
| **Grain argentique** | Bruit de valeur haute fréquence, dépendant de la luminance | ⚠️ Partiellement **redondant** — le registre a déjà un effet `grain` luminance-dépendant. À ne pas redoubler ici. |
| **Vrai scan à accidents** (bord déchiré, tache réelle, pli) | — | ❌ Non — caractère macro non fabricable au bruit. C'est le rôle du pack §2. |

### 3b. Références de code — licence par source

| Référence | Licence exacte | Ce qu'elle donne | Verdict |
|---|---|---|---|
| **munrocket, « WGSL Noise Algorithms »** (gist) | **Par fonction** : Value = **WTFPL** ; Perlin/Simplex = **MIT** (Stefan Gustavson, Ian McEwan) ; fBm/VoroNoise = **MIT** (Inigo Quilez) | Portage **WGSL direct** : value/perlin/simplex 2D-3D, fBm, voronoise | ✅ **La boîte à outils.** Réutilisable ; conserver les notices MIT dans le fichier. |
| **Inigo Quilez** (iquilezles.org) | « all technical code snippets… are under the **MIT** license » ; ⚠️ le **shader ART est protégé** (pas de copie d'un shader artistique entier) | fBm, Voronoi, voronoise, gradient noise (fonctions) | ✅ Fonctions OK avec notice ; ne pas copier un shader complet « œuvre ». |
| **ashima/webgl-noise** (Ashima Arts / Gustavson-McEwan) | **MIT** | Simplex/Perlin/cellular GLSL — à porter en WGSL | ✅ MIT, garder la notice |
| **stegu/webgl-noise & psrdnoise** (Stefan Gustavson) | **MIT** | Simplex classique + « tiling simplex flow noise » (bruit tuilable — utile pour un overlay sans couture) | ✅ MIT, garder la notice |
| **noisy_bevy** (Johan Helsing) | Simplex d'origine **MIT** ; modifications de l'auteur **Apache-2.0** (double) | simplex 2D/3D, fBm, **identiques CPU et GPU** (utile pour pré-cuire en Rust) | ✅ Permissif ; les deux licences sont compatibles embarquement |
| **The Book of Shaders** (P. González Vivo) | Texte **CC-BY-NC-SA** ; **code non clairement licencié** / tous droits réservés | Pédagogie noise/fBm/cellular | ❌ **Inspiration seulement** — NC exclut de toute façon un produit commercial ; ne pas copier le code verbatim. |

**Tranché** : le socle procédural s'écrit à partir du **gist munrocket** (WGSL
direct) et des **fonctions iq/Gustavson** (MIT), en conservant les notices. Le
**Book of Shaders** reste une référence de lecture, **pas** une source de copie.

---

## 4. Poids (pack) vs coût GPU (procédural) — ordres de grandeur

### Pack embarqué — disque + VRAM

- Un scan **8K JPEG** pèse **30 à 100 Mo** ; le jeu CC0 déjà tiré = **2,64 Go
  pour 44 matières 8K** (chiffres du dépôt, `README.md` textures). **Trop lourd
  pour l'installateur.**
- Un scan **2048 px** sRGB JPEG ≈ **0,5–2 Mo**. Un **starter de 15–25 images en
  2K–4K ≈ 20–40 Mo** — tenable dans les ressources. Suffisant : à `Échelle` = 1,
  l'overlay couvre une photo 6240×4160 ; le 8K ne sert que pour un recadrage
  profond DANS la texture (marge de déplacement, §D2 du design).
- **VRAM** (indépendant du disque) : une texture **8192² RGBA8 = 268 Mo**, une
  **2048² = 16,8 Mo**. Plafond de 6 textures résidentes
  (`MAX_RESIDENT_LIBRARY_TEXTURES`). Un starter 2K est négligeable devant le pire
  cas photo déjà mesuré (~84 % d'une carte 6 Go).

### Procédural — GPU, zéro disque, zéro VRAM persistante

- **Coût = ALU pur, aucune lecture de texture.** Un fBm à 5 octaves ≈ 5
  évaluations de bruit gradient/pixel ; chaque bruit ≈ une dizaine d'opérations +
  quelques hash. Un Voronoi 3×3 ≈ 9 évaluations de cellule (2–4× un octave).
- **Ancrage de comparaison du dépôt** : la pile entière à **5 effets recompose
  en 23 ms** sur 26 Mpx (verdict Affinity 2026-08-19) → ~4,6 ms/effet en moyenne,
  fetch et compositing compris ; la diffusion de `glass` (16 taps, **fetch-bound**)
  coûte ~10 ms. Un générateur fBm **ALU-bound sans fetch** se situe **au niveau ou
  en-dessous d'un effet moyen** — **single-digit ms à 26 Mpx** pour un fBm modéré,
  davantage pour un Voronoi multi-octaves.
- **Si pré-cuit (intégration recommandée §1b)** : la génération est **payée UNE
  fois** à 2K–4K (16 Mpx max), pas par frame ; ensuite c'est une texture statique
  qui coûte au sample **exactement ce que coûte un scan**, pyramide comprise. Le
  coût par-frame retombe donc à zéro au-delà de la génération.
- **⚠️ Règle du dépôt** : toute mesure GPU se prend en **build de PRODUCTION**
  (`node scripts/perf-probe.mjs`) — le plancher du dev est **2,6× celui de la
  prod** et noierait le signal. Les ms ci-dessus sont des ordres de grandeur
  raisonnés depuis les ancres du dépôt, **à mesurer avant de committer** un
  générateur qui tourne par frame (mémoire `mesure-en-dev-ne-prouve-pas-l-absence`).

### Bilan chiffré

| Voie | Disque installeur | VRAM | GPU/frame | Variété |
|---|---|---|---|---|
| Pack 2K curé (15–25 img) | ~20–40 Mo | ~17 Mo/texture résidente | coût d'un sample (déjà payé) | Finie, mais **caractère macro réel** |
| Procédural pré-cuit | **0 Mo** | ~17 Mo/texture générée | **0** après génération | **Infinie**, familles régulières |
| Procédural par-frame | **0 Mo** | 0 | single-digit ms à 26 Mpx (à mesurer) | Infinie, mais aliasing à band-limiter |

---

## 5. Note d'attribution / emplacement (si pack embarqué)

- **Emplacement** : `src-tauri/textures/` (empaqueté par `bundle.resources`,
  résolu par `default_texture_dir` en dernier). Respecter le `.gitignore` qui
  exclut les images — ou versionner un starter 2K léger si on veut qu'un clone
  frais ait des textures (décision à prendre en ticket 09).
- **Provenance** : ajouter `src-tauri/textures/PROVENANCE.md` — une ligne par
  fichier : nom, source, URL, licence. Le CC0 n'exige pas d'attribution, mais
  cette table est la **preuve** de conformité (et comble le point faible de
  Texture Ninja, cf. §2).
- **Format** : carte **Color uniquement** pour les sources PBR ; JPEG sRGB ;
  côté long ≤ 4096 (2048 recommandé pour le starter). La limite dure du device
  est **8192** (`assertImageFitsGpu`).

---

## Sources

- [ambientCG — License (docs)](https://docs.ambientcg.com/license/)
- [ambientCG](https://ambientcg.com/)
- [Poly Haven — License](https://polyhaven.com/license)
- [Poly Haven — Commercial Licensing (API non-commerciale)](https://polyhaven.com/corporate)
- [Texture Ninja](https://texture.ninja/)
- [CGPress — Texture Ninja offre des textures domaine public (CC0, Joost Vanhoutte)](https://cgpress.org/archives/texture-ninja-offers-public-domain-reference-textures.html)
- [Kenney — Support/License](https://kenney.nl/support)
- [textures.com — Terms of Service Rev3-21 (redistribution interdite)](https://www.textures.com/static/terms/TexturesCom%20-%20Terms%20of%20Service%20Rev3-21.pdf)
- [textures.com — FAQ License](https://www.textures.com/support/faq-license)
- [Unsplash / Pexels / Pixabay — pièges de licence (compilation/redistribution interdites)](https://www.licenseorg.com/blog/free-stock-photos-licensing-traps)
- [Pexels — Terms and Conditions](https://help.pexels.com/hc/en-us/articles/900005880463-What-are-the-Terms-and-Conditions)
- [Pixabay — Content License](https://pixabay.com/service/license-summary/)
- [Lost & Taken (Caleb Kimbrough) — termes déclarés](https://www.deviantart.com/lostandtaken/about)
- [munrocket — WGSL Noise Algorithms (licences par fonction)](https://gist.github.com/munrocket/236ed5ba7e409b8bdf1ff6eca5dcdc39)
- [Inigo Quilez — articles (code technique MIT, art protégé)](https://iquilezles.org/articles/)
- [ashima/webgl-noise (MIT)](https://github.com/ashima/webgl-noise)
- [stegu/psrdnoise (MIT)](https://github.com/stegu/psrdnoise)
- [noisy_bevy — Johan Helsing (MIT + Apache-2.0)](https://github.com/johanhelsing/noisy_bevy)
- [The Book of Shaders (texte CC-BY-NC-SA, code non licencié)](https://github.com/patriciogonzalezvivo/thebookofshaders)
