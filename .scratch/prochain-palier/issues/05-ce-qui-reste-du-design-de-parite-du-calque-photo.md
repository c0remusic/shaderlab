# Ce qui reste du design de parité du calque photo

Type: grilling
Status: open
Parent: ../map.md

## Question

Le ROADMAP dit du recadrage qu'il « ne dépend d'aucun arbitrage » et qu'il est
« le SEUL item prêt à coder ». **C'est faux, et la mesure du 2026-08-11 le
montre** : son design existe bien
(`docs/superpowers/specs/2026-07-26-shaderlab-photo-layer-parity-design.md`
§3.1, modèle complet avec justifications), mais le modèle sur lequel il
s'appuie a bougé sous lui.

Ce que le design §3.1 spécifiait, et ce qui est sur disque le 2026-08-11 :

| Design §3.1 (2026-07-26) | Sur disque |
| --- | --- |
| `scale: number` — « inchangé, UNIFORME » | **`scaleX` / `scaleY`** (deux échelles, 2026-07-31) |
| `flipX?: boolean` / `flipY?: boolean` | **absents** |
| `crop?: CropRect` | **absent** |
| `resolveCrop(t, photoSize)` | **absent** |
| `name?: string` | à vérifier |

Le design avait prévu sa propre réouverture, mot pour mot : « *Réouverture :
l'utilisateur demande un étirement non uniforme → alors `scaleX`/`scaleY`
signés et le flip devient le signe.* » **Elle s'est déclenchée à moitié.** Les
deux échelles sont arrivées le 2026-07-31 — mais `clampTransformScale`
(`src/ui/transform.ts:125-127`) les borne au POSITIF
(`scale > MIN_TRANSFORM_SCALE ? scale : MIN_TRANSFORM_SCALE`). Le signe ne
peut donc pas porter le flip, et les booléens n'ont pas été écrits non plus :
**le miroir est tombé entre les deux**, sans que rien ne rougisse.

**Que reste-t-il de valide dans ce design, et le recadrage se code-t-il tel
qu'il est écrit ?**

## Ce qu'il faut interroger

- **Le crop survit-il au passage à deux échelles ?** Sa justification
  (« en PIXELS source et pas en UV ») invoquait l'invariant entier
  `0 ≤ x`, `x + width ≤ photoWidth` — indépendant du nombre d'échelles, donc
  probablement intact. Mais `x`/`y` du transform sont définis comme « centre
  de la BOÎTE VISIBLE (= centre du crop) » : cette identité a-t-elle survécu
  à `scaleX`/`scaleY` ? À vérifier sur pièce, pas à supposer.
- **Le miroir : booléens ou échelles signées ?** La réouverture nommée par le
  design dit « signées ». Mais `clampTransformScale` existe pour empêcher une
  division par zéro produisant des UV NaN côté GPU — cas documenté comme
  ATTEIGNABLE par import de preset (`photoLayerInput.ts:133-137`). Autoriser
  le signe demande de rendre cette garde bilatérale sans rouvrir le NaN.
- **Le miroir est-il seulement demandé ?** Personne ne l'a réclamé depuis le
  2026-07-26. Une sortie de portée est une réponse valide.
- **Le nom de calque (`name?`)** — livré ou non ? Même mesure, même méthode.
- **Ce design n'est PAS dans `docs/INDEX.json`** (zéro occurrence, vérifié)
  alors qu'il est cité par `CONTEXT.md`, `PRD.md`, `photoLayer.ts`,
  `types.ts`, `photoSourceStore.ts`, `canvasMode.ts` et deux autres specs.
  Un document porteur que l'index de statut ignore. À réparer dans le même
  geste que la décision, pas en rattrapage.

## Contraintes dures

- Le geste touche **`LayerState`**, la couche la plus partagée du projet
  (`render/`, `mask/`, `export/`, `components/`, `application/`) : le plan
  s'écrit avant la première ligne.
- `crop` est **optionnel** par construction dans le design — aucune migration
  de l'historique de session ni des presets, aucune fixture à réécrire. Ne pas
  perdre cette propriété en le rendant obligatoire.
- `ui/tools.ts:18-28` garde l'outil hors de la palette et **dit pourquoi** :
  « un bouton qui ferait entrer dans un mode sans géométrie derrière serait un
  bouton qui ment ». Le bouton arrive avec la géométrie, pas avant.

## Ce que ce ticket ne tranche PAS

Le plan d'exécution lui-même. Il est en brouillard tant que le modèle n'est
pas confirmé — noté dans **Not yet specified** de la carte, il graduera après.
