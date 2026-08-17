# Ce qui reste du design de parité du calque photo

Type: grilling
Status: resolved
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

---

## Answer — RÉSOLU le 2026-08-18

**Le modèle est confirmé, et le design §3.1 reste écrivable — moyennant trois
corrections nommées.** Deux arbitrages d'Antoine, et un défaut muet trouvé en
mesurant.

### 1. Ce que la mesure a corrigé dans l'énoncé de ce ticket

La table du ticket était juste sur trois lignes et périmée sur deux :

| Design §3.1 (07-26) | Ticket (08-11) | Disque (08-18) |
| --- | --- | --- |
| `scale` uniforme, > 0 | `scaleX`/`scaleY` | ✅ `types.ts:45-46`, clampés positifs `transform.ts:125-127` |
| `flipX?`/`flipY?` | absents | ✅ absents, zéro occurrence réelle |
| `crop?` sur `LayerTransform` | absent | ✅ absent, `types.ts:42-48` |
| `resolveCrop` | absent | ✅ absent |
| `name?: string` | « à vérifier » | ❌ **LIVRÉ** en T1, `types.ts:76` |
| pas dans `INDEX.json` | « zéro occurrence, vérifié » | ❌ **PÉRIMÉ**, entrée présente depuis le 08-13 |

Ce que le crop a déjà, et qui n'est PAS rien : `CropRect` (`types.ts:17`), la
variante `CanvasMode.crop` avec `enterCrop` et son garde `reconcileCanvasMode`
(`canvasMode.ts:29,42,87`), et la garde qui tient l'outil hors palette en
disant pourquoi (`tools.ts:23`). Le design montage du 2026-07-29 §3.3 avait
déjà pesé cet échafaudage, et sa phrase reste la bonne : **« ce qui manque au
crop n'est pas le point d'entrée UI, c'est le point d'entrée UI ET toute la
géométrie ET son transport jusqu'au shader »**. Un squelette d'état n'est pas
une avance prise.

### 2. Ce que l'énoncé ne voyait pas : la tranche T3 n'a JAMAIS été livrée

Le ticket a lu « le miroir est tombé entre les deux ». Ce n'est pas le miroir
qui est tombé, c'est **toute la tranche qui le portait**, et elle portait quatre
livrables dont trois n'ont aucun rapport avec le miroir :

| Livrable T3 | Sur disque |
| --- | --- |
| `transformsEqual` (égalité structurelle, `crop` champ par champ) | **0 occurrence.** La comparaison énumérée vit toujours (`usePhotoLayer.ts:273`), sur 5 champs SCALAIRES |
| `clone()` recopie `transform` et son `crop` | **NON.** `layerStack.ts:653-668` copie `params` et `mask`, pas `transform` |
| Suppression d'`updateLayerTransform` (code mort) | **NON.** `layerStack.ts:394`, toujours **zéro appelant de production**, entretenu par 5 tests |
| Struct d'uniform `PhotoInputParams` + `PHOTO_INVERSE_TRANSFORM_WGSL` + `scripts/gpu-parity.mjs` | **0 occurrence.** L'uniform est `array<f32, 10>`, 10ᵉ slot en remplissage (`photoLayerInput.ts:192`) |

Conséquence directe : **le ROADMAP se trompait deux fois.** Le recadrage ne
dépend pas « d'aucun arbitrage » — il dépend de celui-ci ET d'une tranche
entière jamais construite. Les trois premiers livrables ci-dessus sont le vrai
prérequis de T4, et ils survivent quel que soit le sort du miroir :

- **`transformsEqual`** est indispensable au crop et INUTILE au miroir. Un crop
  est un objet imbriqué ; la comparaison énumérée n'en voit rien, donc valider
  un crop ne produirait **aucune entrée d'undo**. Un changement de SIGNE sur
  `scaleX`, lui, est bien attrapé par la comparaison actuelle.
- **`clone()` recopie `transform`** : latent aujourd'hui (les deux écrivains
  remplacent l'objet entier), actif dès que huit poignées de crop invitent à
  muter `transform.crop.width` en place — une mutation réécrirait le crop dans
  chaque snapshot déjà empilé, et l'undo ramènerait le crop courant. Le patron
  existe déjà DANS LE MÊME FICHIER : `duplicateLayer` fait
  `{ ...source.transform }`. C'est `clone()` seul qui manque.
- **`updateLayerTransform`** : mort, et son `paramsEqual` fait `Object.is` par
  valeur — deux `crop` structurellement identiques y seraient toujours
  « différents », donc une entrée d'historique par frame de drag pour quiconque
  le rebrancherait.

La struct d'uniform, elle, n'est **pas** obligatoire : `array<f32, 10>` porte
déjà un slot de remplissage, et le crop demande 4 flottants (→ 14). C'est une
décision de plan, pas un arbitrage.

### 3. Arbitrage d'Antoine — LES DEUX recadrages, gestes distincts

