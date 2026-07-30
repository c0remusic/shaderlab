# Audit des six effets de rendu — 2026-07-31

Suite prévue de l'audit pré-release du 2026-07-30, qui l'annonçait en ces termes :
« même grille sur les effets, code d'abord puis qualité de rendu ». Lecture seule,
sur `master@023685a`.

**Méthode.** Douze agents : un auditeur par effet, puis un adversaire par effet
chargé de le RÉFUTER — pas de le compléter. La leçon du 2026-07-30 est appliquée
telle quelle : sans passe de réfutation, un audit produit surtout des faux HAUTE.
Elle s'est vérifiée une seconde fois — **les six rapports initiaux ont tous été
corrigés**, aucun n'était juste tel quel, et trois findings HAUTE de la première
passe sont tombés.

Vingt-cinq findings survivent, dont cinq HAUTE. Un seul a été reproduit sur GPU
réel, et c'est celui qui commande tout le reste.

---

## 1. Le défaut qui domine : un effet posé sur le calque photo rend l'image NOIRE

**Sévérité : HAUTE. Reproduit sur GPU réel, pas déduit.**

Ouvrir un JPEG, choisir « Warp » ou « Chromatic bleed » dans le sélecteur d'effet
du calque : toute l'image devient noire. Deux clics, aucun réglage à toucher, sur
le calque que porte **tout** document.

### La mesure

Harnais : `Renderer.exportFrame()` lu par CDP sur la vraie fenêtre WebView2 —
les octets qui partent au JPEG, jamais une capture d'écran (même raison que
`scripts/render-check.mjs`, dont ce harnais emprunte le montage). Mire 256×256,
effet appliqué au calque photo de fond posé par `openDocument`.

| cas | luminance moyenne | % de pixels noirs |
|---|---:|---:|
| aucun changement (`passthrough`) | 142,25 | 0 |
| **glow** — témoin, lit `color.rgb` | 170,22 | 0 |
| **posterize** — témoin, lit `color` | 131,52 | 8,89 |
| **warp** — lit `srcTexture` | **0** | **100** |
| **chromaticBleed** — lit `srcTexture` | **0** | **100** |

Les deux témoins sont ce qui rend cette mesure concluante : sur EXACTEMENT le même
montage, glow reste lumineux. Si les cinq lignes étaient noires, le harnais serait
en cause, pas les effets.

### Le mécanisme

`shaderCompose.ts:179-181` pose deux valeurs distinctes :

- `color` = `textureSample(srcTexture, …)` — le composite **en dessous** ;
- `effectInput` = `textureSample(coverageTexture, …)` dès que `hasImageSource`,
  passé à `fs_main(in.uv, effectInput)` comme second paramètre.

Le contrat est donc : **un effet lit son paramètre `color`**, jamais `srcTexture`.
`glow.ts:96` le respecte (`color.rgb + bloom * intensity`). `warp.ts:64` et
`chromaticBleed.ts:29-31` ne le respectent pas : ils rechargent `srcTexture`.

Sur le calque de fond, `srcTexture` part de `canvasTexture`, et depuis T1 la toile
est effacée en (0,0,0,0) et jamais uploadée (`imageFrameResources.ts`). Les taps
lisent donc du vide. Alpha composé = 1 : l'image ne devient pas transparente, elle
devient **noire opaque**.

### Pourquoi ce n'est pas une étourderie

Ces deux effets ont besoin d'échantillonner à des **UV décalés** — c'est leur
raison d'être. Le paramètre `color`, échantillon unique à `in.uv`, ne peut pas le
leur donner. Le contrat `fs_main(uv, color)` n'a jamais prévu l'échantillonnage
décalé de l'entrée d'effet. C'est un trou d'architecture, et il explique pourquoi
la pré-passe photo (`framePipelineExecutor.ts:404-410`), écrite pour glow, n'a
jamais couvert la passe finale.

### Ce qu'il ne faut PAS faire

Les deux réfutateurs ont mesuré les correctifs évidents et les refusent :

