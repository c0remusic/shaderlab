# Cahier de références — postproduction éditoriale

> Dicté par Antoine le 2026-08-03. **Matière première, pas un plan.** Aucun
> découpage en effets n'est décidé ici : le tri (ce que shaderlab porte déjà,
> ce qui manque, ce qui n'a aucun sens sans prise de vue) est le premier
> travail du chantier, et il se fera contre le registre réel.
>
> Second cahier du dépôt, après `2026-08-01-references-effets.md` (celui de
> Figma, épuisé, qui a produit six effets). Celui-ci est d'une autre nature :
> il décrit des **workflows Photoshop/Lightroom**, pas des filtres. Beaucoup
> de ses recettes sont des empilements de calques, de masques et de courbes —
> c'est-à-dire de ce que shaderlab fait déjà par sa pile, pas de ce qu'un
> nouvel effet ferait.
>
> ⚠️ Sa phrase la plus importante est en tête et n'est pas une note de style :
> **certains effets doivent exister dès la prise de vue.** La postproduction
> les renforce, elle ne les crée pas de façon crédible. Un effet du registre
> qui prétend créer un contre-jour brûlé à partir d'une image plate ment.

Chantier frère annoncé le même jour : **simplifier et compléter l'UI**,
notamment la gestion des paramètres avec des outils dédiés — sur le modèle de
la source POSÉE de `lensFlare` (un objet manipulé sur la toile plutôt que
quatre curseurs). Les deux chantiers se tiennent : plusieurs recettes
ci-dessous demandent un point, une zone ou une direction posés sur l'image,
pas des nombres.

---

Le workflow typique :

```
développement RAW → color grading → retouches locales → dégradation contrôlée
→ montage graphique → préparation print/digital
```

---

## 1. Lumière

### Flash frontal direct

À la prise de vue : flash proche de l'axe de l'objectif.

En postproduction :
- augmenter légèrement les hautes lumières sur la peau ;
- accentuer les reflets sur le front, le nez, les lèvres ou les matières brillantes ;
- renforcer les ombres portées avec une courbe locale ;
- diminuer légèrement la dynamique de l'arrière-plan ;
- utiliser une netteté assez dure, avec peu de réduction de texture ;
- ajouter éventuellement un léger vignettage inversé autour du sujet.

Dans Photoshop, on peut créer deux courbes :
- une courbe claire masquée sur les zones brillantes ;
- une courbe sombre sur les contours et les ombres derrière le sujet.

Il faut éviter le dodge and burn trop propre : le rendu doit rester un peu abrupt.

### Lumière latérale dure

Idéalement obtenue au shooting. En postproduction :
- courbe en S assez forte ;
- assombrissement sélectif du côté opposé à la source ;
- augmentation du contraste local sur le visage, les vêtements ou l'objet ;
- léger refroidissement des ombres et réchauffement des hautes lumières ;
- dodge and burn large, avec un pinceau très doux ;
- fond simplifié ou assombri pour accentuer la silhouette.

Pour un aspect magazine, on peut aussi écraser légèrement les détails dans les
ombres plutôt que chercher à tout récupérer.

### Contre-jour brûlé

En postproduction :
- relever fortement les blancs ;
- diminuer la récupération des hautes lumières ;
- ajouter un masque radial clair près de la source ;
- réduire localement le contraste ;
- ajouter du bloom autour des zones lumineuses ;
- réchauffer les blancs avec une dominante jaune, orange ou rosée ;
- relever légèrement les noirs pour éviter un contraste HDR.

Le bloom se crée avec une copie du calque :
1. duplication ;
2. flou gaussien ;
3. mode de fusion Écran ou Addition ;
4. masque limité aux hautes lumières ;
5. opacité faible.

### Éclairage coloré

Même avec des gels réels, le rendu est généralement poussé en postproduction.

Méthodes :
- Color Grading dans Lightroom ou Camera Raw ;
- courbes séparées rouge, vert et bleu ;
- calques Couleur unie en modes `Color`, `Soft Light` ou `Screen` ;
- masques distincts pour les ombres, les tons moyens et les lumières ;
- dégradés colorés localisés, plutôt qu'une dominante uniforme.