Question posée : le design §3.1 pose `crop` sur `LayerTransform`, donc il rogne
**un calque**, sans jamais toucher au format de la toile — alors que le ROADMAP
appelle le recadrage « le dernier trou fonctionnel de l'app », ce qui se lit
comme le geste qui change le format du document.

**Réponse : les deux, gestes distincts.**

Le geste TOILE **n'est pas dans ce ticket** et n'a jamais été dans §3.1 : il est
cadré dans le design montage du 2026-07-29 §9, différé avec son déclencheur
nommé — « Antoine commence un montage puis demande à en changer le format sans
repartir de zéro ». Antoine vient de le déclencher. Sorti en
[ticket 28](28-recadrer-la-toile-deja-ouverte.md), avec son blocage : le design
pose lui-même que **la première décision n'est pas technique, c'est le sort des
masques déjà peints**.

⚠️ Au passage, une note du design montage §9 est désormais **caduque** : « le
pinceau de masque couvre déjà ce besoin de façon approximative, ce qui explique
probablement que le crop n'ait jamais été réclamé ». Il vient d'être réclamé.

### 4. Arbitrage d'Antoine — LE MIROIR RESTE, en échelles SIGNÉES

C'est la réouverture que le design nommait mot pour mot (« *l'utilisateur
demande un étirement non uniforme → alors `scaleX`/`scaleY` signés et le flip
devient le signe* »). Elle s'était déclenchée à moitié le 2026-07-31 ; elle est
maintenant entière.

**Le design chiffrait le signé comme PLUS CHER que les booléens. Mesuré, le
solde s'inverse.** Ses trois objections, reprises une par une :

- **(a) « le verrouillage de ratio devient conventionnel au lieu de
  structurel »** — **VRAI, et à reprendre.** `constrainRatio`
  (`transform.ts:421-431`) calcule `ratio = scaleY / scaleX` et garde
  `current.scaleX > 0 ? … : 0`. Sur des signes mixtes, le ratio devient négatif
  et les deux mesures de changement tombent à zéro.
- **(b) « obligerait à réécrire `clampTransformScale` »** — **VRAI, et c'est
  trois lignes.** Clamper la MAGNITUDE en conservant le signe garde la division
  par zéro fermée (le cas que `photoLayerInput.ts:185-189` documente comme
  atteignable par import de preset). Détail à ne pas rater : tester `scale < 0`
  et non `Math.sign`, sinon zéro perd son signe ; et `NaN` retombe sur `+MIN`
  comme aujourd'hui, `Math.abs(NaN) > MIN` étant faux. Le témoin actuel
  (`test/ui/transform.test.ts:30`, `clampTransformScale(-3) === MIN`) est
  l'assertion exacte du contrat qui change — elle se réécrit délibérément.
- **(c) « le champ échelle % afficherait un nombre signé »** — **VRAI, et PIRE
  que décrit.** Le champ ne s'appelle plus « Échelle X » : il s'appelle
  **« Largeur »** (`PhotoPanel.tsx:139-149`, deux champs depuis les deux axes),
  donc il afficherait une **largeur de −100 %**. Résolution : le champ affiche
  la magnitude, les boutons Miroir portent le signe.

**Ce que le design ne comptait pas, et qui renverse le solde : le signé supprime
la branche de flip, CPU ET WGSL.** L'inverse-transform divise déjà par
l'échelle (`photoLayerInput.ts:46-47`, `transform.ts:152-153`) — une échelle
négative miroite l'échantillonnage pour rien. T3 promettait « branche de flip
CPU **et** WGSL », plus l'extraction de `PHOTO_INVERSE_TRANSFORM_WGSL`, ses
assertions ligne à ligne, et le harnais `scripts/gpu-parity.mjs`. **Le signé
efface ce livrable entier** — c'est-à-dire la partie que le design classait
« WGSL — risqué ».

### 5. ⚠️ Le défaut MUET du signé, trouvé en mesurant

Un seul site du WGSL casse, et il ne le dit pas. Le feather de couverture
multiplie une **distance** par l'échelle (`photoLayerInput.ts:80-84`) :

```wgsl
let edgeDistScreen = min(
  min(photoPx, photoWidth - photoPx) * scaleX,
  min(photoPy, photoHeight - photoPy) * scaleY
);
let coverage = clamp(edgeDistScreen + 0.5, 0.0, 1.0);
```

⚠️ **Première rédaction de ce paragraphe : « le calque miroité disparaît
entièrement ». FAUX, et Antoine a demandé la vérification qui l'a renversée.**
La formule a été repliée en Node, aux mêmes expressions, à `scaleX = -1` :

| point échantillonné | couverture à `scaleX = +1` | à `scaleX = -1` |
| --- | --- | --- |
| centre de la photo | 1,000 | **0,000** |
| 1 px à l'intérieur du bord | 1,000 | **0,000** |
| pile sur le bord | 0,500 | 0,500 |
| 10 px À L'EXTÉRIEUR | 0,000 | **1,000** |
| coin de la toile | 0,000 | 0,000 |

