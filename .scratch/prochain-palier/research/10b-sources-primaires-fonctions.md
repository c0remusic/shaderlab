# Vérification en sources primaires des fonctions candidates

Complément de [`10-fonctions-complementaires.md`](10-fonctions-complementaires.md),
2026-08-11. Chaque mécanisme est reformulé et rattaché à son URL ; les blocs de
documentation Adobe ne sont pas recopiés. Ce document n'arbitre rien.

## Trois notes de méthode, à ne pas repayer

1. **`helpx.adobe.com` bloque les clients HTTP non-navigateur.** WebFetch et
   `curl` restent à 0 octet sur toute page de contenu (la racine répond 301
   instantanément — c'est du fingerprinting de bot, pas un problème réseau).
   Toute lecture d'aide Adobe passe par un vrai navigateur qui rend la page,
   puis extraction du DOM.
2. **Le résumeur de recherche a produit deux faussetés vérifiables** — le piège
   annoncé, mordu deux fois : (a) il affirmait que le filtre Displace accepte
   une image en mode Bitmap ; Adobe écrit l'inverse (« Bitmap mode images are
   unsupported »). (b) Il affirmait que « Bleach Bypass » est un profil
   d'appareil listé dans Camera Raw ; recherche de la sous-chaîne `leach` sur
   la page des appareils supportés : **zéro occurrence**. Fabriqué.
3. **Adobe a réécrit une grande partie du guide Photoshop le 2026-02-23**, en
   remplaçant le texte de mécanisme par des chemins de clic (Unsharp Mask,
   Hue/Saturation, Content-Aware Fill, netteté). La prose de mécanisme survit
   sur `filter-effects-reference.html`, encore daté 2024.

## Blend If — « Fusionner si »

<https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html>

Sous *Layer > Layer Style > Blending Options*, zone **Advanced Blending**. Deux
paires de curseurs sur une échelle de luminosité 0–255, sélectionnables par
canal (Gray, ou R / V / B isolément).

⚠️ **Les deux gates sont ASYMÉTRIQUES dans ce qu'ils font du pixel rejeté**, et
c'est le point de design : *This Layer* **retire** le pixel du calque actif du
résultat ; *Underlying Layer* laisse le calque du dessous **transparaître à
travers** le calque actif. Ce ne sont pas deux versions du même geste.

**Alt-glisser scinde un curseur en deux moitiés**, ce qui définit une plage de
mélange PARTIEL entre les deux valeurs — un fondu, pas un seuil franc.

C'est une propriété de **style de calque** : live, non destructive,
ré-éditable. À ne pas confondre avec « Exclude channels from blending », sur la
même page, qui retire des canaux entiers du mélange.

## Groupes de calques et « Pass Through »

Même URL, section « Specify a blending mode for a layer or group ».

Le mode par défaut d'un groupe est **Pass Through**, ce qui signifie que le
groupe **n'a aucune propriété de mélange propre**. Choisir n'importe quel autre
mode change l'ORDRE d'assemblage : les calques du groupe sont composés d'abord,
puis le résultat est traité comme une image unique et mélangé au reste. Et donc
aucun calque de réglage ni mode de fusion interne ne s'applique plus à
l'extérieur du groupe.

⚠️ **Pass Through n'est donc pas un mode de fusion — c'est l'ABSENCE d'une
frontière de composition.** En choisir un autre insère une étape de rendu vers
un buffer. C'est exactement le coût que `10-fonctions-complementaires.md`
chiffre à ~96 Mo par niveau.

Contrainte notable : pour un groupe, **seule l'opacité est disponible**, pas le
Fill. Deux options voisines (« Blend Interior Effects As Group », « Blend
Clipped Layers As Group ») appliquent la même idée aux effets et aux masques
d'écrêtage — la seconde est cochée par défaut.

## Displace — carte de déplacement

<https://helpx.adobe.com/photoshop/using/applying-specific-filters.html>
· <https://helpx.adobe.com/photoshop/using/filter-effects-reference.html>

