# Textures et scans — design et livraison

> ⚠️ **LIRE D'ABORD : [ADR-0018](../../../.claude/decisions/ADR-0018-la-texture-est-un-effet-pas-un-calque-photo.md)
> renverse le §2 D1 de ce document.** Une texture est un **effet** du registre
> (`texture`, le 22ᵉ), pas un calque photo. Le reste du document tient — la
> bibliothèque, les vignettes, la mesure du contraste des scans, le budget VRAM,
> la contrainte de licence — et il est conservé tel quel, avec ses raisonnements
> d'origine visibles. Seule la FORME du livrable a changé.

> Écrit et livré le 2026-08-05, sur demande d'Antoine (« je voudrais qu'on
> puisse ajouter des textures du type aussi », référence : *Surface Supply
> Ultra High Res Textures*, Fox Rockett Studio — 83 scans JPG 4961×7016, 600
> DPI, familles Grunge / Papier / Tissu / Carton), puis « il nous faut des
> textures en 8K si possible » et « il faudrait qu'on ait des textures déjà
> chargées aussi ».
>
> **Portée : les textures et les scans, RIEN D'AUTRE.** Ce document découpe une
> tranche du chantier 3 de `docs/ROADMAP.md` (« éléments et composition ») et
> laisse dehors : formes, typographie, finalisation du recadrage, light leaks.
> Le pourquoi de ce découpage est en §1 — ce n'est pas de la commodité.

---

## 1. La trouvaille qui a rendu cette tranche bon marché

`docs/ROADMAP.md` §3 posait une question de modèle avant toute ligne de code :
« un troisième genre de calque, ou un effet qui synthétise son propre contenu ? ».

**Pour les textures, la question ne se pose pas.** Un scan est un JPEG, donc un
raster, donc un `LayerState` portant `imageSource` — le modèle le couvre déjà.
Ce sont **formes et typographie** qui sont le troisième genre (du contenu
vectoriel généré, sans texture source), et elles seules.

Les deux se découplent donc, et les textures sont passées devant **sans toucher
`LayerState`** — la couche la plus partagée du projet.

Ce qui existait déjà et qui n'a pas été réécrit : `addPhotoLayer`, les onze
modes de fusion (`Produit`, `Écran`, `Lumière tamisée`, `Incrustation`…),
l'opacité et le masque par calque, la transformation à deux axes plus rotation,
et l'étape `Levels` du cahier sous forme d'un calque `curves` **écrêté**
(ADR-0005, ADR-0008). Le cahier de postproduction
(`2026-08-03-references-postproduction.md:320-332`) décrit exactement cette
grammaire. **Elle était complète ; ce qui manquait était l'accès et le geste.**

---

## 2. Décisions

### D1 — Une texture est un calque photo, tel quel