Ce n'est pas une disparition, c'est une **INVERSION de l'alpha sur l'axe
miroité** : un trou à la place de l'image, et une bande opaque à côté d'elle.
C'est PIRE qu'une disparition — un trou se voit comme un bug et fait chercher,
une bande de pixels faux se regarde comme un rendu. Le coin de la toile retombe
à 0 parce que le terme en Y, resté positif, domine le `min` : le défaut est donc
**borné à l'axe miroité**, jamais global.

Correction d'un mot — `abs(scaleX)` / `abs(scaleY)` : le feather veut une
magnitude, jamais un signe. Inventaire complet des usages d'échelle dans ce
shader, il n'y en a pas d'autres : **lignes 46-47 (division — veut le signe)** et
**lignes 81-82 (feather — veut la magnitude)**.

**Aucun test ne l'aurait attrapé.** Les références de pixels ne miroitent rien,
puisque le miroir n'existe pas — un test compare à ce qui existe, jamais à ce
qui serait possible. Conséquence opposable, sur la règle du dépôt (§ Moyen de
preuve — EFFETS) : **la référence de pixels du miroir se pose AVANT le geste,
pas après**, et sa mire doit montrer un BORD de photo ET quelques pixels
AUTOUR — une mire cadrée sur l'image seule verrait le trou mais pas la bande,
et c'est la bande qui est le vrai piège.

⚠️ **Le compte de références que citaient les docs est périmé, dans les deux
sens.** Mesuré le 2026-08-18 : `render-check.mjs` déclare **98 scénarios**, et
`test/render-refs/` porte **102 PNG**. `CLAUDE.md:511` dit « 97 », le ROADMAP et
cette carte disent « 77 ». L'écart de 4 n'est pas du bruit : quatre PNG sont
ORPHELINS (`effet-dither-bayer-fin`, `-bruit-blanc`, `-lignes`, `-points`) —
des références qu'aucun scénario ne compare, donc du poids mort qui se lit comme
de la couverture. Sorti en tâche à part.

### 6. Ce qui reste valide de §3.1, une fois tout mesuré

- **Crop en pixels source, pas en UV** — sa justification est l'invariant entier
  (`0 ≤ x`, `x + width ≤ photoWidth`), indépendant du nombre d'échelles.
  **Intacte.**
- **Champs optionnels, aucune migration** — intacte, et c'est la propriété que
  le ticket demandait de ne pas perdre.
- **`resolveCrop` comme résolveur unique** (personne ne lit `transform.crop`
  directement) — intacte.
- **Ancre au centre du crop + compensation au commit** — l'argument tient sans
  rien devoir au nombre d'échelles : ancrer sur le centre de la photo casserait
  la rotation autour du centre visible, casserait « Centrer », et forcerait un
  décalage permanent dans `computeHandleGeometry`. **Intacte** — c'était la
  question explicite du ticket, et la réponse est oui.
  ⚠️ **MAIS la formule écrite est fausse à deux échelles.** Le design écrit
  `x' = t.x + t.scale * (d.x·cos − d.y·sin)`. Avec `scaleX ≠ scaleY`, il faut
  mettre à l'échelle **par axe AVANT la rotation** — `d.x·scaleX`, `d.y·scaleY`,
  puis rotation. Recopiée telle quelle, elle ferait sauter le sujet dès qu'une
  photo est étirée, c'est-à-dire exactement le saut que §3.1 existe pour
  empêcher.
- **Conséquence géométrique** (boîte et poignées dimensionnées sur le crop, pas
  sur la photo) — intacte, et elle touche `computeHandleGeometry`,
  `scaledCornerOffset`, `scaledEdgeOffset`.

### 7. Deux décisions de COMPORTEMENT, laissées au plan

Ni l'une ni l'autre n'est un arbitrage bloquant ; les deux doivent être écrites
avant la première ligne, avec leur raison :

- **Tirer une poignée AU-DELÀ de son ancre : miroite-t-il ?** Le code prend
  `Math.abs` **délibérément** (`transform.ts:374-392` : « traverser l'ancre
  pendant le drag ne peut ni retourner la box ni produire de discontinuité »).
  Recommandation conservatrice : le drag garde la MAGNITUDE et **reporte le
  signe courant** ; seuls les boutons Miroir changent le signe. On garde
  l'invariant de continuité, et le miroir reste un geste explicite.
- **`resetTransform` / `fitToCanvas` / `coverCanvas` posent des échelles
  positives** (`transform.ts:182,225,269-276`) : en l'état, « Ajuster à la
  toile » **dé-miroiterait en silence**. Reporter le signe, ou l'écraser
  volontairement — mais le dire.

### 8. État du prérequis

Le plan d'exécution sort du brouillard : le modèle est confirmé. Il reste
« plan avant la première ligne » (le geste touche `LayerState`), mais plus aucun
arbitrage ne le bloque.
