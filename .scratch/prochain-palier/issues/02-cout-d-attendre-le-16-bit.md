# Ce que coûte d'attendre le 16-bit

Type: task
Status: resolved
Blocked by: 01
Parent: ../map.md

## Question

L'export print est **réel mais lointain** (arbitrage d'Antoine, 2026-08-11). La
conséquence n'est pas « on n'en parle plus » : c'est qu'il faut savoir ce que
l'attente rend plus cher, et transformer ça en une contrainte OPPOSABLE que les
autres tickets de cette carte respectent sans y penser.

Mesurer sur le code réel — pas déduire :

- **Combien de sites** décideraient d'un format de texture si le pipeline
  gagnait un mode 16-bit. Point de départ : `gpuContext.ts`, `renderer.ts`,
  `framePipelineExecutor.ts`, `effectPassRunner.ts`, `shaderCompose.ts`,
  `imageFrameResources`, `maskTextureResolver.ts`. Compter, avec fichier:ligne.
- **Ce que les 23 effets supposent de leur cible.** Un effet qui écrit un
  `vec4<f32>` ne sait rien du format — mais lequel suppose implicitement une
  plage bornée à [0,1], ou compte sur l'encodage sRGB automatique par le
  FORMAT (règle verrouillée du projet) ? Un `rgba16float` est LINÉAIRE et non
  borné : la conversion cesse d'être gratuite. Nommer les effets concernés.
- **Ce que coûte un effet de plus.** Si écrire formes, typographie et
  recadrage ajoute N sites au chemin de rendu, l'attente coûte N. Chiffrer ce
  que le palier de cette carte ajouterait à la facture.
- **Les 77 références de pixels.** Un pipeline 16-bit change-t-il les rendus
  8-bit existants au bit près, ou faudra-t-il toutes les régénérer ? La
  question se répond en lisant comment `render-check.mjs` capture ses pixels
  (`Renderer.exportFrame()`), pas en supposant.

## Ce qu'il faut EN SORTIR

Une contrainte d'une à trois lignes, écrite dans les `## Notes` de la carte,
que tout ticket suivant peut appliquer mécaniquement. Du genre : « tout
nouveau site qui choisit un format de texture passe par tel point unique » —
ou, si la mesure le dit, « l'attente ne coûte rien de mesurable, aucune
contrainte », ce qui est une réponse parfaitement valable et à écrire telle
quelle.

⚠️ Ne PAS écrire le mode 16-bit. Ce ticket mesure et contraint ; construire est
hors de portée de cette carte (voir la section **Out of scope** de la carte).

## Dépendance — DÉBLOQUÉE le 2026-08-11

[Ce dont le 16-bit a besoin hors du dépôt](01-ce-dont-le-16-bit-a-besoin-hors-du-depot.md)
est résolu. La faisabilité technique est **acquise** : `rgba16float` passe
comme cible de rendu, en filtrage linéaire et en lecture, **sans aucune
feature** ; la crate qui écrit le TIFF 16 bits avec ICC embarqué est **déjà une
dépendance du dépôt** ; la matrice de gamut ne porte que 4 coefficients non
triviaux.

⚠️ **Mais il a rapporté trois faits qui déplacent CE ticket**, et les ignorer
en ferait une mesure hors sujet :

1. **L'invariant « sRGB par le FORMAT » ne survit pas au 16-bit.** Aucun format
   flottant n'a de variante `-srgb`. Or c'est une décision VERROUILLÉE du
   projet (`CLAUDE.md` § Stack : « sans ça, glow/grain/blur sont
   mathématiquement faux »), portée par 7 modules de `src/render/`, et le PRD
   la range dans ses clauses « inacceptable ». La question de ce ticket n'est
   donc plus seulement « combien de sites » : c'est **où passe la frontière
   entre le chemin qui garde l'invariant et celui qui ne peut pas**, et si
   cette frontière est tenable. Le mesurer AVANT d'écrire la contrainte.
2. **`rgba16float` n'est pas 16 bits uniformes** — ~11 bits utiles près du
   blanc, 32 à 64× plus grossier qu'un 16 bits entier, alors que la sortie
   visée EST un TIFF 16 bits entier. À reporter dans la mesure : ce que le
   PRD promet (« éliminer le banding ») et ce que ce format donne ne coïncident
   pas automatiquement dans les hautes lumières, précisément là où bloom et
   halation travaillent.
3. **`MAX_CANVAS_PIXELS = 64 Mpx`** (`src/render/limits.ts:88`, calibré par
   ADR-0007 sur des mesures VRAM réelles) dépasse les limites par défaut du
   device en 16 bits. Relevables sur demande explicite — donc ce n'est pas un
   mur, mais ça cesse d'être gratuit, et ADR-0007 devra être relu.

⚠️ **Et un trou déclaré à refermer, qui est du ressort de ce ticket** : toute la
mesure de faisabilité a été prise dans **Edge 151, pas dans le WebView2 de
shaderlab** (aucun binaire construit sur disque au moment de la recherche), sur
un seul GPU, backend D3D12 non mesuré. Le snippet pour le refermer est dans le
fichier de findings. **Le refermer d'abord** : c'est le WebView2 réel qui
décide, et ce dépôt a déjà payé pour avoir confondu les deux (`gpu-shader-check`
sans `--origin` compile les modules en cache et rend vert ET rouge faux).