Exemple : ombres cyan ; tons moyens neutres ; hautes lumières rouges ou orangées.

Pour un résultat moderne, les couleurs ne doivent pas nécessairement respecter
une balance des blancs réaliste.

### Reflets spéculaires très marqués

Ils doivent être photographiés, mais peuvent être renforcés par :
- courbes très claires masquées sur les reflets ;
- augmentation locale des blancs ;
- contraste et clarté uniquement sur le métal, le verre ou le plastique ;
- légère désaturation des reflets les plus blancs ;
- assombrissement autour des points brillants ;
- bloom très faible pour les matières humides ou cosmétiques.

On peut aussi redessiner certains reflets avec un pinceau blanc très doux, mais
cela devient rapidement artificiel.

## 2. Optique et prise de vue

### Flou de mouvement

Pour le recréer ou l'amplifier :
- détourage approximatif du sujet ;
- duplication ;
- filtre Motion Blur ;
- masque permettant de conserver certaines zones nettes ;
- étirement directionnel de morceaux de cheveux, vêtements ou arrière-plan ;
- légère baisse d'opacité ;
- parfois plusieurs flous avec des directions différentes.

Un effet plus crédible conserve généralement : les yeux ou un détail du produit
nets ; certaines extrémités floues ; des contours irréguliers.

Un flou uniforme appliqué sur toute l'image ressemble davantage à une erreur
qu'à une direction artistique.

### Vitesse lente avec flash

Le résultat doit normalement être produit à la prise de vue. Pour le simuler :
1. conserver un sujet net ;
2. créer une ou plusieurs copies légèrement déplacées ;
3. appliquer un flou directionnel aux copies ;
4. réduire leur opacité ;
5. utiliser les modes `Screen`, `Lighten` ou `Normal` ;
6. masquer les parties qui doivent rester figées ;
7. ajouter parfois une dominante colorée aux traces.

Le sujet central peut rester net tandis que les fantômes deviennent rouges,
bleus ou jaunes.

### Grand-angle très proche

Pour accentuer en postproduction :
- correction de perspective volontairement incomplète ;
- filtre Lens Correction ou Adaptive Wide Angle ;
- légère déformation manuelle avec `Warp` ;
- agrandissement local des mains, pieds, visage ou produit ;
- recadrage très proche des bords ;
- accentuation plus forte au centre que sur les extrémités.

La déformation doit suivre une logique optique. Agrandir uniquement une main
sans modifier les volumes voisins paraît rapidement faux.

### Téléobjectif compressé

Il est difficile de créer une vraie compression optique après coup. On peut
seulement en imiter certains aspects :
- recadrage serré ;
- aplatissement de la perspective ;
- diminution de la profondeur atmosphérique ;
- suppression ou floutage de plans intermédiaires ;
- uniformisation de la netteté ;
- fond légèrement agrandi ou rapproché par compositing.

C'est un effet à prévoir principalement au shooting.

### Profondeur de champ très courte

En postproduction :
- création d'une carte de profondeur ou d'un masque progressif ;
- `Lens Blur` plutôt que `Gaussian Blur` ;
- conservation de transitions naturelles autour des cheveux et objets ;
- ajout de bokeh uniquement dans les hautes lumières ;
- légère perte de contraste dans le fond ;
- parfois une petite aberration chromatique dans les zones floues.

Le détourage trop net détruit immédiatement l'illusion.

### Mise au point volontairement imparfaite

Méthodes :
- léger flou optique global ;
- netteté appliquée uniquement sur quelques zones ;
- réduction de texture ;
- ajout de grain après le flou ;
- décalage subtil entre les couches rouge, verte et bleue ;
- masque de flou irrégulier.

L'image ne doit pas sembler simplement basse résolution. Il faut conserver une
structure photographique dans le flou.

### Angles inhabituels et cadrages coupés

