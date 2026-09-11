# 08 — Les pistes colorées des curseurs (Température bleu→jaune, HSL par bande…)

Type: task
Status: ready-for-human
Blocked by: — (05b calibration et 06 Color Grading LEVÉS, commités sur master : `141252d`, `242b612`, `71ca502`)

**What to build :** Antoine, 2026-09-11 : « on a pas les couleurs sur
"température" par exemple comme sur lightroom ». Chez Lightroom, la PISTE d'un
curseur de couleur est un dégradé qui montre ce que le curseur fait :

- `Température` : bleu → jaune. `Nuance` : vert → magenta.
- Mélangeur (HSL) Teinte : dégradé de la teinte de départ vers les deux
  voisines (ex. bande rouge : magenta → rouge → orange). Saturation : gris →
  couleur de la bande. Luminance : sombre → clair teinté de la bande.
- Color Grading Luminance : noir → blanc. Vibrance/Saturation : terne → vif
  (Lightroom les laisse neutres — vérifier sur la capture avant d'en mettre).
- Étalonnage : Teinte des primaires = dégradé entre les deux teintes extrêmes ;
  Saturation = gris → primaire.

## Mécanisme

- Un champ DÉCLARATIF sur le paramètre : `EffectParam.trackGradient?:
  { stops: string[] }` (couleurs CSS calculées PAR LE MODULE — pour HSL,
  dérivées des `rgb` de `hslBandes.ts` ; pour Température, les deux bouts
  perceptuels bleu/jaune) — rendu par `labeled-slider` (un fond en
  `linear-gradient`, le pouce par-dessus ; ⚠️ tokens : les couleurs de piste
  sont des DONNÉES du domaine, pas des tokens de design — `lint:tokens` ne
  doit pas les compter comme « valeur en dur qui contourne un token », vérifier
  sa règle et, si besoin, un commentaire de dérogation explicite comme il en
  existe déjà).
- La piste NEUTRE reste le défaut absolu : seuls les paramètres qui déclarent
  un dégradé en ont un. Les curseurs des EFFETS (panneau Propriétés) peuvent
  l'adopter là où c'est parlant (`duotone`, `gradientMap`, teintes de
  `colorGroup`) — dans un second temps, pas ce ticket.
- Stories : Température/Nuance, une bande HSL (teinte, sat, lum), un sans
  dégradé (le témoin visuel). `test-storybook` ENTIER.
- Capture CDP contre la référence `assets/reference-ui/lightroom-14.5-reglages-de-base-1x.png`
  (la piste Température y est lisible à l'échelle 1).

- [x] `trackGradient` déclaratif (`EffectParam.trackGradient`, `types.ts`) + rendu dans `labeled-slider` (piste seule via `background-image`, indicateur de remplissage neutralisé, pouce par-dessus). Couleurs = données du domaine dans `render/effects/trackGradients.ts`, exclu de `lint:tokens`.
- [x] Déclaré sur : Température, Nuance, **et Vibrance + Saturation** (module 02 — Lightroom les colore en arc-en-ciel, vérifié sur la capture ; la note « peut-être neutres » était fausse sur pièce) ; les 24 curseurs de bande HSL + 8 mélanges N&B (dérivés de `hslBandes.ts`) ; Étalonnage 6 (3 teintes + 3 saturations). Grading Luminance/Fusion/Balance **laissés NEUTRES** : la capture les montre en rampe grise sans chroma (le « noir → blanc » n'est pas ce que fait Lightroom — parité mesurée, réversible, voir rapport). Nuance foncée de l'étalonnage laissée neutre (scope de 6, aucune capture du panneau).
- [x] Stories (Température, Nuance, bande HSL teinte/sat/lum, témoin sans dégradé) + gates complets : `tsc`, `lint`, `lint:tokens` 0, `test` 2333, `test-storybook` 396, `test:render` **zéro écart sur 147** — rien de shader.
- [x] Capture côte à côte `assets/reference-ui/comparaison-08-pistes-colorees.png` (Température bleu→jaune, Nuance vert→magenta) — validation d'Antoine en attente.