## Answer

Résolu le 2026-08-12, mesuré sur le code réel.

**L'attente ne coûte presque rien — parce que l'architecture porte DÉJÀ la
propriété qui rend le 16-bit introduisible.** La contrainte à écrire n'est donc
pas « faites attention à ceci », c'est « ne perdez pas cela ».

### Le chemin de la couleur n'a qu'UNE décision de format

25 sites `format:` dans `src/render/` et `src/mask/`, mais ils se rangent en
trois familles qui n'ont rien à voir :

| Famille | Sites | Concerné par le 16-bit ? |
| --- | --- | --- |
| `"r8unorm"` — chemin du **masque**, un canal | 7 | **non**, séparé |
| Dérivés (`target.format`, annotations de type) | 4 | suivent |
| **`this.srgbFormat`** — chemin de la **couleur** | **14** | oui |

Les quatorze lisent **le même champ**. `srgbFormat` est défini une seule fois
(`gpuContext.ts:160`, `` `${canvasFormat}-srgb` ``) et propagé par **injection
de constructeur** dans cinq classes : `effectPassRunner`,
`imageFrameResources`, `photoLayerInput`, `photoSourceStore`, `presentPass`.

**Zéro format de couleur codé en dur dans tout `src/`** (vérifié : aucune
occurrence littérale de `rgba8unorm`/`bgra8unorm` hors `gpuContext.ts`).

### Les 23 effets ne coûtent RIEN, et ce n'était pas acquis

La question du ticket était : lequel suppose une plage bornée ou compte sur
l'encodage automatique ? Réponse mesurée : **aucun n'a besoin de changer**.

21 effets sur 23 importent `srgbTransfer` ou une conversion sRGB↔linéaire — ce
qui a l'air de contredire l'invariant du projet, et n'en fait rien. L'en-tête de
`effects/srgbTransfer.ts` le dit sans ambiguïté : ces helpers convertissent la
**CONSTANTE ou la COULEUR D'ENTRÉE** (un seuil de curseur, une couleur de
picker — des valeurs PERCEPTUELLES) vers le linéaire au point d'usage,
**jamais l'image**. `textureSample` rend déjà du linéaire, parce que le format
est `-srgb`.

Un effet ne voit donc jamais le format. Il lit du linéaire, écrit du linéaire,
et l'encodage est un problème de la cible. **Corollaire pour cette carte :
écrire formes, typographie et recadrage ajoute ZÉRO site à la facture 16-bit.**

⚠️ **Mais 22 effets sur 23 bornent leur sortie** (`clamp`/`saturate`). Donc la
marge au-dessus de 1,0 qu'offre un flottant **ne serait pas utilisée** : le
gain serait purement de la PRÉCISION dans [0,1]. C'est bien ce que le PRD
cherche (le banding), mais ça rend la limite trouvée par la recherche 01 —
~11 bits utiles près du blanc — **contraignante et non anecdotique**, puisque
c'est exactement là que bloom et halation travaillent.

### La rupture est aux BORNES, pas dans la chaîne

`exportFrame` branche sur `this.ctx.srgbFormat.startsWith("bgra")`
(`renderer.ts:596`) pour l'ordre des canaux, et décode des octets 8 bits. Un
chemin flottant demanderait son propre décodage. Idem pour `presentPass`, qui
présente à l'écran.

**Les 77 références de pixels sont donc SAUVES**, à une condition que le PRD
pose déjà lui-même : le 16-bit est un **second point d'entrée d'export**, pas
un drapeau sur l'existant. Le chemin 8-bit reste intact, ses références aussi.
Si quelqu'un transforme ça en drapeau, les 77 sautent.

### LA CONTRAINTE, à recopier dans les `## Notes` de la carte

> **Tout site qui choisit un format de texture COULEUR reçoit `srgbFormat` par
> injection — jamais une constante littérale, jamais un format déduit sur
> place.** Une décision, quatorze lecteurs, zéro format en dur : c'est cette
> propriété qui rend le 16-bit introduisible plus tard. La préserver coûte
> zéro ; la perdre coûte une chasse dans huit fichiers.
>
> **Corollaire : un effet ne choisit JAMAIS de format.** S'il semble en avoir
> besoin, c'est la conception qui est fausse — le patron est
> `textureLibraryStore`, où c'est le STORE qui choisit et l'effet qui consomme.

### Ce que ce ticket n'a PAS fait

Le trou déclaré n'est pas refermé : la faisabilité reste mesurée dans **Edge,
pas dans le WebView2 de shaderlab** (aucun binaire sur disque). Ça ne bloque
pas la contrainte ci-dessus, qui est une propriété du code et non du navigateur
— mais ça bloque toute décision de CONSTRUIRE le 16-bit. À refermer au moment
où ce chantier s'ouvrira, avec le snippet du fichier de findings.
