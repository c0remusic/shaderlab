# Le brevet B220 décrit l'opérateur : trois courbes par canal, en primaires ProPhoto

Mesuré le 2026-09-23, sans aucune mesure Lightroom neuve. **Aucun changement dans
`src/`.** Ce document change la FORME du modèle de Color Grading, pas ses
constantes : notre twin ajoute une chroma en OKLab à L constant, pilotée par le L
du pixel ; Lightroom applique **trois courbes 1D, une par canal, en primaires
ProPhoto**, et la luminance du pixel n'intervient nulle part.

Cinq questions ont été explorées en parallèle, chacune passée devant un réfuteur
tenu de relancer les scripts : **aucune n'est tombée**, une est établie, quatre
sont partielles et disent précisément ce qui leur manque.

## 1. Le brevet, qu'on n'avait jamais lu

research/17 avait trouvé en clair dans `CameraRaw.dll`, à côté de
`cr_stage_SplitTone`, « Adobe patent application tracking # B220, 'Color toning
while maintaining constant luminance while using color curve slopes', Mark
Hamburg ». Trois notes l'ont cité comme « la source la plus directe ». **Personne
ne l'avait cherché.** Une recherche sur le titre rend
[US 7 830 548 B2](https://patents.google.com/patent/US7830548B2/en), « Method and
apparatus for generating color toning curves ». Il décrit l'opérateur entier :

- trois courbes **par canal**, R(x), G(x), B(x), appliquées canal par canal —
  R(r), G(g), B(b) — sur une image en couleur (sa FIG. 1B) ;
- noir → noir, blanc → blanc, exactement ;
- la teinte des ombres est portée par les **pentes en 0** : par l'Hospital, la
  teinte de la courbe quand x → 0 est la teinte HSL du vecteur des pentes ; celle
  des hautes lumières par les **pentes en 1**, ordre inversé (teinte h + 180) ;
- une **invariance** fournit la troisième équation : lumière HSL (min + max)/2,
  ou luminance pondérée ;
- une cubique d'Hermite par canal entre les deux bouts, qui conserve exactement
  une invariance linéaire ; pentes bornées à une plage « valide », ou saturation
  réduite.

Le brevet ne connaît que les ombres et les hautes lumières. Les tons moyens, la
roue globale, la Fusion et la Balance sont des extensions du Color Grading
moderne.

⚠️ **Statut juridique.** Google Patents le donne **actif jusqu'au 2027-04-11**
(statut indicatif, pas une analyse juridique). Appliquer des courbes par canal
est une technique ancienne ; ce que le brevet REVENDIQUE est la construction des
pentes par limite de teinte et invariance. Étudier et mesurer ne pose rien ;
implémenter cette construction dans `src/` avant cette date est une décision
d'Antoine, à éclairer par un juriste si shaderlab devient distribuable.

Texte intégral extrait (hors dépôt) : scratchpad de session, `us7830548.txt`.

## 2. Le fait qui décide : canal par canal (établi)

`assets/brevet-e5-canal-par-canal.mjs`. Test **sans modèle** : lire sur la rampe
grise les trois courbes de sortie en ProPhoto, puis prédire les balayages colorés
et les patches en appliquant à chaque canal ProPhoto de l'entrée la courbe de ce
canal. Relancé par la session principale :

| scène | canal par canal | twin OKLab (en service) | piloté par la luminance |
|---|---|---|---|
| `st-h000` | **0,551** | 20,8 | 8,5 |
| `st-h220` | **0,471** | 14,9 | 8,2 |
| `st-h300` | **0,465** | 21,4 | 7,1 |
| `st-ombres-bleu` | **0,519** | 4,6 | 2,5 |
| `st-hl-orange` | **0,472** | 8,8 | 11,2 |
| `st-duo` | **0,435** | 9,8 | 13,4 |
| `cg-glob-h040` | **0,530** | 23,0 | 9,3 |
| `grading-moyens-vert` | **0,478** | 11,8 | 9,6 |

Niveaux sRGB, moyenne par canal. **Au plancher 8 bits sur les huit, roue des tons
moyens comprise ; notre twin rate d'un facteur 10 à 46** (46,4 au pire canal).
Contrôles à réponse connue dans les deux sens : une scène fabriquée canal par
canal rend 0,000 au test et 8,45 à l'alternative ; une scène fabriquée pilotée
par la luminance rend 0,000 à l'alternative et 5,19 au test.

Le réfuteur a précisé la portée, et elle compte : le test épingle les
**PRIMAIRES** (ProPhoto 0,489, sRGB 8,042 — ×16), **pas le transfert** — ProPhoto
gamma 1,8 rend le même 0,489, parce qu'un transfert par canal s'absorbe dans une
courbe lue puis réappliquée. Et il tient à haute saturation (497 échantillons sur
528 avec un écart d'au moins 0,10).

**Conséquence.** L'erreur de notre twin sur une image en couleur est
STRUCTURELLE. Aucun réglage de `chromaK`, de poids de plage ou de direction de
teinte ne la retire : il faut changer d'opérateur.

## 3. Direction et invariance

Trois tests sans paramètre libre, contrôlés sur rampes fabriquées
(`brevet-invariant.mjs`, `brevet-directions.mjs`, `brevet-poids-invariance.mjs`) :

- **La direction chromatique est le motif HSL de ProPhoto** : 1,80° d'écart moyen
  sur onze teintes une fois la composante grise retirée (0,1° à h000, h060, h300),
  contre 10,2° en motif sRGB. C'est research/22 §1 retrouvé par une autre voie, et
  il dit maintenant POURQUOI ProPhoto gagnait : la teinte est définie sur les
  pentes des courbes, dans l'espace où elles s'appliquent.
- **La luminance conservée dépend de la roue.** Roues des ombres et des hautes
  lumières : Y ProPhoto sur huit teintes sur onze (0,13 à 0,3 niveau équivalent).
  Roue globale : **lumière HSL** en primaires ProPhoto (0,54 à 0,64) — Y et L
  OKLab y ratent de 5 à 6 niveaux.
- **Les jaunes cassent l'invariance, et le mécanisme reste ouvert** (question E1,
  partielle). Lightroom les éclaircit : dY/Y = +25,0 % au niveau 128 de `st-h060`,
  là où les trois canaux sont lisibles, +38,4 % au niveau 32, et le réfuteur l'a
  reproduit sans ajustement. Or sous Y ProPhoto le canal minimal du jaune est le
  bleu, de poids 0,0001 : la pente des deux autres canaux y est ÉPINGLÉE à 1,000
  quelle que soit la saturation, donc **Y ProPhoto ne peut pas éclaircir un
  jaune**. Aucune grandeur unique testée — Y ProPhoto, Rec.709, Rec.601, poids
  ajustés, lumière HSL, L OKLab — ne tient les onze teintes ; la meilleure sur la
  métrique qui décide est L OKLab (1,572 contre 2,257 à Y ProPhoto), mais elle
  gagne en resserrant les autres teintes, pas en expliquant le jaune.

## 4. Roue par roue

**Globale — c'est le brevet** (E4, confiance haute). Cubique d'Hermite par canal,
pente en 0 de teinte h, pente en 1 de teinte h + 180, invariance lumière HSL : à
**un seul degré de liberté** (la saturation-limite) elle rend **1,07 et 1,09
niveau** sur `cg-glob-h040` et `-h220`, contre **20,4 et 14,0** pour notre twin.
Ajustée librement (six pentes) : 0,35–0,38, le plancher. Pentes ajustées : teintes
35/224 pour 40/220 demandés, soit ~5° de rotation. La saturation-limite vaut
**~0,33 à sat 60**, pas 0,60. Le codage n'est pas départagé (linéaire
marginalement préféré, indistinguable de la TRC sRGB).

