# Ce que coûte d'attendre le 16-bit

Type: task
Status: open
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
