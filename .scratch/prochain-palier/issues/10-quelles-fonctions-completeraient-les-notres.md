# Quelles fonctions de Photoshop et Lightroom compléteraient les nôtres

Type: research
Status: resolved
Parent: ../map.md

## Question

Le mot du titre qui compte est **compléteraient**. shaderlab n'a pas vocation à
refaire Photoshop — il a 23 effets, un modèle de calques, des masques et des
presets, et une barre de qualité explicite (« pas de rendu filtre Photoshop
2005 »). La question n'est pas « que leur manque-t-il chez nous », c'est :
**quelle fonction, adjacente à ce que nous avons déjà, débloquerait des usages
que notre pile ne sait pas exécuter aujourd'hui ?**

## L'état réel, à tenir en tête avant de proposer quoi que ce soit

Mesuré sur disque le 2026-08-11 :

- **23 effets** au registre, en six catégories éditoriales
  (`effects/catalog.ts`), plus trois contrôles TRANSVERSAUX adoptables par
  n'importe quel effet : espace de mélange (`blendSpace` — sRGB / Linéaire /
  OKLab / OKLCH), mode d'entrée (`inputMode` — Luminance / Luminance inversée /
  Alpha) et texture d'encre (`inkTexture`).
- **Masques** : pinceau + trois sources paramétriques (`gradient`,
  `luminosity`, `colorRange`), combinables en add/subtract/intersect, avec
  refine edge (adoucir, contracter/dilater, lisser) et un filtre guidé
  edge-aware.
- **Calques** : opacité et mode de fusion par calque, écrêtage, réordonnancement
  par glisser-déposer, deux photos maximum, transform à poignées.
- **Presets** : capture/application d'une pile, export/import JSON, détection
  de dérive.
- **Contrôles posés sur la toile** : `CanvasControl` en point / disque / axe,
  plus le gabarit de section `pose`.
- **Absents** : recadrage, formes, typographie, export print 16-bit, et les
  cinq différés de sélection du PRD masquage (depth mask, segmentation
  sémantique, pen/path Bézier, rect/ellipse, lasso).

## La règle qui décide, et elle est stricte

**Le doublon se MESURE avant de s'écrire.** Elle a coûté assez cher ici pour
ne pas être réapprise : cinq effets sont sortis du registre en une journée
(2026-08-03) parce qu'ils doublonnaient, et chaque retrait a été prouvé à
l'octet avant d'être fait. Pour toute fonction proposée, dire explicitement
**ce qu'elle fait que notre pile actuelle ne sait pas produire** — et si la
réponse est « rien, c'est plus commode », le dire aussi, c'est un résultat.

Corollaire du cahier de postproduction, point 4 : **ce qui ne se crée pas en
postproduction doit être DIT et non simulé** — téléobjectif compressé, lumière
latérale dure, reflets spéculaires. Une fonction qui prétendrait les créer
rendrait exactement le « filtre Photoshop 2005 » que ce dépôt proscrit.

## Pistes déjà nommées dans le dépôt, à instruire en priorité

Elles ne sont pas des réponses — ce sont des questions que quelqu'un a déjà
écrites et que personne n'a rouvertes :

- **Étage color grade** — courbe + bleach bypass + split-tone, cité comme
  différé dans `PRD-print-export.md`. `curves` est livré depuis le
  2026-08-04 ; bleach bypass et split-tone, non.
- **Groupes de calques** — la tranche 5 du design de masquage (conteneur avec
  opacité/blend/masque propres sur le résultat aplati des enfants). Jamais
  exécutée.
- **Les recettes du cahier de postproduction** — 666 lignes dictées par
  Antoine. Son point 1 dit que beaucoup sont des PILES et non des effets :
  « la question n'est pas quel effet écrire mais qu'est-ce qui manque à la
  pile ». Instruire dans ce sens-là.
- **Ce que Lightroom fait et que Photoshop ne fait pas** — le catalogue, les
  copies virtuelles, la synchronisation de réglages entre photos. Nous avons
  les presets, pas le reste. Est-ce que ça a un sens pour un éditeur qui
  travaille une image à la fois ?

## Pièges de méthode

- **WebFetch hallucine sur les grandes tables de référence** — passer par une
  lecture de contenu brut pour toute liste exhaustive.
- **Vérifier la licence de toute ressource citée.** `webgpu-image-filter` n'en
  a AUCUNE et a été écarté pour ça : inspiration seulement, jamais de copie.