- Faire lire `coverageTexture` aux taps décalés produit un **liséré noir sur
  chaque bord de photo** dès que le réglage est non nul (~55 px aux coins sur une
  24 MP) : hors couverture la texture vaut 0, alors que l'alpha de sortie vient
  d'un `color.a` NON décalé.
- Un helper `sampleEffectInput(uv)` corrige les pixels mais pas le **poids** de
  compositing, qui reste pris à `in.uv` non déplacé (`shaderCompose.ts:115`) : sur
  une photo qui ne couvre pas toute la toile, la traînée de bord serait compositée
  à poids plein.

**Le correctif demande une décision d'architecture — il ne s'improvise pas.**

---

## 2. Les quatre autres HAUTE

**Le slider « Graine » du warp détruit le bruit** (`warp.ts:53` et `:16-20`).
`hash2` sature en f32 : au-delà de 2²³ l'ulp vaut 1, `fract()` rend 0 exactement,
et le gradient devient constant — le FBM dégénère en **grille régulière**, très
exactement ce que la barre de qualité interdit. Aux valeurs par défaut, 89 graines
sur 101 ont déjà au moins une octave morte ; à partir de seed=47 les trois le
sont. La référence versionnée `masque-pinceau-degrade` tourne à seed=2, donc déjà
dans la zone dégradée. Correctif sûr : remplacer `hash2`. Le palliatif consistant
à borner le décalage est refusé — il ferait produire au slider des quasi-doublons
au lieu de grilles, panne moins spectaculaire donc plus durable.

**Le grain culmine dans les ombres, pas dans les demi-tons** (`grain.ts:46-48`).
La pondération est perceptuelle, l'addition reste linéaire : écart-type mesuré à
intensité par défaut — ton 0,10 → 15,2/255 ; ton 0,50 → 7,1/255 ; ton 0,90 →
1,2/255. Le grain est 2,1× plus fort dans les ombres qu'au demi-ton et 13× plus
fort que dans les hautes lumières. Le commentaire `grain.ts:38` promet en toutes
lettres l'inverse : « peak in midtones, fades in deep shadows and highlights ».
Le code contredit son propre contrat écrit. Le correctif proposé fait bien ce
qu'il annonce (argmax ramené à 0,498, écrêtage noir de 17,5 % à 0 %) mais **inline
une troisième formule de transfert sRGB**, ce que `srgbTransfer.ts:19-21` interdit
explicitement : à réécrire en passant par la constante partagée.

**Deux fix proposés étaient dangereux** — et c'est un résultat en soi, pas un
détail de procédure. Pour posterize, quantifier sur l'axe perceptuel « comme les
trois autres effets tonaux » **éclaircit l'image de 27 points sRGB** à levels=2 et
multiplie par dix l'erreur de préservation de moyenne ; la formulation invitait à
l'appliquer mécaniquement en croyant suivre une convention, alors qu'aucun des
trois effets cités ne fait cet aller-retour. Pour glow, l'offset de bright-pass
proposé (±0,25 texel) est faux arithmétiquement : le centre du pixel destination
tombe déjà sur le coin des quatre texels, l'offset correct est ±0,5 — appliqué
tel quel, le shader compile, rend, change la référence pixel et ne fait PAS ce
qu'il annonce.

---

## 3. La barre de qualité, effet par effet

