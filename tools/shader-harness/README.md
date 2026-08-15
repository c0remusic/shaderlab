# Harnais de shader — itérer sur une fonction de matière sans lancer shaderlab

## Pourquoi

Changer une fonction de matière de `glass` dans shaderlab veut dire : éditer le
TS, attendre le HMR, recharger la page, rouvrir une photo, reposer le calque,
choisir la matière, regarder. Une vingtaine de secondes par essai, et six actions
qui peuvent rater.

Ces fonctions sont des **maths pures sur `q`** — aucun échantillonnage de
texture, aucun binding. Elles tournent donc telles quelles dans n'importe quel
playground WGSL, avec un rechargement à l'enregistrement.

## L'outil

[shadplay](https://github.com/alphastrata/shadplay) (MIT, Bevy, **Rust
nightly**). Cloné et construit dans `tools/shadplay/`, **gitignoré** : 3,2 Go
dont 3 de `target/`, entièrement reconstructible.

```bash
rustup toolchain install nightly
git clone --depth 1 https://github.com/alphastrata/shadplay.git tools/shadplay
cd tools/shadplay && cargo build --release
```

## Usage

```bash
cp tools/shader-harness/glass-pave.wgsl tools/shadplay/assets/shaders/myshader.wgsl
tools/shadplay/target/release/shadplay.exe
```

`myshader.wgsl` est la cible de rechargement par défaut ; un glisser-déposer du
fichier dans la fenêtre marche aussi. Les réglages sont des **constantes en tête
de fichier** (`MATIERE`, `BISEAU`, `INTERNE`, `CELLULES`, `AFFICHAGE`) — pas de
curseur, on édite et on enregistre.

⚠️ **Le harnais est la SOURCE, le clone est jetable.** Éditer dans
`tools/shadplay/assets/` et oublier de reporter ici perd le travail au prochain
nettoyage.

## Ce qu'il montre

`glass-pave.wgsl` — champ de hauteur et pente des cinq matières Pavé, avec les
fonctions copiées de `src/render/effects/glass.ts` et `hash.ts`.

- `AFFICHAGE = 0` — la hauteur en gris.
- `AFFICHAGE = 1` — la **pente signée** en couleur : rouge/cyan sur x,
  vert/magenta sur y, gris moyen quand la pente est nulle. Les zones plates se
  lisent d'un coup d'œil, ce qu'un rendu de verre ne montre jamais directement.

La pente y est calculée **en différences finies**, comme en production. C'est
délibéré : c'est ce chemin-là qu'un essai d'optimisation voudrait remplacer, et
le comparer se fait sur des IMAGES côte à côte, pas sur des formules.

## Valider avant de lancer

`naga` valide du WGSL sans GPU, mais ne connaît pas le préprocesseur de Bevy :
remplacer d'abord la ligne `#import bevy_pbr::forward_io::VertexOutput` par un
`struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv:
vec2<f32> };`, puis `naga fichier.wgsl`.

## Limite à connaître

Ce harnais montre la **géométrie de surface**, pas le rendu final — ni
réfraction, ni dispersion, ni Fresnel, ni absorption. Une pente correcte ici ne
dit pas que le verre est beau dans l'app. C'est un instrument de mise au point,
pas un moyen de preuve : le jugement reste devant shaderlab, et le verrou de
pixels reste `npm run test:render`.