En postproduction, cela se traduit surtout par le recadrage :
- visage ou produit coupé par le bord ;
- horizon incliné ;
- espace négatif déséquilibré ;
- sujet placé très haut ou très bas ;
- rotation légère, souvent entre 1 et 8 degrés ;
- correction de perspective volontairement évitée ;
- déplacement du sujet dans un canvas plus large.

La composition peut sembler accidentelle, mais les zones réservées au texte
restent généralement très contrôlées.

## 3. Texture d'image

### Grain argentique

Workflow crédible :
1. faire d'abord la colorimétrie ;
2. redimensionner l'image à sa taille finale ;
3. ajouter le grain en dernier ;
4. utiliser plusieurs tailles de grain ;
5. en mettre davantage dans les tons moyens et les ombres ;
6. éviter un grain identique sur toute l'image.

Dans Photoshop : calque gris 50 % ; bruit monochromatique ; léger flou ; mode
`Overlay` ou `Soft Light`.

Un scan réel de film ou de papier donne souvent un résultat plus naturel qu'un
preset.

### Bruit numérique assumé

Différent du grain film :
- bruit coloré dans les ombres ;
- compression visible ;
- netteté numérique ;
- banding ou micro-artefacts ;
- légère réduction de résolution ;
- réagrandissement avec interpolation dure.

C'est pertinent pour un rendu webcam, téléphone, DV ou image internet archivée.

### Halation

La halation est surtout rouge-orangée autour des hautes lumières.

Méthode :
1. isoler les hautes lumières ;
2. les dupliquer ;
3. agrandir légèrement leur masque ;
4. ajouter un flou ;
5. colorer le halo en rouge, orange ou magenta ;
6. placer le calque sous un bloom blanc ;
7. conserver une intensité faible.

La halation doit apparaître autour des lumières, pas uniformément sur les
contours du sujet.

### Bloom

Plus large et plus neutre que la halation.
- sélection des hautes lumières ;
- flou gaussien important ;
- mode `Screen` ;
- opacité réduite ;
- masque pour éviter que toute l'image devienne laiteuse.

Le bloom peut aussi être ajouté autour de surfaces blanches, fenêtres et
reflets métalliques.

### Noirs relevés

Avec une courbe :
- remonter le point noir ;
- contrôler les tons moyens pour éviter une image plate ;
- ajouter une légère dominante dans les noirs ;
- réduire parfois la saturation dans les ombres.

Le noir peut devenir : brun chaud ; vert sombre ; bleu gris ; violet très discret.

### Couleurs désaturées avec dominante

Méthode fréquente :
- désaturation globale modérée ;
- saturation sélective d'une ou deux couleurs de marque ;
- courbes RGB pour introduire une dominante ;
- calibration des primaires ;
- uniformisation des carnations ;
- couleur de remplissage en mode `Color` à faible opacité.

Exemple : image globalement froide, mais rouge de marque conservé à pleine
saturation.

### Contraste dur et blancs brûlés

- courbe en S ;
- seuil de blancs poussé ;
- ombres légèrement bouchées ;
- texture et clarté locales ;
- réduction de détail dans les zones les plus claires ;
- saturation parfois réduite pour éviter un rendu vidéo.

Pour un aspect éditorial imprimé, on peut brûler une partie des détails au lieu
de conserver une plage dynamique parfaite.

### Chromatic aberration

En Photoshop :
1. séparer les canaux RGB ;
2. déplacer légèrement le rouge et le bleu ;
3. appliquer principalement sur les contours ;
4. limiter l'effet aux bords de l'image ou aux zones en mouvement ;
5. parfois ajouter un très léger flou.

Un décalage d'un à trois pixels suffit généralement.

### Poussières, rayures et light leaks

Approche moderne :
- scans réels de poussières, papier ou négatifs ;
- modes `Screen`, `Multiply` ou `Soft Light` ;
- contraste ajusté avec `Levels` ;
- masques irréguliers ;
- rotation et redimensionnement différents sur chaque image ;
- jamais le même overlay répété sur toute une campagne.

