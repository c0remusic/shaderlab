# Le troisième canal de la pyramide — posé, et mesuré avant d'être lu

Status: ready-for-agent
Type: research

Mesuré le 2026-09-18. Instruments : `assets/sonde-canal-detail.mjs`,
`assets/lire-canal.py`, `assets/compile-detour.mjs`. Mire
`shaderlab-mire-portee-2048x16384.jpg` (zones PORTÉE et PORTAIL).

[`07-portee-des-operateurs-locaux.md`](07-portee-des-operateurs-locaux.md)
conclut que notre Clarté est un opérateur de **différence de TON** quand celle de
Lightroom est pilotée par la **PRÉSENCE DE DÉTAIL** — 0,00 chez nous contre −10
chez eux sur une marche de détail à ton constant. Il spécifie la grandeur
manquante et la façon de la produire :

> une passe posée juste après l'exposée émettrait `(luminance, y, sqrt(variance))`,
> et la section profonde la moyennerait comme les deux autres

## Ce qui est posé

Le premier niveau de la pyramide émet désormais un **troisième canal :
l'écart-type local de `y = sqrt(luminance)`**, sur le support de sa tente 3×3.

Il ne coûte **rien** : `m.x` est déjà `E[l]`, et `y²` EST `l`, donc `E[y²] = m.x`
et la variance vaut `m.x − m.y²`. Aucun prélèvement, aucune passe, aucun canal de
plus — le bleu était écrit à `0.0`. Les niveaux suivants portent déjà `.rgb`,
donc la descente le moyenne comme les deux autres sans une ligne de plus.

⚠️ **L'ÉCART-TYPE et pas la variance, et ce n'est pas cosmétique** : les cibles
de passe sont en **8 bits sRGB** (`srgbFormat` du runner). Une variance de
matière vaut ~0,015 et tomberait sur deux ou trois niveaux ; son écart-type vaut
~0,12, et l'encodage sRGB serre justement ses pas près de zéro, là où cette
grandeur vit.

**`npm run test:render` : aucun écart sur les 156 références.** Personne ne lit
encore ce canal, donc la pose est bit-exacte — c'est le gate discriminant.

## Ce qu'il porte, mesuré

Détour de la sortie de la passe finale vers chaque canal, sur la mire de portée,
Clarté 60 (pour réveiller la pyramide). Moyenne d'une bande centrale, par ligne.

| zone | `r` (luma floutée) | `g` (y flouté) | **`b` (DÉTAIL)** |
|---|---|---|---|
| PORTÉE réseau 96 | 98 | 158 | **49** |
| PORTÉE réseau 160 | 161 | 203 | **51** |
| PORTAIL aplat 128 | 128 | 181 | **0** |
| PORTAIL réseau 128 | 130 | 182 | **50** |

**La zone PORTAIL est la mesure qui compte** : même ton des deux côtés, donc tout
ce qui y bouge vient du détail et de rien d'autre. Le canal y passe de **0,00 à
50** — il sépare exactement ce qu'on lui demande de séparer. Et il rend la même
valeur (49 · 51 · 50) sur les trois réseaux quel que soit leur ton : c'est une
mesure de matière, pas de luminosité.

Le témoin (sortie = `color`) rend bien l'image (96 · 160 · 128, amplitude 44), et
les canaux `r` et `g` ont une amplitude horizontale de **0,00** sur un réseau fin
— la pyramide floute, comme attendu.

## Ce qui manque encore : la PROFONDEUR

| y | 11 904 | 12 032 | 12 160 | 12 288 | 12 416 |
|---|---|---|---|---|---|
| canal `b` | 0,00 | 0,00 | 4,84 | 48,53 | 50,00 |

La transition se fait en **~200 px**. C'est la portée de la pyramide actuelle, et
c'est trois ordres de grandeur trop court : Lightroom déplace la moitié PLATE du
portail de −9,90 à −12,36 sur toute son étendue, soit une influence du détail qui
porte à plusieurs milliers de pixels (07, § zone PORTAIL).

Le canal est donc **juste et trop local**. Il lui faut une section profonde — et
c'est exactement ce que le mécanisme `expose` (`adaf712`) sait porter : une passe
interne exposée en `auxPass`, lue par la passe finale à côté de `prevPass`. La
pyramide actuelle reste pour Texture, qui a besoin de CETTE profondeur-là.

## Deux pièges d'instrument payés, et aucun ne se voit au rendu

**1. Le module se prend dans le REGISTRE, jamais par un `import()` nu.** Vite
suffixe l'URL d'un fichier ÉDITÉ dans la session (`?t=...`). Un import par chemin
nu rend alors une **seconde instance** du module, qu'on peut muter tout son saoul
sans que le moteur la voie. Symptôme : la sonde rendait exactement le ton de la
source, ce qui se lisait comme « la pyramide est sautée ». Trouvé en comparant
les deux références (`developApplyOrder.find(...) === reglagesDeBase` → **false**),
pas en relisant le shader. ⚠️ Corollaire : l'ablation de `grain`
(`.scratch/optimisation/02`) n'a PAS ce défaut — ce fichier-là n'avait pas été
édité, donc pas de suffixe et une seule instance. Le piège n'apparaît qu'après
une édition.

**2. Le détour se pose sur le RETOUR FINAL, jamais en cours de fonction.** Un
`return` anticipé, même sous une condition toujours vraie, rend tout ce qui suit
du **flot non uniforme**, et WGSL y interdit `textureSample`. Le compilateur le
dit mot pour mot :

```
error: 'textureSample' must only be called from uniform control flow
  return sqrt(max(dot(textureSample(srcTexture, srcSampler, uv).rgb, RB_LUMA), 0.0));
note: called indirectly by 'rb_fine_stats' from 'fs_main'
```

⚠️ **Et le rendu, lui, ne dit RIEN : il sort du BLANC.** Sept détours différents
ont rendu `255,255,255,255` — y compris celui qui renvoyait `color` tel quel, ce
qui aurait dû rendre l'image inchangée. C'est ce témoin-là qui a prouvé que le
problème n'était pas la valeur mesurée mais la compilation. La cause s'est lue
par `getCompilationInfo()`, jamais par l'image.

**Un shader qui ne compile pas rend du blanc, en silence** — ni exception, ni
log, ni pixel qui trahisse la panne. Toute sonde qui mute un corps WGSL doit
donc porter un témoin qui renvoie `color` : s'il ne rend pas l'image, aucune
autre colonne ne mesure quoi que ce soit.

## Ce qui reste à faire

1. Une section profonde (1/32, 1/64, …) dont le dernier niveau est **exposé**
   en `auxPass`. Le mécanisme existe et n'a pas encore de client.
2. Réécrire Clarté à partir de `auxPass.b` (présence de détail au grand rayon) au
   lieu de `lp − blurLuma` (différence de ton).
3. Ajuster sur les **quatre jeux de mesures qui existent déjà** : mire bi-tonale
   (aucun détail → zéro), zone PORTAIL (détail d'un seul côté), zone PORTÉE
   (détail partout, marche de ton), aplats de la mire de présence.
4. Le portail de Texture (`08-le-portail-de-texture.md`) est le second client de
   la même section profonde — à instruire après, pas en même temps.
