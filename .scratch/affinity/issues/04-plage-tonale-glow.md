# Plage tonale sur `glow`

Type: task
Status: open
Parent: ../map.md

## Le geste que ça débloque

Doser le halo SÉPARÉMENT dans les ombres, les tons moyens et les hautes
lumières. Aujourd'hui `glow` a un seuil unique (`threshold` + `knee`) : ce qui
dépasse brille, le reste non. On ne peut pas faire baver les hautes lumières
sans toucher aux tons moyens, ni poser un voile dans les ombres sans allumer
tout le reste.

## Ce qu'Affinity fait

`Bloom` : `ShadowBlend`/`ShadowValue`, `MidtoneBlend`/`MidtoneValue`,
`HighlightBlend`/`HighlightValue`, plus `Colour`/`ColourValue`, `Method`,
`Strong`. Trois plages, chacune avec son MÉLANGE et sa VALEUR.

⚠️ `Method` et `Strong` ne sont pas relevés — deux paramètres dont on ne sait
rien. Les REGARDER dans Affinity avant de croire qu'on a compris leur bloom.

## Pourquoi c'est peu cher chez nous

`EffectModule.tonalRangeControl` existe et sert déjà à `curves`
(`TonalRangeControl`, `TonalRangeType`). Le contrôle d'interface est écrit, le
type est là, le rendu du panneau le sait déjà.

## Contraintes du dépôt à respecter

- ⚠️ **`params[]` ne se réordonne JAMAIS** — les index sont persistés dans les
  presets. Les nouveaux paramètres vont à la FIN.
- Le défaut doit rendre `glow` **inchangé au bit près** : `npm run test:render`
  doit donner zéro écart sur les références existantes. C'est le gate
  discriminant — un écart prouverait qu'on a touché au chemin par défaut.
- `MAX_EFFECT_PARAMS` vaut 48 (`shaderCompose.ts`) — vérifier la marge.
- `test/render/effects/parametresCables.test.ts` vérifie que chaque paramètre
  déclaré est lu à SON index.
- Une applicabilité se MESURE : `node scripts/render-check.mjs --applicabilite`.

## Ce qui prouve que le ticket est fini

Une référence de pixels par plage, sur une mire qui a des ombres ET des hautes
lumières distinctes — **la mire commune ne le montrerait pas**, et un verrou
posé dessus verrouillerait du bruit (leçon `lensBlur`, 2026-08-01). Plus zéro
écart sur les références existantes de `glow`.