Le mécanisme complet, en chiffres :

- **0 = décalage négatif maximal, 255 = positif maximal, 128 = aucun
  déplacement.**
- **Une seule voie** dans la carte : l'image se décale le long d'une diagonale
  définie par les ratios d'échelle horizontal et vertical.
- **Plus d'une voie** : la première pilote le déplacement HORIZONTAL, la
  deuxième le VERTICAL.
- À 100 % d'échelle sur les deux axes, le déplacement maximal est de
  **128 pixels** — conséquence directe du gris moyen neutre.
- Si la carte n'a pas la taille de la sélection : **Stretch To Fit** ou
  **Tile**.
- Bords : **Wrap Around** (contenu du bord opposé) ou **Repeat Edge Pixels**
  (extension des pixels de bord, avec risque de banding annoncé).

Contrainte de flux : la carte se choisit dans un **sélecteur de fichier externe
APRÈS validation**, jamais depuis un calque. Fichier aplati au format
Photoshop ; **mode Bitmap non supporté**. Destructif hors Smart Filter.

## HSL / Color, Hue/Saturation, Vibrance

<https://helpx.adobe.com/lightroom-classic/help/color-mixer.html>
· <https://helpx.adobe.com/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html>
· <https://helpx.adobe.com/photoshop/using/adjusting-hue-saturation.html>

Trois axes par bande : **Teinte** (décale la nuance), **Saturation** (vivacité),
**Luminance** (clarté de la plage). Le ciblage d'une bande passe par l'outil
**Targeted Adjustment** — on clique dans la photo et on glisse ; Camera Raw
précise qu'un glisser peut affecter **plusieurs bandes à la fois**. Alt/Option
pendant l'ajustement affiche la teinte active en couleur et tout le reste en
gris.