| effet | état | ce que le code montre |
|---|---|---|
| chromaticBleed | **upgrade présent** | Aberration réellement radiale : direction portée par `fromCenter`, magnitude en `dist^(1+falloff)`, sens opposé R/B, G non décalé. Le `angleDeg` de la version naïve a bien disparu. |
| glow | **partiel** | La chaîne dual-filter est là (5 passes, noyaux conservant l'énergie, composite en linéaire). Deux écarts : à l'upsample l'offset vaut 4× le canonique, ce qui fait du noyau une coquille sans tap central (~1 % du poids au centre) ; et la chaîne s'arrête à 1/8, donc le rayon est un nombre constant de pixels image au lieu de suivre la taille de la photo. |
| warp | **partiel** | Le FBM est réel (1 à 4 octaves d'un gradient noise d'Inigo Quilez, aucune sinusoïde). Il dégénère sur une grande part de l'espace de paramètres — voir la saturation de graine ci-dessus. |
| grain | **partiel** | La pondération par la luminance existe et est même posée sur l'axe perceptuel. Elle ne contrôle pas ce que l'œil voit, l'addition restant linéaire. |
| posterize | **partiel** | Le tramage Bayer est présent, câblé et verrouillé par test — ce n'est pas décoratif. Ce qui reste naïf est le PLACEMENT des paliers, répartis uniformément sur l'axe linéaire. |
| duotone | **non nommé** | La barre ne nomme rien pour lui. Mélange colorimétrique vérifié correct : décodage en linéaire avant tout mix, round-trip exact, `hsl2rgb` vérifié à la main sur les trois défauts. |

---

## 4. Ce qui ne se tranche pas dans le code

À regarder à l'œil, sur une vraie photo :

- **posterize** — l'aplat noir massif sous 39 % de clarté perçue est-il le look
  voulu d'un posterize graphique, ou un défaut ? Cet arbitrage commande le
  correctif, et le seul correctif proposé pour l'instant est celui mesuré comme
  dangereux. À regarder aussi à levels=2, le réglage où l'écart est le plus
  violent, et sur un aplat coloré saturé (le dither est achromatique).
- **glow** — l'anneau de la coquille d'upsample est réel pour une source
  ponctuelle, nul sur une source étendue. Sa visibilité finale n'est pas prouvée.
- **warp** — le repli du champ aux réglages extrêmes est peut-être une fin de
  course créative assumée (Photoshop Liquify replie aussi).
- **posterize + grain empilés** — deux structures fines peuvent battre l'une
  contre l'autre. Rien dans le code ne le dit.

## 5. Angle mort de l'outillage, à traiter avant tout correctif de pixels

> **RECTIFICATION du 2026-07-31, 00:40 — cette section était fausse.** Elle
> affirmait : « `npm run test:render` est **rouge 6/6 sur master depuis T1**,
> références jamais régénérées (`.claude/learning-log.md:1259`, revérifié). Le
> seul verrou qui regarde l'image PRODUITE ne garde donc rien aujourd'hui : tout
> correctif touchant les pixels partirait sans filet. C'est à réparer AVANT de
> toucher à un shader, pas après. »
>
> **Mesure.** Le harnais a été LANCÉ, sur `master@e0b6cd4`, app en CDP 9222 et
> Vite du worktree courant sur 1421 : **vert 10/10**, « Aucune régression de
> rendu », sortie 0. Les dix scénarios passent les trois étages (reproductibilité
> inter-passes à 0 canal, gate de signal, non-régression).
>
> **Témoin de discrimination**, exigé par `scripts/render-check.mjs:89-96` et
> sans lequel aucun verdict de ce script ne vaut : poids de luminance de
> `grain.ts:39` porté de `0.2126` à `0.2500`, harnais relancé → **FAIL sur
> `grain-graine-fixe` et lui seul** (écart max 18 > 1 LSB, sortie 1) ; témoin
> retiré → vert 10/10, arbre de travail propre. L'instrument attrape donc bien
> ce qu'il prétend garder, et le vert n'est pas un vert de panne.
>
> **Racine de l'erreur.** L'affirmation n'a jamais été mesurée : l'entrée de
> `.claude/learning-log.md` du 2026-07-31 qui la « reconfirme » l'écrit
> elle-même — « vérifié cette session en lisant le harnais et son en-tête, non
> en le relançant ». Une lecture d'en-tête a été prise pour une exécution, puis
> propagée dans ce rapport, dans `docs/INDEX.json` et dans le message du commit
> `8494b78`.
>
> **Ce que ça change.** Il n'y a pas de barrière : les correctifs de pixels
> (warp, grain, glow, posterize) ont leur filet dès maintenant. Ce qui reste
> vrai de la section d'origine, c'est l'exigence de témoin — un verrou vert ne
> vaut que planté-rougi-retiré, à refaire à chaque correctif.