**Ombres — le brevet, approximativement** (E2, E3). Cubique libre 2,15 niveaux,
modèle contraint du brevet 2,94 : ~7 à 10 fois le plancher, résidu systématique.
La saturation du curseur n'est pas la saturation-limite : **S = 0,21 / 0,51 / 0,80
pour sat 20 / 60 / 100** (robuste sur trois codages ; l'estimateur retrouve 0,600
et 0,998 sur des rampes fabriquées écrêtées). Et le **R = 0 à l'export** de
`st-ombres-sat100` que research/22 §5 signalait est expliqué : la courbe R reste
dans [0, 1] en ProPhoto, mais la conversion ProPhoto → sRGB la rend négative, et
l'export l'écrête (accord 218 niveaux sur 254 à S = 0,80). Ce n'est pas un
écrêtage « par canal » de Lightroom opposé à notre `clipGamut` : c'est la sortie
hors gamut sRGB d'une opération faite en ProPhoto.

**Hautes lumières — une cubique clouée** : 1,07 niveau, sommet de chroma au niveau
204, direction à 1,5° de l'orange demandé.

**Balance — la carte homographique, sur l'abscisse sRGB encodée** (E3). Le
croisement du duo suit c = 127,6 − 1,020 · balance (R² = 1,0000), et
`balanceMapAlpha` = (255 − c)/c vaut **0,114 / 0,425 / 0,992 / 2,316 / 9,200** pour
Balance −100 / −50 / 0 / +50 / +100. Le binaire nomme ce champ comme le `a` de
`cr_div_map` ; un contrôle en abscisse linéaire croise au niveau 188, la mesure au
128. ⚠️ **Terme dominant, pas explication complète** : le remap divise l'écart par
deux et laisse 11 à 12 niveaux aux balances extrêmes.

