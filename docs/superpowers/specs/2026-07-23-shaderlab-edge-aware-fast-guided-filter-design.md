# Fast Guided Filter sous-échantillonné + SAT pour le rayon edge-aware

## Objectif

Le filtre guidé edge-aware (`refineEdge.edgeAware`, source unique du bouton
« Accroché aux contours ») calcule ses moyennes de boîte via une boucle WGSL
dynamique `for (var k = -n; k <= n; k++)`
([edgeAwareWgsl.ts:83](../../../src/mask/edgeAwareWgsl.ts#L83)) où
`n = i32(radius)`. Coût O(radius) par pixel, répété sur 3 paires de passes
H+V (mean I/p, corr I²/Ip, mean a/b —
[maskTextureResolver.ts:785-826](../../../src/render/maskTextureResolver.ts#L785)).
`edgeRadius` va de 1 à 50
([MaskPanel.tsx:369-370](../../../src/components/MaskPanel.tsx#L369)) : à
50, chaque passe échantillonne 101 texels/pixel. Sur une photo réelle
(24MP documentés dans l'historique du projet), ça produit un lag visible en
drag et, dans au moins un cas observé en session, un `GPUDevice.lost`
(timeout TDR Windows probable sur une commande GPU trop longue).

Objectif : rendre le drag du slider « Rayon des contours » fluide même à
rayon 50 sur une photo 24MP, sans régresser la qualité ni le budget VRAM déjà
documenté comme sensible (crash OOM historique, bandeau `CLAUDE.md`).

## Décisions

- **Fast Guided Filter (He & Sun), pas le guided filter direct** : les
  statistiques (mean_I, mean_p, corr_I, corr_Ip, mean_a, mean_b) sont
  calculées sur un guide couleur **sous-échantillonné**, plafonné à ~2048px
  de long côté (downscale uniquement si la photo dépasse ce plafond — une
  petite image n'est jamais touchée). Les coefficients `a`/`b` sont ensuite
  upsamplés et recombinés avec le guide en **pleine résolution** :
  `q = upsample(mean_a) × I_full_res + upsample(mean_b)` — pas un upsample
  du résultat final, qui lisserait les contours à pleine résolution. C'est
  la technique publiée par les auteurs originaux du guided filter pour
  exactement ce problème de coût, pas une approximation maison.
- **SAT (summed-area table / image intégrale) pour les moyennes de boîte** :
  remplace la boucle O(radius) par une construction en ~22 passes fixes
  (Hillis-Steele, log2(largeur)+log2(hauteur) à 2048px) puis un lookup O(1)
  par pixel (4 échantillons coin) pour n'importe quel rayon. Le coût devient
  indépendant de la valeur du rayon.
- **Cache à deux niveaux, c'est le point qui rend le drag fluide** :
  - SAT de I/p/I²/Ip : keyed sur la révision du calque (le guide couleur),
    **pas sur `edgeRadius`/`edgeStrength`**. Un drag de rayon seul ne la
    reconstruit jamais.
  - SAT de a/b : reconstruite à chaque changement de rayon/force (ces
    coefficients en dépendent), mais son coût est les ~22 passes fixes
    ci-dessus, indépendant de la valeur du rayon — remplace le pire cas
    actuel (jusqu'à ~600 échantillons/pixel à rayon 50) par un coût
    constant, quel que soit le rayon choisi.
- **Mise à l'échelle du rayon** : le guide est réduit d'un facteur
  `s = min(1, 2048 / max(largeur, hauteur))`. Un rayon `edgeRadius` (en
  pixels de la photo originale) devient `radius' = edgeRadius * s` pixels
  dans l'espace réduit (ex. photo 6000px, s≈0.34, edgeRadius=50 →
  radius'≈17 dans le guide réduit — même flou perçu, calcul beaucoup moins
  cher). Garde `max(radius', 1.0)` (1 texel du guide réduit, valeur plancher
  d'un rayon de boîte non-dégénéré) pour éviter un rayon nul (lookup SAT
  identité incorrect) quand `edgeRadius` est petit et `s` très réduit.
- **Format des SAT : `rg32float`, pas `rg16float`** : une SAT accumule des
  sommes sur jusqu'à ~2,8M pixels (2048×1365) ; `rg16float` plafonne à
  65504, largement dépassé — un débordement silencieux corromprait tout le
  filtre à grande échelle sans erreur visible.
- **Budget VRAM chiffré** (plafonné par le downscale, indépendant de la
  taille de la photo source) : à 2048×1365, chaque SAT `rg32float`
  (8 octets/pixel) ≈ 22 Mo. Trois SAT (I/p, I²/Ip, a/b) ≈ 66 Mo en régime
  établi, plus un ping-pong transitoire pendant la construction Hillis-
  Steele (double temporairement la table en cours) → pic ≈ 120 Mo. Très
  loin du ~1 Go+ qu'aurait coûté une SAT en pleine résolution 24MP — c'est
  cette contrainte VRAM qui a motivé le sous-échantillonnage plutôt qu'une
  SAT pleine résolution.
- **Coût CPU négligeable** : tout le travail reste GPU (passes de rendu) ;
  le CPU émet seulement ~50 commandes d'encodeur par reconstruction de SAT
  a/b (même ordre de grandeur que les passes déjà émises aujourd'hui pour
  refine/edge), pas de boucle JS sur les pixels.

## Architecture cible (module map)

```
src/mask/edgeAwareWgsl.ts
  Nouvelles fonctions : buildDownsampleWgsl() (box average simple),
  buildSatScanHWgsl()/buildSatScanVWgsl() (un pas Hillis-Steele,
  paramétré par l'offset de décalage — appelé log2(n) fois), remplace
  boxFilterWgsl()/buildBoxFilterHWgsl()/buildBoxFilterVWgsl() (supprimées,
  plus aucun appelant après ce chantier). buildSatLookupWgsl() : lookup O(1)
  via 4 échantillons coin de la SAT, pour une moyenne de boîte de rayon
  quelconque. buildUpsampleCombineWgsl() : upsample bilinéaire de mean_a/
  mean_b + combinaison avec le guide PLEINE résolution (q = a*I + b).

src/render/maskTextureResolver.ts
  edgePipeline() réécrit : downsample → luminance/pack (résolution
  réduite) → SAT(I,p) + SAT(I²,Ip) [cache keyed sur revision(id) seul] →
  lookup O(1) mean_I/mean_p/corr → calcul a/b (pointwise, O(1), inchangé)
  → SAT(a,b) [cache keyed sur revision+edgeRadius+edgeStrength, comme
  aujourd'hui] → lookup O(1) mean_a/mean_b → upsample+combine en pleine
  résolution. `edgeAwareWorkTextures` gagne un champ séparé pour le cache
  du premier SAT (guide) et le second (a/b), au lieu d'un seul état
  `lastRevision/lastRadius/lastStrength` fusionné comme aujourd'hui.
```

Les deux fichiers gardent leurs responsabilités actuelles : `edgeAwareWgsl.ts`
ne connaît que du WGSL générateur, `maskTextureResolver.ts` orchestre le cache
et l'enchaînement de passes — aucun autre module (renderer, App.tsx, MaskPanel)
n'est touché, l'interface publique (`edgePipeline` appelé depuis `edge()`)
reste identique.

## Hors scope

- Toute autre partie du pipeline de masque (`refine()` feather/contract/
  smooth, le fold multi-sources, les sources gradient/luminosity/colorRange
  elles-mêmes) — ce chantier ne touche que le sous-système edge-aware.
- Rendre le plafond de résolution (2048px) configurable par l'utilisateur —
  constante fixe pour l'instant, à revisiter si un besoin réel apparaît
  (YAGNI).
- Optimiser `edgeStrength` séparément — déjà O(1) par pixel (terme
  ponctuel dans le calcul de `a`), jamais la source du problème.
- Investiguer d'autres causes possibles de `GPUDevice.lost` (VRAM globale
  du document, autres passes) — ce chantier élimine la cause la plus
  probable identifiée (boucle O(radius) sans plafond), pas une garantie
  qu'aucune autre source de device-lost n'existe.

## Testing

- Tests unitaires Node (pattern existant `maskTextureResolver.test.ts`,
  fake GPU device, assertions sur comptes de passes/copies) :
  - La SAT du guide (I/p/I²/Ip) n'est **pas** reconstruite quand seul
    `edgeRadius` change entre deux `resolve()` (régression inverse du bug
    corrigé cette session) — assertion sur le nombre de passes attribuable
    à la reconstruction du guide, doit rester à zéro delta.
  - La SAT a/b **est** reconstruite quand `edgeRadius` ou `edgeStrength`
    change.
  - Rayon très petit après mise à l'échelle (`edgeRadius=1` sur une image
    fortement downscalée) ne produit pas de NaN/lookup dégénéré — testable
    via l'assertion existante sur le nombre de passes (pas de branche
    d'erreur qui court-circuiterait le pipeline).
- Rendu GPU réel (qualité visuelle inchangée à rayon fixe, fluidité perçue
  en drag à rayon 50 sur une image ~24MP) : checkpoint visuel humain sur la
  vraie fenêtre WebView2 (CDP) — moyen de preuve déclaré du projet, aucun
  test automatisé ne peut valider le rendu WebGPU lui-même.

## Validation

- `npx tsc --noEmit` et `npm run test` verts.
- Comparaison visuelle qualité à rayon fixe (ex. 15) entre avant/après —
  le résultat doit rester visuellement équivalent (léger flou de
  sous-échantillonnage attendu et acceptable, pas de différence
  perceptible à l'œil sur un flou de lissage).
- Drag du slider « Rayon des contours » de 1 à 50 sur l'image de test
  ~24MP : pas de lag perceptible, pas de `GPUDevice.lost`.
- Aucune régression sur les tests de cache existants (`refine()`,
  fold multi-sources, invert/enabled — tous les tests
  `maskTextureResolver.test.ts` actuels restent verts).