Pour les light leaks : dégradés rouge, orange ou jaune ; flou important ; mode
`Screen` ; position au bord du cadre ; parfois une légère surexposition de la
photo en dessous.

## 4. Effets de matière

### Photo à travers du verre ou plastique

Pour l'accentuer :
- overlay de reflets photographiés ;
- distorsion de certaines zones ;
- baisse de contraste localisée ;
- flou irrégulier ;
- séparation chromatique ;
- zones laiteuses ;
- dédoublement léger du sujet ;
- ajout de poussières ou traces de doigts.

Le meilleur résultat vient d'un véritable élément photographié devant l'objectif.

### Reflets de miroir et multiplication

En montage :
- duplication du sujet ;
- miroir horizontal ou vertical ;
- perspective modifiée ;
- masques géométriques ;
- différences d'exposition entre chaque reflet ;
- léger flou ou dominante différente ;
- joints ou bords de miroir visibles.

La répétition parfaite paraît numérique. Les variations de luminosité et de
cadrage donnent une sensation physique.

### Prismes et diffraction

En postproduction :
- fragments de l'image dupliqués ;
- déplacements et rotations ;
- masques triangulaires ;
- dispersion RGB ;
- petits arcs-en-ciel ;
- reflets en mode `Screen` ;
- flous localisés.

L'effet doit interrompre l'image et non simplement être placé comme un filtre
coloré au-dessus.

### Projection de motifs ou typographie

Projection réelle : retouche du contraste ; correction locale de couleur ;
conservation des déformations dues au corps ou à l'objet.

Projection simulée :
- typographie transformée avec `Warp` ou `Displacement Map` ;
- mode `Multiply`, `Screen` ou `Overlay` ;
- masque utilisant les ombres et volumes du sujet ;
- léger flou ;
- déformation suivant les plis et courbes ;
- variation d'intensité selon la lumière.

Une displacement map créée à partir de la photo aide le texte à suivre les volumes.

### Ombres graphiques

En compositing :
- formes vectorielles noires ;
- transformation perspective ;
- léger ou aucun flou ;
- mode `Multiply` ;
- variation d'opacité ;
- masque suivant les volumes du corps ou de l'objet ;
- parfois une dominante colorée dans l'ombre.

Les ombres peuvent devenir presque abstraites, mais leur orientation doit rester
cohérente avec la source lumineuse.

### Condensation, vapeur, fumée et eau

On utilise généralement des éléments photographiques détourés :
- fumée en mode `Screen` ;
- condensation ou gouttes avec relief et masque ;
- buée via un calque blanc flou ;
- perte de contraste derrière la vapeur ;
- déformation de l'image derrière les gouttes ;
- netteté renforcée sur les gouttes au premier plan.

Pour une vitre humide crédible, il faut combiner : gouttes nettes ;
arrière-plan flou ; distorsion ; reflets ; variations de profondeur.

### Chrome, miroir et plexiglas

La postproduction renforce :
- noirs profonds ;
- hautes lumières très blanches ;
- lignes de réflexion propres ;
- contraste local ;
- légère désaturation du métal ;
- teintes colorées réfléchies par l'environnement ;
- nettoyage sélectif sans supprimer toutes les imperfections.

Le chrome est surtout une alternance de zones presque noires et presque blanches.

## 5. Composition et montage photo

### Recadrage très serré

- crop après sélection de la mise en page ;
- parties importantes volontairement coupées ;
- agrandissement parfois au-delà de la résolution optimale ;
- grain ajouté ensuite pour homogénéiser ;
- textes utilisés comme prolongement du cadre.

Le léger manque de définition peut même renforcer le rendu éditorial.

### Espace négatif pour le texte

Le fond peut être étendu avec :
- duplication et transformation ;
- Content-Aware Fill ;
- peinture manuelle ;
- génération procédurale du fond — sans générer le sujet ;
- flou et grain pour cacher la transition ;
- création d'un aplat coloré à côté de la photographie.