- **Une référence générale dit ce qu'une fonction PEUT être ; l'usage réel
  d'Antoine dit ce qu'elle DOIT être.** Trois passes de raffinement de
  `lensFlare` ont été perdues pour l'avoir oublié.

## Livrable

Un Markdown cité dans `.scratch/prochain-palier/research/`. Pour chaque
fonction : ce qu'elle fait, **ce que notre pile ne sait pas produire sans
elle**, ce qu'elle coûterait vu notre architecture, et son verdict de doublon.
Classé par rapport valeur/coût, pas par ordre de découverte. **Il n'arbitre
rien.**

## Answer

Résolu le 2026-08-11. Findings :
[`research/10-fonctions-complementaires.md`](../research/10-fonctions-complementaires.md)
— **12 fonctions instruites**, classées par valeur/coût, chacune avec son
verdict de doublon cité.

**Retenues, avec ce que la pile ne sait PAS produire** :

1. **Les quatre modes de fusion NON séparables** (Couleur, Luminosité, Teinte,
   Saturation). Nos modes sont tous des fonctions canal par canal
   (`blend/modes.ts` : `normal`, `multiply`, `screen`, `add`, `darken`,
   `lighten`, `overlay`…), donc **aucun ne peut préserver la luminance en
   changeant la chroma** — c'est prouvable par la FORME de l'opérateur, pas
   par un essai. Coût le plus bas du document : l'interface est déjà
   `vec3→vec3`, et `blendMode` est une **chaîne** (`types.ts:58`), donc zéro
   index de preset déplacé. Le split-tone différé depuis le 2026-07-20 se
   résout là, sans nouvel effet.
2. **Netteté / contraste local.** Absent du registre et DOUBLEMENT bloqué :
   aucun mode de fusion signé (ni Différence ni Soustraction), et un effet ne
   peut lire aucun autre calque. C'est le mot le plus répété du cahier
   d'Antoine — **neuf mentions, zéro effet**.
3. **Carte de déplacement pilotée par une image.** `warp` et `glass` déplacent
   par champ procédural ; `texture` lit une image mais sort le scan brut. Le
   binding 7 d'ADR-0018 rend le coût bas.
4. **Courbe libre / solarisation.** Le shader l'évalue DÉJÀ — c'est
   `constrainCurvePoint` (côté interface) qui l'interdit.
5. **Masque mesuré sur le composite en dessous** (façon Blend If). Nos sources
   sont ancrées sur la photo ORIGINALE, par décision écrite.

Plus cher, retenu mais loin : groupes de calques (~96 Mo/niveau, `LayerState`
plat à passer en arbre), déformation peinte, pixel sorting.

**Écartées comme doublons ou pure commodité** (huit) : bloom = `glow` en
Écran ; dodge & burn = `curves` + masque pinceau ; **bleach bypass = deux
calques existants, donc un PRESET et non un effet** ; saturation et virage de
teinte globaux = déjà atteignables par la matrice de `channelMixer` (seule la
vibrance, non linéaire, ne l'est pas) ; halation, aberration, grain, motion
blur, gradient map sont au registre.

**Rejetées sur la règle d'Antoine** — ce qui ne se crée pas en postproduction
doit être DIT et non simulé : téléobjectif compressé, lumière latérale dure,
reflets spéculaires, plus remplissage génératif et relighting.

### Deux dérives trouvées en chemin, vérifiées indépendamment

- **`MAX_PHOTO_LAYERS` vaut 5** (`src/layers/photoLayer.ts:66`) contre **4**
  dans `CONTEXT.md:259`, `ARCHITECTURE.md:565` et `ARCHITECTURE.md:615`. Le
  risque VRAM R1 d'`ARCHITECTURE.md` est donc chiffré sur le mauvais plafond.
- **La moitié RADIALE du dégradé de masque n'a jamais été livrée.** Le PRD la
  donnait en vague 1 (`2026-07-18-shaderlab-layers-masking-prd.md:76` :
  « Dégradé linéaire/radial ») ; `src/mask/sources/gradient.ts` s'annonce
  « Dégradé linéaire » et ne porte aucun radial. Aucun document ne le
  signalait. Reversé dans
  [Lesquels des cinq différés de masquage entrent dans ce palier](08-lesquels-des-cinq-differes-de-masquage.md).

Suite : [Quelles fonctions retenir, et dans quel ordre](12-quelles-fonctions-retenir.md).