**Fusion — convexe et élargissante** : largeur à mi-hauteur 79 → 102 niveaux. Les
extrêmes ne sont pas exactement fixes côté hautes (rapport 1,07 au niveau 220,
1,09 au 240). Sa loi n'est pas épinglée ; le point à 50 vient d'une autre
campagne.

**Tons moyens — pas le brevet, notre mécanisme** (E4). Chroma de signe UNIQUE sur
toute la rampe, alors qu'une construction par pentes impose un changement de
signe (au niveau 64, le nœud prédit −14,9 quand la mesure rend +16). C'est une
cloche de chroma — ce que fait notre twin : 2,62 niveaux en codage TRC sRGB contre
3,93 au twin. **Mais elle s'applique canal par canal elle aussi** (0,478 au §2).

## 5. Ce que ça corrige dans les notes précédentes

- **Les « quatre cloches » de research/19 ne sont pas une famille de formes
  inconnue** : une courbe clouée au noir et au blanc a une chroma nulle aux deux
  bouts, donc un profil en cloche par construction. Le défaut n° 1 du ROADMAP (« le
  poids des hautes lumières est non monotone ») est ce clouage.
- **« L'angle dépend de L » (research/22 §4)** est ce qu'on voit depuis OKLab d'un
  virage fait en ProPhoto par des courbes par canal. Rien d'« autre » n'agissait.
- **« L'addition en ProPhoto est réfutée, 7,11 » (research/22 §1)** testait un ajout
  à composante grise égale par canal, pas des courbes à luminance conservée. La
  réfutation vaut pour ce modèle-là, pas pour l'espace.
- **« La direction ProPhoto n'est pas définie pour six teintes »** : la question
  était mal posée une seconde fois. La teinte n'est pas une direction OKLab, c'est
  un rapport de pentes ProPhoto, défini à toute saturation.

## 6. Ce qui reste ouvert, et les mesures qui trancheraient

1. **Le mécanisme des jaunes.** Exporter une rampe virée jaune (ombres h060 sat 60
   et 100) en espace large non écrêté — TIFF ProPhoto — pour lire la pente bleue
   réelle au noir, aujourd'hui clouée à 0 par l'export sRGB.
2. **Chaque roue seule à Balance 0** (ombres, moyens, hautes) pour lire son alpha
   de plage directement.
3. **La Fusion à doses fines**, 0 à 100 par 10, sur une seule campagne.
4. **La loi S(sat) de la roue globale** : un seul point aujourd'hui.

## 7. Ce qui n'est pas posé, et pourquoi

**Rien dans `src/`, et les quatre références `developpement-grading-*` sont
intactes.** La structure est établie ; sa construction ne l'est qu'en partie :
globale à 1 niveau, ombres à ~3, balance à moitié, jaunes inexpliqués. Et le
brevet est actif.

La forme d'implémentation qui découle de ce document est **indépendante du
brevet** et vaut quelle que soit la construction retenue : trois tables 1D
calculées sur le CPU à partir des réglages, appliquées canal par canal en
primaires ProPhoto dans le shader (une matrice, trois lectures de table, une
matrice), la sortie hors gamut sRGB écrêtée comme à l'export. C'est la première
fois que ce module a une forme dont l'application est prouvée au plancher.

## Scripts

Session principale : `brevet-commun.mjs` (instrument partagé, contrôles à
l'import), `brevet-invariant.mjs`, `brevet-invariant-profil.mjs`,
`brevet-courbes.mjs`, `brevet-separable.mjs`, `brevet-directions.mjs`,
`brevet-poids-invariance.mjs`. Explorateurs et réfuteurs : `brevet-e1-*` (jaunes),
`brevet-e2-*` (amplitude), `brevet-e3-*` (profil, balance, fusion), `brevet-e4-*`
(globale, moyens), `brevet-e5-*` (canal par canal). ⚠️ Le bloc de reconstruction
final de `brevet-e3-balance.mjs` est cassé (code mort, sortie non informative) :
le chiffre de balance se lit dans `brevet-e3-modele.mjs`.