**Point Color** (plus récent, et plus proche de ce qu'un shader voudrait) :
un échantillon, un curseur **Variance** (à quel point les couleurs sont tirées
vers l'échantillon ou repoussées) et un curseur **Range**.

Sur Photoshop Hue/Saturation, la seule phrase mécanique qui survit à la
réécriture : les curseurs verticaux **intérieurs** définissent la plage
éditable, les curseurs triangulaires **extérieurs** appliquent une atténuation
progressive — donc un ajustement fondu et non abrupt.

**Vibrance contre Saturation, différence énoncée par Adobe** : Saturation agit
**également sur toutes les couleurs** ; Vibrance applique une **pondération
dépendante de la saturation** (les couleurs peu saturées bougent plus) et
**exclut les tons chair**. ⚠️ Adobe ne publie ni la courbe de pondération ni le
critère de ton chair.

## Color Grading

<https://helpx.adobe.com/lightroom-classic/help/image-tone-color.html>

Teinte + Saturation sur trois roues : **Hautes lumières, Tons moyens, Ombres**.
La teinte donne la couleur, la saturation la force. Les extrêmes (noir et blanc
purs) **restent neutres**.

Les deux curseurs qui font le travail réel, et qui ne disent pas la même chose
selon la page :

- **Blending** — l'ampleur du **recouvrement** entre ombres et hautes lumières.
  Vers la droite, recouvrement maximal ; vers la gauche, minimal. Donc : la
  LARGEUR et la douceur des masques tonaux.
- **Balance** — quelle extrémité l'emporte. Positif renforce les hautes
  lumières, négatif les ombres. Donc : la POSITION du croisement.

⚠️ **Adobe ne publie jamais les fonctions de masque.** Modificateurs sur les
roues : Alt/Option = ajustement fin, Maj = saturation seule, Ctrl/Cmd = teinte
seule.

## Clarity, Texture, Dehaze

<https://helpx.adobe.com/lightroom/web/edit-photos/apply-effects/adjust-effects.html>

- **Texture** — lisse ou accentue le détail texturé ; **ne change ni la couleur
  ni la tonalité**.
- **Clarity** — change le contraste **autour des bords des objets**. Camera Raw
  ajoute la seule phrase à teneur fréquentielle de tout le corpus : c'est
  « comme un masque flou de GRAND rayon », avec le plus d'effet sur les **tons
  moyens**.
- **Dehaze** — réduit ou ajoute le voile atmosphérique. Décrit par son BUT,
  jamais par une bande de fréquence. Disponible aussi en ajustement local.

⚠️ **Le découpage « Texture = haute fréquence, Clarity = moyenne, Dehaze =
modèle atmosphérique » est du savoir communautaire, PAS de la documentation
Adobe.** Adobe n'énonce un rayon que pour Clarity, et rien du tout pour Texture.

## Unsharp Mask et High Pass

<https://helpx.adobe.com/photoshop/using/filter-effects-reference.html>

**Unsharp Mask** — trois paramètres : Amount **1 à 500 %**, Radius **0,1 à
250 px**, Threshold **0 à 255** (à quel point un pixel doit différer de son
voisinage avant d'être renforcé). Mécanisme : ajuste le contraste du détail de
bord en produisant **une ligne plus claire et une plus sombre de chaque côté**
du bord.

**High Pass** — conserve le détail de bord dans le rayon spécifié et **supprime
le reste**. Un rayon de **0,1 px ne garde que les pixels de bord**. Adobe le
décrit explicitement comme **retirant le détail basse fréquence, effet opposé
au flou gaussien**. Son SEUL paramètre est le rayon — cohérent avec « image
moins son flou, décalée de gris 50 % », formule qu'Adobe n'écrit jamais.

## Bleach bypass — aucune fonction Adobe

**Aucune fonctionnalité de ce nom dans les guides Photoshop ou Lightroom.** La
prétendue entrée en profil Camera Raw est **activement démentie** (0 occurrence
de `leach` sur la page des appareils supportés). C'est une RECETTE, ce qui
confirme le verdict de `10-fonctions-complementaires.md` : un preset, pas un
effet.

⚠️ **Piège de licence, le plus important de ce document.** L'implémentation
ouverte la mieux documentée est `seriously.bleach-bypass.js` dans
`brianchirls/Seriously.js`. **Le dépôt est MIT — mais le FICHIER de shader
porte son propre en-tête, CC BY-NC-SA 3.0** (vade / Anton Marini,
<http://v002.info/?page_id=34>). Non commercial + partage à l'identique :
**lisible comme documentation, jamais copiable ni dérivable** si shaderlab est
un jour commercialisé. Une licence de dépôt ne couvre pas un fichier qui en
déclare une autre — vérifier au FICHIER, pas au dépôt.

Le mécanisme, lui, est l'analogue argentique bien connu et se décrit sans
copier : produire une copie en **luminance seule** (poids Rec. 709), puis la
mélanger en **Overlay** par-dessus l'original, la sélection de branche étant un
fondu doux plutôt qu'un test franc à 0,5. Un `amount` remélange vers
l'original. L'argent retenu EST la couche grise, et la mathématique d'Overlay
produit simultanément la désaturation et le gain de contraste.

Autres pistes ouvertes vérifiées : darktable n'a **aucun** module de ce nom
(cœur GPL-3.0) ; le seul artefact est un fichier de style communautaire
`rabauke/darktable-styles`, **sans licence — écarté**. GEGL (LGPL-3.0) : aucune
opération trouvée. G'MIC : non vérifié, grep non concluant.

## Pixel sorting

**Aucun outil de première partie chez Adobe.** Technique d'artiste.

⚠️ **L'original de Kim Asendorf, `kimasendorf/ASDFPixelSort` (2010), n'a AUCUNE
licence** — pas de fichier `LICENSE`, API GitHub à `null`. **Écarté : ni copie
ni portage.**

**La réimplémentation utilisable est `satyarth/pixelsort`, MIT** (vérifié deux
fois : API GitHub et fichier `LICENSE`). Son modèle de paramètres est la vraie
contribution de design, parce qu'il sépare des axes que l'original mélange :

1. **Fonction d'intervalle** — où les séries commencent et s'arrêtent (seuil,
   bords, aléatoire, ondes, ou une **image externe en noir et blanc**).
2. **Clé de tri** — luminosité par défaut.
3. **Angle** — 0° (horizontal) par défaut.
4. **Aléa** — pourcentage d'intervalles à NE PAS trier.

Plus deux seuils, bas et haut, sur 0–1 (à quel point un pixel doit être sombre
ou clair pour compter comme « bord »). Le README note que reproduire l'original
demande de trier **verticalement puis horizontalement**.

## Courbe par points contre courbe paramétrique — et ce sur quoi Curves opère

<https://helpx.adobe.com/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html>
· <https://helpx.adobe.com/photoshop/using/curves-adjustment.html>
· <https://helpx.adobe.com/photoshop/using/color-settings.html>

**Paramétrique** : quatre régions bornées et se recouvrant (Hautes lumières,
Clairs, Sombres, Ombres), dont les FRONTIÈRES se déplacent par des contrôles de
séparation sous le graphe. Ne peut jamais produire une forme arbitraire.
**Par points** : points de contrôle libres, avec lecture explicite Input /
Output, par canal (les trois d'un coup, ou R / V / B isolément). Les deux
s'empilent, actives simultanément.

Photoshop Curves : axe horizontal = niveaux d'ENTRÉE, vertical = niveaux de
SORTIE ; **jusqu'à 14 points de contrôle**. Pour CMJN le graphe montre des
pourcentages d'encre, pour LAB et niveaux de gris des valeurs de lumière.

### ⚠️ Le point qui intéresse directement notre ticket sur `curves`

**Adobe n'énonce NULLE PART l'encodage sur lequel Curves opère.** La page dit
seulement « niveaux d'entrée (valeurs originales) ». Il n'existe aucune phrase
Adobe disant que Curves est perçu, ni qu'il est linéaire.

Le seul contrôle de gamma documenté est *Edit > Color Settings > More Options >
**Blend RGB Colors Using Gamma*** : quand il est COCHÉ, les couleurs RGB sont
mélangées dans l'espace correspondant au gamma spécifié, et Adobe précise qu'un
gamma de **1,00 est « colorimétriquement correct » et produit le moins
d'artefacts de bord**. Quand il est DÉCOCHÉ, le mélange se fait directement dans
l'espace du document. Adobe avertit que le COCHER fait diverger le rendu des
autres applications.

**Lecture, et c'est une INFÉRENCE, pas une citation** : l'avertissement
d'interopérabilité ne fait sens que si cocher est la déviation — donc l'option
est décochée par défaut, donc la composition par défaut de Photoshop (et les
valeurs que voit un ajustement Curves) est l'espace **encodé en gamma du
document, pas la lumière linéaire**.

⚠️ **Conséquence pour nous** : le défaut de Photoshop est l'OPPOSÉ du mélange
colorimétriquement correct — et Adobe le dit en toutes lettres tout en le
laissant désactivé. À verser au dossier de
[`curves` en linéaire ou en perçu](../issues/06-curves-en-lineaire-ou-en-percu.md),
qui pesait « linéaire strict » contre « ce que fait Photoshop » sans savoir que
Photoshop lui-même qualifie son propre défaut d'incorrect.

## Content-Aware Fill contre Generative Fill

<https://helpx.adobe.com/photoshop/using/generative-ai-faqs-photoshop.html>

**Generative Fill et Generative Expand sont des appels SERVEUR, sans ambiguïté** :
Adobe écrit qu'une connexion internet est requise, et la documentation nomme des
modèles partenaires tiers. Indisponibles en Chine.

**Content-Aware Fill** est documenté sans exigence réseau et avec un mécanisme
purement intra-image (remplissage par les pixels environnants, zone
d'échantillonnage réglable). ⚠️ Adobe n'écrit jamais le mot « local » : c'est
une inférence à partir du mécanisme et de l'absence d'exigence réseau.

## Lightroom — ce que le catalogue apporte

<https://helpx.adobe.com/lightroom-classic/help/photos.html>
· <https://helpx.adobe.com/lightroom-classic/help/develop-module-options.html>

L'invariant de cadre : les modifications sont stockées comme des
**instructions**, donc rien ne se « sauvegarde » au sens traditionnel.

- **Copies virtuelles** — elles **n'existent pas** comme photos ni comme
  duplicatas : ce sont des **métadonnées du catalogue** portant un jeu de
  réglages différent. Nombre illimité, et **on peut promouvoir une copie en
  maître**, l'ancien maître devenant copie. Elles deviennent de vraies photos
  seulement à l'export ou à l'ouverture dans un éditeur externe.
- **Instantanés** — nommer et enregistrer n'importe quel ÉTAT de la photo,
  y compris un état antérieur pris dans le panneau Historique. Listés par ordre
  **alphabétique**, là où l'historique, lui, est **chronologique** et **non
  réordonnable**.
- **Synchronisation** — applique les réglages de la photo courante aux autres
  photos sélectionnées ; indisponible quand une seule photo est sélectionnée
  (le bouton Sync devient alors « Précédent »). Un mode **Auto Sync** propage
  en direct.

⚠️ **Le point le plus transposable à notre modèle de presets** : Adobe partage
**un seul sous-ensemble « quels paramètres voyagent »** entre copier, coller,
synchroniser, synchroniser les instantanés, et créer ou mettre à jour un
preset. Une case décochée dans le dialogue Copier l'est aussi par défaut dans
le dialogue Synchroniser. Un seul contrat, cinq gestes.

## Ce qui reste NON VÉRIFIÉ — à ne pas citer comme acquis

| Affirmation | Statut |
| --- | --- |
| Les huit bandes HSL nommées (Rouge…Magenta) de Lightroom | absentes du corps des pages lues |
| Les quatre valeurs 0–360 de Hue/Saturation Photoshop | retirées des docs live par la réécriture de février 2026 |
| Une quatrième roue « Global » dans Color Grading | aucun texte Adobe sur les deux pages lues |
| « Color Grading remplace Split Toning » | aucune phrase de ce type trouvée |
| Texture / Clarity / Dehaze mappés à des bandes de fréquence | Adobe n'énonce un grand rayon que pour Clarity |
| La phrase mécanique classique d'Unsharp Mask | retirée des docs live |
| Content-Aware Fill est un algorithme local | inférence, pas citation |
| L'encodage sur lequel opère Curves | Adobe ne l'énonce jamais |
| Un filtre bleach-bypass dans G'MIC | grep non concluant |
| Une opération bleach-bypass dans GEGL | non trouvée |
| « Bleach Bypass » comme profil d'appareil ACR | **activement démenti — 0 occurrence** |

## Appel de licences

| Ressource | Licence | Verdict |
| --- | --- | --- |
| `satyarth/pixelsort` | **MIT** (fichier + API) | **utilisable** |
| `kimasendorf/ASDFPixelSort` | **aucune** (API `null`, pas de `LICENSE`) | **écarté** |
| `brianchirls/Seriously.js` (dépôt) | MIT | utilisable en général |
| `seriously.bleach-bypass.js` (fichier) | **CC BY-NC-SA 3.0** par son propre en-tête | **écarté à la copie** — référence en lecture seule |
| `rabauke/darktable-styles` | **aucune** (API `null`) | **écarté** |
| darktable (cœur) | GPL-3.0 | copyleft — référence seulement |
| `darktable-org/dtdocs` (manuel) | GPL-3.0 | citable |
| GEGL | LGPL-3.0 | référence |
