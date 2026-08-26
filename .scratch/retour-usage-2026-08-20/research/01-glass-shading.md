# Recherche — Rendu de verre temps réel (refonte du mode « Poli »)

> Contexte : effet `glass` de shaderlab (WebGPU/WGSL, post-traitement 2D sur une
> photo JPEG, une seule image en entrée, pas de scène 3D, pas de cubemap, temps
> réel sur 26 Mpx). Le mode **Poli** a été refusé 4 fois par Antoine —
> « très artificiel, 3D des années 90 ».
> Recherche menée le 2026-08-21. Une source par affirmation, applicabilité
> tranchée à notre contrainte 2D/WGSL.

---

## 1. Synthèse — les idées qui changent notre approche du Poli

**Le diagnostic numérique est CONFIRMÉ par la théorie. Notre modèle du Poli est
structurellement faux, pour deux raisons distinctes qui se cumulent.**

### Idée 1 — Un verre poli ne porte pas un « highlight » ponctuel : il RÉFLÉCHIT une scène. Blinn-Phong est le mauvais opérateur.
Un highlight spéculaire (Phong/Blinn-Phong) N'EST QUE le reflet des **sources de
lumière** — un lobe flou autour de la direction de réflexion de la lampe
([LearnOpenGL, Advanced Lighting](https://learnopengl.com/Advanced-Lighting/Advanced-Lighting)).
Plus la surface est lisse, plus ce lobe se resserre : à la limite miroir, il
devient un **point** (une fonction delta) — donc invisible s'il n'y a pas
exactement une source ponctuelle sous l'angle exact. C'est très précisément notre
bug : normale qui ne dévie jamais > 8,43°, exposant 120 → highlight à 0,0004,
mort. **Un exposant qui monte doit AFFAIBLIR le highlight ponctuel, pas le
renforcer** ; la surface la plus lisse doit montrer non pas un point plus vif mais
le **reflet net de tout l'environnement**. Le highlight ponctuel et le reflet
d'environnement sont deux choses différentes : le premier reflète les lampes, le
second reflète la scène entière (LearnOpenGL, section « specular vs environment »
de la recherche). Sur une surface lisse, seul le second est visible.

### Idée 2 — Le Fresnel constant à 0,04 est l'erreur centrale : il DOIT ramper avec l'angle de vue. C'est ça qui « fait verre ».

> ⚠️ **AMENDÉ le 2026-08-26 (clôture du ticket 16)** : « comme nous le
> faisons » ci-dessous est FAUX, écrit sans avoir ouvert le shader. La rampe de
> Schlick est dans `glass.ts:889` depuis le premier commit du verre, sur
> `cos θ = N.z` par pixel (`:838`, vue orthographique `:769`). Le symptôme
> décrit (voile plat) est réel, mais sa cause est la ligne d'à côté :
> `glass.ts:890` mélange vers une couleur FIXE — c'est l'ENVIRONNEMENT qui est
> gelé (Idée 3), pas le Fresnel. Mesuré : sur le Poli aux défauts l'inclinaison
> max de la normale est 2,14° donc F varie de 1,6e-16 (un verre plat de face
> réfléchit 4 %, c'est juste) ; sur un Pavé nuage à creux 1, la même rampe fait
> courir F de 0,040 à 0,322. La physique du paragraphe reste bonne ; son
> constat sur notre code ne l'était pas.
Schlick : `R(θ) = R₀ + (1 − R₀)·(1 − cos θ)⁵`, avec `R₀ ≈ 0,04` pour le verre
(IOR 1,5) ([Pete Shirley, Fresnel/Schlick](http://psgraphics.blogspot.com/2020/03/fresnel-equations-schlick-approximation.html)).
En incidence normale (vue de face) la réflectance vaut **0,04** — le verre est
presque transparent. En incidence rasante (bords, angle de vue faible) elle tend
vers **1,0** — le verre devient miroir (idem). Coller Fresnel à 0,04 PARTOUT, comme
nous le faisons, tue exactement le phénomène qui signe le verre : le **reflet qui
s'allume sur les bords et aux angles rasants**. Le voile plat uniforme qu'on
observe EST la signature d'un Fresnel gelé. Correction : calculer `cos θ = |view·N|`
par pixel et laisser Fresnel ramper — c'est un calcul par pixel, sans données
externes, donc gratuit et directement applicable en WGSL.

### Idée 3 — On n'a pas d'environnement, mais on peut en FABRIQUER un plausible sans cubemap ni scène 3D. Trois voies, toutes 2D.
Le reflet d'environnement se fabrique à partir de rien de plus qu'une photo et le
champ de normales que l'effet calcule déjà :
- **MatCap / Spherical Environment Mapping** — mapper la normale de surface vers
  les UV d'une texture 2D « sphère éclairée » ; le reflet sort de la texture, sans
  cubemap ([hughsk/matcap, MIT](https://github.com/hughsk/matcap)). Réutilisable.
- **Auto-réflexion en espace écran** — réfléchir le vecteur de vue et
  échantillonner **la photo elle-même**, décalée/floutée, comme son propre
  environnement ([Screen Space Reflection, Sakib Saikia](https://sakibsaikia.github.io/graphics/2016/12/26/Screen-Space-Reflection-in-Killing-Floor-2.html)).
- **Environnement-gradient synthétique** — un dégradé doux (clair en haut / sombre
  en bas, façon fenêtre de studio) réfléchi via la normale ; c'est le « fake
  reflection par gradient » classique ([Blender Artists, fake reflection](https://blenderartists.org/t/create-a-fake-reflection-based-on-a-photo/1367306)).

⚠️ **Piège structurel, à écrire noir sur blanc** : sur une surface PARFAITEMENT
plate (normale constante), matcap et l'auto-réflexion rendent une couleur
**constante** — il n'y a rien à faire varier spatialement. Le reflet n'a de
structure que si (a) la normale varie (relief/micro-relief) ou (b) le Fresnel varie
(bords). Donc pour le Poli plat, le reflet doit venir du **rampe de Fresnel aux
bords** (rim) + une **micro-variation de normale** ; sinon on retombe sur un aplat.

### Idée 4 — La recette « Liquid Glass » (Apple WWDC 2025) est notre patron exact : elle lit « verre premium », pas « 3D 90s », et elle est 100 % post-traitement 2D.
Le look qu'Antoine veut est celui-là, et sa recette est publique et 2D : forme
définie par une SDF/masque, **réfraction de bord** (displacement du fond le long de
la normale, fort au bord, nul au centre), **rim/edge highlight**, **aberration
chromatique de bord seulement**, flou du fond
([dashersw/liquid-glass-js, MIT](https://github.com/dashersw/liquid-glass-js) ;
[zenn.dev, Liquid Glass WebGL](https://zenn.dev/orectic/articles/liquid-glass-webgl-refraction?locale=en)).
Ce qui fait « 90s » chez nous, c'est le blob spéculaire dur d'une surface éclairée
comme du plastique ; ce qui fait « verre » chez eux, c'est que **toute l'énergie
est au BORD** (réfraction + rim + frange chromatique) et que le centre est presque
neutre. Bascule de modèle : ne plus éclairer une surface, mais **déformer + border**
une forme.

### Idée 5 — Pour un panneau de verre plat mince, la réfraction nette est quasi NULLE au centre. Ne pas fabriquer une fausse déformation.
Deux faces parallèles d'un verre mince annulent la déviation nette : un panneau
plat poli montre la photo **quasi intacte** au centre, la réfraction ne se voit
qu'aux **bords/reliefs** où les faces cessent d'être parallèles
([Codrops, réfraction](https://tympanus.net/codrops/2019/10/29/real-time-multiside-refraction-in-three-steps/),
qui montre que la réfraction utile vient des normales de bord). Si notre Poli
plie l'image au centre, c'est faux et ça participe au look artificiel. La
réfraction visible doit être **portée par le champ de pente** du matériau (qu'on a
déjà) et **concentrée là où la pente est forte**, pas étalée uniformément.

**Conséquence directe pour le code** : le Poli doit cesser d'être « une normale +
Blinn-Phong » et devenir « **Fresnel(view·N) rampant × [reflet d'environnement
échantillonné] + réfraction portée par la pente, concentrée aux bords + rim de
bord + frange chromatique de bord** ». Aucune de ces briques ne demande de scène
3D ni de cubemap.

---

## 2. Par angle — sources et applicabilité

### Angle 1 — « Glass shader » temps réel (techniques réelles)
- **Codrops — Real-time Multiside Refraction** ([url](https://tympanus.net/codrops/2019/10/29/real-time-multiside-refraction-in-three-steps/)).
  Trois passes : réfraction face avant (`refract()` sur la normale + ratio d'IOR),
  mélange réflexion/réfraction par **Fresnel**, puis réfraction multi-faces via une
  passe de **normales de dos**. **Applicabilité : INAPPLICABLE tel quel** — exige
  un maillage 3D et une passe backface (« a renderer, a scene, a perspective
  camera and our geometry »). Utile seulement pour le principe (Fresnel mélange
  réflexion et réfraction ; la réfraction utile vient des normales). Licence code
  non déclarée.
- **CodeSignal — Rendering Glass and Refraction** ([url](https://codesignal.com/learn/courses/realistic-rendering-techniques-for-the-cpp-ray-tracer/lessons/rendering-glass-and-refraction)).
  Modèle conceptuel propre du verre = **réflexion + réfraction mélangées par
  Fresnel**, verre plus réfléchissant en rasant. Concept applicable ; c'est du
  ray-tracer CPU, donc pas de code à porter.

### Angle 2 — Verre procédural
- **hughsk/matcap** ([url](https://github.com/hughsk/matcap)) — voir Angle 8.
  Le « matériau » (éclairage + reflets) tient dans **une texture 2D**, indexée par
  la normale. C'est la façon la plus économique de fabriquer un matériau verre
  procédural sans lumières ni environnement. **APPLICABLE**, MIT.
- **Faking PBR on Mobile using MatCaps — Quentin King** ([url](https://quentinking.com/shaders/matcaps/)).
  Montre qu'on peut simuler un matériau brillant complet (spéculaire + reflet)
  avec un matcap seul, sans source de lumière. **APPLICABLE** comme méthode de
  substitution au Blinn-Phong. (Article, pas de licence de code à porter.)

### Angle 3 — Réfraction + dispersion chromatique en temps réel
- **Taylor Petrick — Simulating Dispersion With OpenGL** ([url](https://taylorpetrick.com/blog/post/dispersion-opengl)).
  Réfracte R, G, B séparément avec 3 IOR différents ; échantillonne la texture de
  scène 3 fois à des décalages différents. Code : `refract(view, normal, iorRatio)`
  puis `texture(sceneTexture, screenCord + refractVec.xy)`. **Opère en espace-écran
  sur une texture 2D** — l'auteur confirme que la même technique marche sur une
  image de scène rendue. **DIRECTEMENT APPLICABLE** à notre cas. Pas de valeurs
  d'IOR chiffrées données ; pas de licence déclarée → **inspiration seulement**.
- **Three.js — Refractive Shader with Chromatic Aberration (LB Project)** ([url](https://blog.lbproject.dev/creating-a-refractive-material-with-chromatic-aberration-in-three-js)).
  Modèle spectral 3-longueurs-d'onde via approximation de Cauchy, split R/G/B par
  IOR dépendant de la longueur d'onde, échantillonnage en espace-écran.
  **APPLICABLE** (2D). Vérifier la licence avant toute reprise de code.
- **Franky Hung — Chromatic Dispersion cube (Three.js)** ([url](https://franky-arkon-digital.medium.com/building-pinterest-design-of-a-cube-with-chromatic-dispersion-in-three-js-07d007316c84)).
  Utilise réfraction front+back sur une géométrie → **suppose une scène 3D**,
  moins applicable ; garder pour la logique de split chromatique.
- **Note de dosage** : commencer par un incrément d'IOR ~0,1 entre canaux, franges
  visibles surtout aux contours (résultat de recherche, Unreal/Three.js). Chez nous
  la dispersion doit être **de bord** (comme Liquid Glass), pas globale — sinon
  voile arc-en-ciel partout.

### Angle 4 — Fresnel (Schlick) et pourquoi un verre poli réfléchit l'environnement
- **Pete Shirley — Fresnel Equations, Schlick, Dielectrics** ([url](http://psgraphics.blogspot.com/2020/03/fresnel-equations-schlick-approximation.html)).
  LA source qui valide le diagnostic. `R = R₀ + (1−R₀)·pow(1−cos, 5)`. Diélectrique
  (verre) : `R₀ ≈ 0,04`, la lumière se réfracte dans le matériau ; métal : `R₀`
  élevé et coloré, « toute l'action est en surface ». **DIRECTEMENT APPLICABLE** —
  c'est la formule à câbler par pixel. Formule = domaine public (physique),
  l'article est une explication (attribuer à Shirley).
- **Wikipedia — Schlick's approximation** ([url](https://en.wikipedia.org/wiki/Schlick%27s_approximation)).
  Référence canonique de la formule + calcul de `R₀ = ((n₁−n₂)/(n₁+n₂))²`.
  **APPLICABLE**. Texte CC BY-SA ; la formule est libre.
- **Pourquoi « réfléchit l'environnement » et pas « highlight »** : la réflectance
  variant fortement avec l'angle, une surface lisse renvoie l'environnement sous une
  multitude d'angles au lieu d'un point unique (synthèse Shirley + LearnOpenGL,
  Angle 6). C'est le cœur de la refonte.

### Angle 5 — Verre dépoli / frosted (BTDF, rugosité, flou dépendant de la rugosité)
- **Walter et al. — Microfacet Models for Refraction through Rough Surfaces (EGSR 2007)** ([PDF Cornell](https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf)).
  Référence fondatrice de la **BTDF** microfacette + **importance sampling** :
  réfraction rugueuse = perturber le **demi-vecteur** (normale de microfacette) puis
  réfracter. **Le sampling par importance est offline (path tracing) → INAPPLICABLE
  tel quel.** À citer comme fondement théorique de notre Dépoli.
- **Polycount — Fake refraction roughness in UE4** ([url](https://polycount.com/discussion/208203/possible-to-fake-refraction-roughness-glossiness-in-ue4)).
  Le stand-in temps réel de la BTDF : **échantillonner la scène plusieurs fois avec
  de petits décalages, flou piloté par une carte de rugosité**. **DIRECTEMENT
  APPLICABLE** — c'est exactement notre Dépoli (multi-tap flou dépendant de la
  rugosité sur l'échantillon réfracté). Forum (inspiration).
- **Refraction Ray Cones for Texture LOD (Ray Tracing Gems II, ch.10)** ([PDF](https://www.icare3d.org/research/publications/BCA21/RTG2_RefractionRayCones.pdf)).
  Lie rugosité de réfraction et niveau de mip à échantillonner — pertinent car on a
  **déjà une pyramide de mipmaps** (`mipmapGenerator.ts`) : un Dépoli plus rugueux =
  lire un LOD plus haut de l'échantillon réfracté, au lieu de N taps. Piste perf
  applicable. (Article de livre ; principe, pas de copie.)

### Angle 6 — Highlight ponctuel (Blinn-Phong) vs réflexion d'environnement
- **LearnOpenGL — Advanced Lighting (Blinn-Phong)** ([url](https://learnopengl.com/Advanced-Lighting/Advanced-Lighting)).
  Un highlight spéculaire **est le reflet de la source de lumière** ; Phong se coupe
  quand l'angle vue–réflexion dépasse 90° (dot négatif → 0), Blinn-Phong corrige via
  le demi-vecteur. Point clé pour nous : **spéculaire = lampes ; environnement =
  scène entière**, deux opérateurs différents ; sur surface lisse c'est
  l'environnement qui domine. **APPLICABLE** (théorie). Contenu **CC BY-NC** →
  citer, ne pas copier de code.
- **Corollaire mesuré chez nous** : exposant 120 sur une normale qui bouge de
  ±8° donne un lobe qui ne rencontre jamais une source → 0,0004. La « bonne limite »
  d'une surface lisse n'est pas « exposant plus grand » mais « réflexion miroir de
  l'environnement, atténuée par Fresnel ». (Diagnostic interne + Shirley/LearnOpenGL.)

### Angle 7 — Verre à relief / pavés / glass blocks (comment le relief structure la lumière)
- **codinBlack — Glass Shader (Unity Shader Graph)** ([url](https://www.codinblack.com/glass-shader-using-shader-graph-in-unity3d/)) et
  **Unify Wiki — Refraction** ([url](http://wiki.unity3d.com/index.php?title=Refraction)).
  Une **normal map perturbe la normale utilisée dans `refract()`** : le relief
  structure la réfraction sans géométrie. **DIRECTEMENT APPLICABLE** — c'est
  exactement notre modèle « chaque matière fabrique une pente de surface » ; le
  relief des pavés = un champ de normales plus contrasté injecté dans la même
  réfraction. (Tutoriels, inspiration.)
- **NormalMap.ai — Shattered/Textured Glass Normal Map** ([url](https://normalmap.ai/learn/shattered-glass-normal-map-generator/)).
  Le relief (fissures, motif de pavé) « plie la lumière de fond à des angles vifs le
  long des coutures », à coût géométrique nul. **APPLICABLE** comme justification :
  le rendu des pavés dépend d'un **champ de normales franc**, pas d'un éclairage.
- **Enseignement** : les modes à relief (pavés) fonctionnent DÉJÀ mieux que le Poli
  précisément parce qu'ils ont une normale qui varie — donc réfraction et reflet ont
  de quoi se structurer. Le Poli plat est le cas dégénéré (Idée 3).

### Angle 8 — Réflexion d'environnement/IBL SANS cubemap (photo 2D seule)
- **hughsk/matcap** ([url](https://github.com/hughsk/matcap)) — **MIT**.
  `vec2 uv = matcap(eyeVector, normalVector);` puis `texture(matcapTex, uv)`. Fake
  le terme spéculaire/reflet à partir d'une **texture 2D « sphère éclairée »**, sans
  cubemap ni scène. **APPLICABLE ET RÉUTILISABLE**. Limite : le matcap ne tourne pas
  avec la vue (reflet « collé » à l'objet) — acceptable pour une photo fixe.
- **Clicktorelease — Spherical Environment Mapping shader** ([url](https://www.clicktorelease.com/blog/creating-spherical-environment-mapping-shader/)).
  Math du SEM (matcap) : reflet à partir d'un « lit sphere » 2D. **APPLICABLE**
  (méthode). Article — porter la math, pas le texte.
- **Screen Space Reflection — Sakib Saikia (Killing Floor 2)** ([url](https://sakibsaikia.github.io/graphics/2016/12/26/Screen-Space-Reflection-in-Killing-Floor-2.html))
  et **Yiwei Gong (forward SSR)** ([url](https://medium.com/@imwithye/screen-space-reflection-in-forward-rendering-pipeline-d768b8a31dd9)).
  Réfléchir le vecteur de vue autour de la normale et échantillonner **le buffer de
  couleur (la photo)** comme environnement. Le ray-march complet est cher et ne
  reflète que ce qui est à l'écran ; **la variante applicable chez nous** = décalage
  fixe (pas de raymarch) de la photo floutée comme auto-reflet, modulé par Fresnel.
  **PARTIELLEMENT APPLICABLE** (version cheap). Articles (inspiration).
- **Fake reflection par gradient** ([Blender Artists](https://blenderartists.org/t/create-a-fake-reflection-based-on-a-photo/1367306)).
  Un dégradé clair→sombre tient lieu d'environnement de studio ; falloff par
  masque/gradient. **APPLICABLE** comme environnement synthétique bon marché quand la
  photo ne fournit rien d'exploitable en reflet. (Forum, inspiration.)

---

## 3. Licences — réutilisable vs inspiration seulement

| Source | Licence | Statut pour nous |
|---|---|---|
| [hughsk/matcap](https://github.com/hughsk/matcap) (code GLSL matcap/SEM) | **MIT** | ✅ **Réutilisable** avec attribution. Le noyau matcap peut être porté en WGSL. |
| [dashersw/liquid-glass-js](https://github.com/dashersw/liquid-glass-js) (réfraction 2D + rim + edge) | **MIT** | ✅ **Réutilisable** avec attribution. Recette bord/rim/base portable. |
| Formule de Schlick / Fresnel ([Shirley](http://psgraphics.blogspot.com/2020/03/fresnel-equations-schlick-approximation.html), [Wikipedia](https://en.wikipedia.org/wiki/Schlick%27s_approximation)) | Formule = domaine public ; textes CC BY-SA | ✅ **Réutilisable** (formule). Citer, ne pas recopier la prose. |
| [Walter et al. 2007 BTDF](https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf) | Papier académique | ✅ Fondement à **citer** ; algo offline non porté. |
| [LearnOpenGL](https://learnopengl.com/Advanced-Lighting/Advanced-Lighting) | **CC BY-NC** | ⚠️ **Inspiration** — non-commercial ; réécrire, ne pas copier le code. Vérifier si notre usage est « commercial ». |
| [Taylor Petrick — dispersion](https://taylorpetrick.com/blog/post/dispersion-opengl) | Non déclarée | ⚠️ **Inspiration seulement** (règle projet : pas de copie sans licence). |
| [zenn.dev Liquid Glass](https://zenn.dev/orectic/articles/liquid-glass-webgl-refraction?locale=en) | Non déclarée | ⚠️ **Inspiration seulement.** |
| [LB Project (Three.js)](https://blog.lbproject.dev/creating-a-refractive-material-with-chromatic-aberration-in-three-js) | Non vérifiée | ⚠️ Vérifier avant reprise ; sinon inspiration. |
| [Codrops multiside](https://tympanus.net/codrops/2019/10/29/real-time-multiside-refraction-in-three-steps/) | Non déclarée + **3D requis** | ⚠️ Inspiration conceptuelle seulement. |
| [nidorx/matcaps](https://github.com/nidorx/matcaps) (bibliothèque de textures matcap) | **Aucune licence, provenance inconnue** | ❌ **Ne PAS redistribuer.** Générer nos propres matcaps ou utiliser une source à licence claire. |

**Règle appliquée** (CLAUDE.md projet) : copie verbatim interdite sans licence
permissive citée. Seuls **matcap (MIT)** et **liquid-glass-js (MIT)** sont
réutilisables tels quels ; tout le reste est inspiration → réimplémenter.

---

## 4. Références visuelles (planche de comparaison)

URLs directes via `Special:FilePath` (redirige vers le fichier image). La page de
description (`/wiki/File:…`) porte l'auteur et la licence de chaque photo —
**à vérifier avant tout usage public** ; pour une planche interne de comparaison,
usage de référence.

### Verre poli — réfraction + reflet net d'environnement (cas cible du Poli)
1. **Ville réfractée/inversée dans une boule de verre** — montre SIMULTANÉMENT la
   réfraction inversée ET un reflet spéculaire net d'environnement. LA meilleure
   référence unique du Poli.
   https://commons.wikimedia.org/wiki/Special:FilePath/Hohenzollernbr%C3%BCcke%20und%20Dom%20in%20K%C3%B6ln%20durch%20die%20Glaskugel%20gesehen.jpg
2. **Arbre inversé dans une sphère de verre** — réfraction + point de reflet vif.
   https://commons.wikimedia.org/wiki/Special:FilePath/A%20tree%20in%20my%20sphere,%20Mytilene,%20Kalloni,%20Greece.jpg
3. **Réfraction à travers un verre d'eau** — décalage de réfraction net (poli).
   https://commons.wikimedia.org/wiki/Special:FilePath/Refraction%20through%20a%20glass%20of%20water.jpg
4. **Réfraction à travers un vase en cristal** — réfraction + caustiques.
   https://commons.wikimedia.org/wiki/Special:FilePath/Light%20Refraction%20through%20a%20crystal%20vase.jpg

### Dispersion chromatique (référence de la frange de bord)
5. **Décomposition de la lumière blanche (prisme)** — dispersion arc-en-ciel, la
   frange chromatique de bord qu'on veut ALLUSIVE, pas globale.
   https://commons.wikimedia.org/wiki/Special:FilePath/Descomposici%C3%B3n%20de%20la%20luz%20blanca.jpg
6. **Caustique d'un flacon d'huile au soleil** — dispersion + caustiques réelles.
   https://commons.wikimedia.org/wiki/Special:FilePath/Optical%20caustic%20Cosmetic%20oil%20bottle%20in%20the%20sun%20mj.jpg

### Pavés / verre à relief (modes à normale contrastée)
7. **Distorsion de la lumière à travers des pavés de verre** — comment le relief du
   pavé structure/plie le fond.
   https://commons.wikimedia.org/wiki/Special:FilePath/Glass%20block%20distortion.jpg
8. **Fenêtre en briques de verre** — pavés rétroéclairés, motif de réfraction.
   https://commons.wikimedia.org/wiki/Special:FilePath/Glass%20Brick%20window.jpg
9. **Brique de verre isolée (Glasbaustein)** — spécimen, motif nervuré classique.
   https://commons.wikimedia.org/wiki/Special:FilePath/Glasbaustein.jpg
10. **Briques de verre historiques (Falconnier)** — motifs de relief variés.
    https://commons.wikimedia.org/wiki/Special:FilePath/Glasbausteine%20von%20Gustave%20Falconnier.jpg
11. **Briques de verre colorées (Walmer Castle)** — relief + teinte/dispersion.
    https://commons.wikimedia.org/wiki/Special:FilePath/Amethyst%20glass%20light%20bricks,%20Walmer%20Castle%20-%20geograph.org.uk%20-%20237141.jpg

### Dépoli / frosted (mode Dépoli)
12. **Surface de verre dépoli (gros plan)** — texture de diffusion, flou de
    transmission dépendant de la rugosité.
    https://commons.wikimedia.org/wiki/Special:FilePath/Frosted%20glass%20surface.jpg
13. **Chope givrée (Beer Mug Frosted)** — dépoli sur volume, reflet doux diffus.
    https://commons.wikimedia.org/wiki/Special:FilePath/Beer%20Mug%20Frosted.jpg
14. **Fenêtre en verre dépoli (rétroéclairée)** — diffusion douce d'un fond.
    https://commons.wikimedia.org/wiki/Special:FilePath/FrostedGlassWindow.JPG
15. **Verre dépoli gravé (Brooklyn Museum, « Westward Ho »)** — dépoli + relief gravé.
    https://commons.wikimedia.org/wiki/Special:FilePath/WLA%20brooklynmuseum%20Westward%20Ho%20frosted%20glass.jpg

Pages de catégorie (pour piocher davantage) :
[Glass blocks](https://commons.wikimedia.org/wiki/Category:Glass_blocks) ·
[Frosted glass](https://commons.wikimedia.org/wiki/Category:Frosted_glass) ·
[Refraction](https://commons.wikimedia.org/wiki/Category:Refraction) ·
[Glass spheres](https://commons.wikimedia.org/wiki/Category:Glass_spheres).

---

## Annexe — croquis de pipeline WGSL 2D pour le Poli (dérivé, à valider)

Aucune scène 3D, aucun cubemap. Par pixel, à partir de la photo `src`, du champ de
pente/normale `N` déjà produit par le matériau, et de la vue `V` (constante, ~(0,0,1)
pour une photo de face) :

1. `cosT = clamp(abs(dot(V, N)), 0, 1)`
2. `F = 0.04 + 0.96 * pow(1 - cosT, 5)` — Fresnel qui rampe (Idée 2).
3. **Réfraction** : `uvR = uv + refractOffset(N) * strength`, offset **proportionnel à
   la pente**, ~nul là où N est vertical (Idée 5) ; dispersion en décalant R/B de
   bord (Angle 3).
4. **Reflet d'environnement** `env` : au choix (Idée 3) — matcap(V,N) / auto-reflet
   `src(uv - reflOffset(N))` flouté / gradient synthétique.
5. **Composite** : `out = mix(refractedColor, env, F)` — F pilote reflet vs
   transmission, donc le reflet **s'allume aux bords/angles rasants** (Idées 1-2).
6. **Rim de bord** : ajouter un liseré vif là où `F` est haut (silhouette/pente
   forte), façon Liquid Glass (Idée 4).
7. **Dépoli** = flouter l'échantillon réfracté (multi-tap ou LOD de mip) selon la
   rugosité (Angle 5).

Ce qui DISPARAÎT : le terme Blinn-Phong ponctuel sur micro-normale (cause du look
« 3D 90s »). Ce qui ARRIVE : Fresnel rampant + reflet d'environnement fabriqué en 2D.