> ⛔ **RENVERSÉ LE JOUR MÊME par [ADR-0018](../../../.claude/decisions/ADR-0018-la-texture-est-un-effet-pas-un-calque-photo.md).**
> `texture` est un EFFET du registre (le 22ᵉ). Ce qui suit reste écrit parce que
> le raisonnement a servi et que sa moitié fausse est instructive — mais **ne pas
> le lire comme une contrainte active** : le code fait l'inverse.
>
> Ce qui a tenu de D1 : la bibliothèque, les vignettes, `coverCanvas` et
> `importTextureFromPath` sont livrés et servent les deux voies. Un scan reste
> importable en calque photo ; c'est simplement le geste rare.
>
> Ce qui est tombé : « aucun effet `texture` au registre ». Antoine a rouvert la
> question trois fois, et l'objection qui l'écartait ne portait pas (voir
> l'encadré ci-dessous, déjà corrigé une première fois). La vraie contrainte —
> `params` est un `Record<string, number>`, donc un effet ne peut pas désigner
> une image — se contourne en séparant les deux moitiés de la référence : **le
> paramètre porte le RANG, le binding 7 porte les pixels.**

*Arbitrage d'Antoine.* Aucun genre de calque « texture », aucun effet
`texture` au registre.

Écartées : un **genre de calque distinct** (touche `LayerState` pour une
capacité que le calque photo porte déjà à 90 %) et un **effet `texture`**.

⚠️ **La raison donnée d'abord contre l'effet était FAUSSE, et il faut la
corriger ici plutôt que la laisser circuler.** Il a été écrit qu'« ADR-0008
interdit de poser un effet sur un calque photo, donc sur la photo qu'on veut
texturer ». La seconde moitié est fausse. ADR-0008 interdit d'écrire un
`effectId` **SUR** le calque qui porte `imageSource` ; il n'interdit pas
d'appliquer un effet à une photo — c'est même le flux normal, et il marche : un
effet est un calque à part, posé au-dessus et **écrêté** à la photo
(`setLayerClip`, ADR-0005). Tous les effets du registre atteignent la photo par
ce chemin, tous les jours.

**La vraie raison, structurelle et vérifiable :** `LayerState.params` est un
`Record<string, number>`, parce que l'uniform est `array<f32, 48>` et que rien
d'autre ne franchit cette frontière (`layers/types.ts`). **Un effet n'a aucun
champ par lequel désigner une image.** Lui en donner un, c'est ajouter à
`LayerState` une référence de contenu — soit `imageSource`, et c'est alors un
calque photo, soit le `contentSource` de la voie A. La voie « effet » ne tombe
donc pas sur une interdiction, elle tombe sur le même mur que la typographie
(cadrage « éléments et composition » §3).

S'ajoute le coût que l'effet paierait pour rien : il redoublerait transform,
masque et fusion que le calque photo sait déjà faire.

**Conséquences assumées :**
- Une texture **compte dans `MAX_PHOTO_LAYERS = 5`**. Elle coûte ce que coûte
  une photo, elle doit peser pareil dans la garde. Le message d'erreur du
  plafond a été réécrit pour le dire (`usePhotoLayer.importTextureFromPath`) :
  parler de « photos importées » devant une grille de textures enverrait
  chercher une photo à supprimer.
- **Pas de tuilage.** Sans objet au format de ces scans : ils couvrent le cadre
  d'un seul tenant. Redeviendrait une question sur des textures petites ou
  sans couture.

### D2 — Résolution native, pas de réduction à l'import

*Arbitrage d'Antoine : « résolution native adapté à la toile, ça nous permet de
pouvoir bouger dans la texture ».* La marge de résolution au-delà du cadre EST
la capacité de recadrer dans la texture.

⚠️ **La réduction à l'import avait été recommandée, et l'arithmétique la
réfute.** Sur les photos réellement mesurées de la machine (6240×4160) et le
format du pack (4961×7016) :

| Orientation de la texture | Échelle pour couvrir | Marge de déplacement |
| --- | --- | --- |
| Portrait (4961×7016) | **1,258** — agrandissement requis | aucune, trop étroite |
| Paysage (7016×4961) | **0,889** | ~0 % en largeur, **6 %** en hauteur |

À ce format la texture **couvre tout juste** une photo de 26 Mpx : il n'y avait
rien à réduire, et réduire aurait mangé les 6 % restants. C'est ce calcul qui
justifie la demande de 8K — à 8192 px de long, la marge passe à ~31 %.

### D3 — Fusion par défaut : `Lumière tamisée`, pour toutes les familles

*Délégué par Antoine (« je te fais confiance »).*

Un défaut est NÉCESSAIRE : `addPhotoLayer` crée en `normal`, donc opaque, donc
la texture cache la photo. Le premier geste serait toujours de changer ce mode.

Le défaut n'est PAS déduit du contenu. Le cahier liste trois modes
(`Screen`, `Multiply`, `Soft Light`) et les deux premiers ne conviennent qu'à
un sens de contraste — `Multiply` veut du sombre sur clair, `Screen` l'inverse —
alors que rien dans un fichier ne dit lequel il contient. La voie tentante
(mesurer la luminance moyenne du scan) est écartée : c'est un **proxy** de
« clair sur sombre », pas la chose même, et le dépôt a déjà payé neuf fois ce
genre d'automatisme (mémoire `sondes-cdp-mesurent-un-proxy`). Un proxy qui se
trompe ici ne lève rien — il pose juste le mauvais mode, en silence.

`soft-light` est le seul des trois qui tienne dans les deux sens. Passer en
Produit ou Écran reste à un clic. Raison complète :
`src/textures/textureLayer.ts`.

### D4 — Trois dossiers, résolus sans rien demander

*Demande d'Antoine : « des textures déjà chargées ».* Au montage, dans l'ordre :

1. le dossier désigné la dernière fois (`localStorage`) ;
2. **`Images/shaderlab-textures`** — la bibliothèque, jumelle exacte
   d'`Images/shaderlab-export` ;
3. `<ressources>/textures` — le jeu livré avec l'application.

Un échec de l'un essaie le suivant, en silence — un disque externe débranché
n'est pas une erreur à afficher au démarrage.

⚠️ **Les gros fichiers vivent en 2, jamais en 3, et c'est une mesure qui l'a
décidé.** Le jeu CC0 téléchargé pèse **2,64 Go pour 44 matières 8K**. Posé dans
`bundle.resources`, il serait recopié dans l'installateur ET dans le dossier
cible à **chaque build**, `tauri dev` compris. Premier jet de cette tranche : le
dossier de ressources était l'unique candidat, et les 44 matières y ont
effectivement atterri avant d'être déplacées. Le dossier de ressources reste
réservé à un jeu de départ minuscule, ou à rien.

⚠️ **Contrainte de licence, sans exception.** Le dossier de ressources part dans
l'installateur : tout ce qu'il contient est REDISTRIBUÉ. Seul du **CC0** peut y
aller ([ambientCG](https://ambientcg.com/),
[Poly Haven](https://polyhaven.com/license) — les deux vérifiés à la source).
**Un pack payant n'y va jamais** : Fox Rockett, True Grit et RetroSupply se
vendent avec une licence d'utilisation, pas de redistribution. Pour ceux-là, le
chemin est l'autre — désigner un dossier, dont le chemin est retenu. Rien n'est
copié. Détail : `src-tauri/textures/README.md`.

Les images ne sont versionnées nulle part (un 8K pèse de 30 à 100 Mo ; git ne
sait ni compresser ni différencier du binaire). Conséquence assumée : **un dépôt
fraîchement cloné n'a aucune image**, et le panneau le dit.

### D5 — Le jeu CC0 de départ, et comment il a été tiré

44 matières ambientCG en 8K-JPG, **carte Color uniquement** :
- Papier (4) et Carton (4) — les familles du pack de référence, prises en
  entier ;
- Tissu et tapis (8), Béton (6), Plâtre (4), Métal et acier rouillé (6),
  Roche (3), Sol et feuilles (4), Bois (3) — le grunge, qu'ambientCG ne nomme
  pas comme tel.

Toutes en **8192** sur le grand côté : exactement la limite du device, aucune
marge au-dessus.

⚠️ **ambientCG ne sert PAS les cartes à l'unité** — vérifié, une requête sur un
`*_Color.jpg` rend 404, seuls les zips complets existent (API v2). Un zip 8K-JPG
pèse de 85 à 593 Mo et contient Color, Normal, Roughness, Displacement et AO,
dont **seule la Color sert en overlay**.

Les cartes ont donc été extraites par **requêtes HTTP Range** : un zip se lit par
la fin (EOCD → catalogue central → en-tête local → données), donc trois petites
requêtes suffisent avant de tirer les seuls octets utiles. **2,64 Go tirés au
lieu des ~15 Go** qu'auraient pesé les zips complets. Le script vit dans le
scratchpad de session, pas dans le dépôt — c'est un geste d'approvisionnement,
pas une dépendance du produit.

---

## 3. Ce qui a été construit

| Pièce | Fichier |
| --- | --- |
| Dialogue dossier, listing récursif (3 niveaux, tri stable) | `src-tauri/src/lib.rs` — `pick_texture_folder`, `list_texture_files` |
| Dossier livré | `src-tauri/src/lib.rs` — `default_texture_dir` + `bundle.resources` |
| Wrappers IPC | `src/launch.ts` |
| Couverture de toile avec choix d'orientation | `src/ui/transform.ts` — `coverCanvas` |
| Dimensions lues dans l'en-tête, sans décoder | `src/textures/imageDimensions.ts` |
| Vignettes hors GPU, concurrence bornée | `src/textures/thumbnailCache.ts` |
| Défaut de fusion et sa raison | `src/textures/textureLayer.ts` |
| État de la bibliothèque | `src/hooks/useTextureLibrary.ts` |
| Ajout d'une texture en calque | `src/hooks/usePhotoLayer.ts` — `importTextureFromPath` |
| Carte du dock | `src/components/TextureLibrary.tsx` + `.css` |
| Seuil GPU réel exposé | `src/render/renderer.ts` — `maxTextureDimension` |

`list_texture_files` **rejette au-delà de 5000 fichiers au lieu de tronquer** :
une liste coupée se lit exactement comme un dossier complet.

---

## 4. Ce que cette tranche ne fait PAS

- **Les light leaks n'en sont pas.** Cahier ligne 330 : dégradés rouge / orange
  / jaune, flou important, mode `Screen`, au bord du cadre. Contenu
  **synthétisé**, donc un effet du registre avec sa référence de pixels et sa
  mire. Chantier séparé.
- **Le tuilage** (§2, D1) et **formes / typographie** (§1).

---

## 5. VRAM — le risque n'était pas où le premier jet le plaçait

Une texture 4961×7016 en RGBA8 = **139 Mo**, une 8192×8192 = **268 Mo**, contre
104 Mo pour une photo 6240×4160. Sans réduction (D2).

⚠️ **Le plafond de CALQUES n'est pas le risque.** `MAX_PHOTO_LAYERS = 5` borne
déjà ce cas. Le risque est le plafond des **sources enregistrées** —
`MAX_REGISTERED_PHOTO_SOURCES = 20`, dont **rien n'est jamais libéré** (aucun
refcount, par choix : un undo peut ramener un calque supprimé). Ce budget a été
calibré sur des photos, pour un geste rare : on importe quatre photos, on ne les
feuillette pas.

Une grille de vignettes invite exactement le geste inverse. Vingt clics sur des
scans 8K demanderaient **5,4 Go**, sur une carte de 6 Go dont le pire cas mesuré
est déjà à ~84 % (`layers/photoLayer.ts`). La bibliothèque saturerait le garde
en trente secondes de navigation, **sans qu'aucun calque n'ait été créé**.

**Parade appliquée, et elle ne coûte rien : la vignette ne touche jamais le
GPU.** `PhotoSourceStore.register` n'est appelé qu'au moment où une texture
devient réellement un calque. Trois bornes tiennent l'aperçu — décodage réduit
(`resizeWidth`), `close()` immédiat sur l'`ImageBitmap`, et au plus trois
décodages simultanés. Plus un chargement **paresseux** par
`IntersectionObserver` : ouvrir un dossier de 83 fichiers 8K ferait sinon
transiter ~1,6 Go par l'IPC pour afficher une douzaine de cases.

**Levier non exploré, à mesurer avant d'être proposé** : un scan de grunge ou de
papier en Produit / Écran / Lumière tamisée est proche du monochrome. Le stocker
en `r8unorm` diviserait son coût par 4 (268 → 67 Mo) sans coûter un pixel de
marge de déplacement. ⚠️ Pas gratuit : les scans de papier et de carton sont
**teintés**, et en Produit cette teinte est du rendu, pas du bruit. À mesurer,
pas à décider ici.

## 5 bis. La limite de 8192 est dure

`assertImageFitsGpu` borne sur `device.limits.maxTextureDimension2D`, et
shaderlab ne passe **aucun `requiredLimits`** à `requestDevice` : le device
reçoit les limites par défaut de la spec WebGPU — **8192**, même sur une carte
qui sait faire 16384. Un « 8K » carré passe donc EXACTEMENT à la limite, et 8193
est refusé.

La bibliothèque lit les dimensions dans l'en-tête sans décoder et **désactive la
vignette** au-delà du seuil, en l'affichant. Voir le problème avant le clic
plutôt qu'un bandeau d'erreur après.

---

## 6. Preuve

Aucune référence de pixels n'est due : cette tranche n'ajoute **aucun shader**.
Le compositing d'un calque photo en Lumière tamisée est déjà rendu par du code
verrouillé.

Ce qui est prouvé, et où :
- `test/ui/transform.test.ts` — `coverCanvas` : couverture des deux axes sur
  trois rapports d'aspect, choix d'orientation sur les chiffres réels du pack,
  homothétie, taille dégénérée, et la distinction cover / contain elle-même.
- `test/textures/imageDimensions.test.ts` — dont le piège classique du parseur
  JPEG : une table de Huffman (`FF C4`) est dans la plage `Cx` sans être un SOF,
  et la confondre rendrait des dimensions **plausibles**, donc un défaut
  invisible.
- `test/textures/thumbnailCache.test.ts` — concurrence bornée, totalité sur
  échec de lecture, jeton rendu même en cas d'échec (sinon le sémaphore se
  bloque), et une entrée qui atterrit après `dispose` n'entre pas dans le cache.
- `test/textures/textureLayer.test.ts` — le défaut de fusion désigne un mode
  réel. `getBlendMode` lève sur un id inconnu, mais **au rendu**, sur le premier
  calque texture posé, devant l'utilisateur : ce test avance la levée au banc.

État : `npx tsc --noEmit` propre, `cargo check` propre, `npm run lint` et
`npm run lint:tokens` propres, `npm run test` à **1780/1780**.

**Ce qu'aucun de ces bancs ne dit** : si une texture rend bien sur une vraie
photo. C'est un checkpoint humain, comme tout le §1 de `docs/ROADMAP.md`.