Dans le branding, l'espace négatif est souvent défini par une règle de grille
constante.

### Objet décentré et asymétrie

- extension du canvas ;
- déplacement du sujet ;
- recomposition du fond ;
- ajout d'un contrepoids typographique ;
- alignement du sujet sur une ligne de grille plutôt qu'au centre.

L'asymétrie est généralement compensée par le logo, le titre ou une masse de
couleur.

### Répétition en série

- détourage ;
- duplication ;
- changements d'échelle ;
- variations de crop ;
- grille stricte ou répétition volontairement irrégulière ;
- alternance entre couleur, monochrome et bichromie ;
- modifications subtiles de contraste.

Une même photo peut devenir un motif de marque.

### Double exposition

1. deux images superposées ;
2. modes `Screen`, `Lighten`, `Multiply` ou masques ;
3. contraste différent sur chaque image ;
4. alignement partiel des silhouettes ;
5. dominante différente pour chaque exposition ;
6. zones conservées parfaitement nettes.

Une double exposition contemporaine est souvent plus graphique qu'une imitation
purement argentique.

### Still life sculptural

La postproduction sert à :
- nettoyer le fond ;
- réunir plusieurs prises ;
- contrôler chaque ombre séparément ;
- accentuer les lignes de matière ;
- harmoniser les couleurs ;
- recadrer comme une composition abstraite ;
- supprimer certains éléments de contexte ;
- renforcer les volumes par dodge and burn.

Cela reste de la photographie et du compositing, pas nécessairement du CGI.

### Mélange d'images propres et accidentelles

Le système peut inclure : portraits studio nets ; photos au flash ; crops basse
résolution ; scans ; captures de téléphone ; détails flous ; photos
surimprimées ; typographie identique pour relier l'ensemble.

La cohérence vient alors du traitement colorimétrique et de la mise en page, pas
de l'uniformité des prises de vue.

## 6. Postproduction graphique

### Retouche volontairement imparfaite

- conserver texture de peau et pores ;
- ne pas lisser les vêtements ;
- laisser certaines poussières ou traces ;
- ne pas corriger toutes les dominantes ;
- conserver un détourage légèrement brut ;
- permettre des zones surexposées ou légèrement floues ;
- effectuer la retouche beauté principalement avec dodge and burn, pas avec du blur.

L'imperfection est dirigée, pas laissée au hasard.

### Découpe franche sur fond uni

- détourage précis ou semi-précis ;
- légère frange conservée autour des cheveux selon le style ;
- fond uni très saturé ou très neutre ;
- ombre ajoutée ou supprimée ;
- grain appliqué au sujet et au fond pour les réunir ;
- contraste du sujet ajusté au nouvel environnement.

Un détourage totalement parfait peut sembler trop e-commerce. Une petite
rugosité donne un aspect plus éditorial.

### Ombres artificielles graphiques

- duplication du masque du sujet ;
- remplissage noir ou coloré ;
- transformation perspective ;
- étirement ;
- flou contrôlé ;
- mode `Multiply` ;
- déplacement parfois volontairement irréaliste ;
- combinaison avec des formes géométriques.

L'ombre peut devenir un élément de composition autonome.

### Collage numérique

Éléments possibles : photographie détourée ; scans de papier ; morceaux
imprimés ; photocopies ; texture de ruban adhésif ; annotations manuscrites ;
aplats colorés ; fragments de typographie ; cadres et lignes de mise en page.

Pour éviter l'effet « scrapbook », il faut généralement limiter la palette et
utiliser une grille stricte.

### Distorsion et étirement

- `Liquify` ;
- `Warp` ;
- déplacement avec displacement map ;
- duplication puis décalage ;
- étirement uniquement d'une partie du sujet ;
- smudge directionnel ;
- pixel sorting ou découpage en bandes ;
- répétition de fragments.

La distorsion fonctionne mieux lorsqu'une zone reste intacte et reconnaissable.

### Solarisation et fausses couleurs

Solarisation :
- courbe inversée partiellement ;
- mélange avec l'image originale ;
- séparation des canaux ;
- seuils appliqués aux hautes lumières ;
- teinte différente pour ombres et lumières.

Fausses couleurs :
- Gradient Map ;
- bichromie ;
- trichromie ;
- remplacement sélectif des couleurs ;
- noirs remplacés par bleu, vert ou violet ;
- blancs remplacés par jaune, rose ou cyan clair.

### Scan de tirage imprimé

1. développer la photo ;
2. l'imprimer sur papier mat, brillant ou photocopie ;
3. plier, froisser, annoter ou altérer le tirage ;
4. scanner à haute résolution ;
5. conserver les bords, poussières et texture ;
6. réintégrer le scan dans Photoshop ;
7. ajuster les niveaux sans supprimer toute la matière ;
8. ajouter la typographie finale numériquement.

On peut aussi imprimer seulement certaines couches : photo, texte ou couleur,
puis les rescanner séparément.

## Recettes prêtes à employer

### Look « flash éditorial moderne »

flash frontal réel ; blancs élevés ; peau légèrement brillante ; contraste assez
dur ; ombres froides ; grain fin ; cadrage serré ; détourage ou fond simplifié ;
typographie très propre.

### Look « film délavé premium »

noirs relevés ; contraste modéré ; saturation réduite ; dominante chaude ou
verdâtre ; bloom léger ; grain moyen ; netteté faible ; texture papier très
discrète.

### Look « campagne culturelle post-traitée »

photo réelle au flash ou documentaire ; crop agressif ; détourage partiellement
brut ; répétition ; bichromie ou Gradient Map ; scans de papier ; typographie
superposée ; aberration chromatique légère ; export avec légère texture
d'impression.

### Look « photo-montage très contemporain »

une photo principale nette ; une copie floue ou déplacée ; fragments recadrés ;
duplication du visage ou produit ; aplats colorés ; masque dur ; ombre
graphique ; grain commun à toute la composition ; texte calé sur une grille très
stricte.

---

## Ce que le tri devra trancher — noté, pas décidé

Rien ci-dessous n'est un verdict ; ce sont les questions que la lecture pose
d'elle-même et qu'il serait malhonnête de laisser implicites.

1. **Beaucoup de ces recettes sont des PILES, pas des effets.** « dupliquer,
   flouter, mode Écran, masquer les hautes lumières » est la définition d'un
   calque avec masque — shaderlab a déjà les trois pièces. La question n'est
   donc pas « quel effet écrire » mais « qu'est-ce qui manque à la pile pour
   que la recette soit exécutable ? » — et la réponse est souvent un
   **masque par tonalité** plutôt qu'un nouvel effet.
2. **Le registre couvre déjà une part de ce cahier.** `halation`, `glow`,
   `grain`, `motionBlur`, `lensBlur`, `lensDistortion` (aberration),
   `gradientMap`, `duotone`, `dither`, `glass` répondent chacun à au moins une
   entrée ci-dessus. Le doublon se mesure avant de s'écrire — la règle a coûté
   assez cher en août pour ne pas être réapprise.
3. **La famille des COURBES est absente et revient partout** : courbe en S,
   noirs relevés, seuil de blancs, courbes RGB séparées, point noir. C'est le
   manque le plus fréquent du cahier, et il ne ressemble à aucun effet du
   registre actuel.
4. **Ce qui ne se crée pas en postproduction** doit être dit et non simulé :
   téléobjectif compressé, lumière latérale dure, reflets spéculaires. Un
   effet qui prétendrait les créer rendrait le « filtre Photoshop 2005 » que
   ce dépôt proscrit.
5. **Plusieurs recettes demandent une GÉOMÉTRIE posée sur l'image**, pas des
   curseurs : masque radial près de la source, dégradé de light leak au bord
   du cadre, ombre graphique en perspective, zone de netteté conservée. C'est
   exactement le chantier UI annoncé en même temps, et le patron existe déjà —
   la source posée de `lensFlare`.
