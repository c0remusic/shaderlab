# Le sélecteur de fichier refuse ce que le glisser-déposer accepte

Type: task
Status: resolved
Parent: ../map.md

## Question

Deux chemins d'entrée pour la même chose, deux réponses différentes.

| Chemin | Filtre | Un PNG à alpha ? |
| --- | --- | --- |
| Bouton « Ouvrir une image » / import de calque photo | `["jpg", "jpeg"]` (`src-tauri/src/lib.rs:120`) | **refusé** |
| Glisser-déposer sur la toile | aucun (`src/components/Canvas.tsx:380`) | **accepté** |

**Faut-il lever le filtre, et jusqu'où ?**

## Ce que la mesure a déjà établi (2026-08-17, ticket 04)

**La chaîne supporte l'alpha de bout en bout, et c'est vérifié dans la vraie
fenêtre** : un PNG 2400×900 à fond transparent importé par `importPhotoByPath`
compose son texte sur la photo, le transparent laissant passer le fond, avec les
poignées de transformation du calque.

Trois raisons pour lesquelles ça marchait déjà sans qu'on l'ait prévu :

- `createImageBitmap` **renifle le format** — l'étiquette `image/jpeg` posée sur
  le Blob (`App.tsx:697`) est ignorée par le décodeur ;
- la texture de `PhotoSourceStore` est en `srgbFormat`, donc à quatre canaux ;
- `photoLayerInput` écrit déjà la couverture dans l'alpha, et la toile est
  transparente par décision (T0) — c'est ADR-0006 qui l'aplatit à l'export.

Donc lever le filtre n'ouvre pas un chantier : ça retire une contradiction.

## Ce qu'il reste à décider, et ce n'est pas rien

- **Quels formats.** PNG est évident. WebP ? TIFF ? Le décodeur du navigateur en
  accepte plusieurs, mais chacun élargit la surface de ce qu'on promet de rendre.
- ⚠️ **Le JPEG d'ENTRÉE et le JPEG de SORTIE sont deux choses**, et il ne faut
  pas les confondre en levant le filtre. L'export reste du JPEG
  (`is_jpeg_path`, `write_atomic`), et `exportImage.ts` **refuse d'encoder un
  pixel non opaque** — garde délibérée. Accepter un PNG transparent en entrée ne
  change rien à ça, mais quelqu'un le lira comme une invitation à sortir du PNG.
  Le dire dans le même commit.
- **Le nom de filtre affiché.** Il dit « Images » et n'en montre que deux ; le
  corriger fait partie du geste, sinon le dialogue continue de mentir.

## Pourquoi ce ticket existe séparément

Il est né en résolvant
[La typographie entre-t-elle dans ce palier](04-la-typographie-entre-t-elle-dans-ce-palier.md),
qui est sorti du périmètre. **Le défaut, lui, n'en sort pas** : il touche tout
PNG à alpha — un scan détouré, un logo, un masque peint ailleurs, une texture —
et pas seulement de la typographie. Le ranger avec elle l'aurait fait disparaître
avec elle.

---

## Answer — RÉSOLU le 2026-08-18

**Le filtre est levé, et la forme retenue fait qu'il ne peut plus jamais
redevenir le chemin le plus étroit.**

### La décision : nommer peu, n'interdire rien

`pick_image_file` (`src-tauri/src/lib.rs`) porte désormais **deux** filtres :

```rust
.add_filter("Images (JPEG, PNG)", &["jpg", "jpeg", "png"])
.add_filter("Tous les fichiers", &["*"])
```

Le second est le cœur de la décision, pas un ornement. Il répond au « quels
formats » du ticket en **retirant sa portée** : les extensions nommées ne sont
que du confort de dialogue, et rien n'est plus refusé.

Ce qui rend ce choix sûr, et c'est structurel : **le glisser-déposer n'a jamais
eu de filtre**, donc l'app promettait déjà de rendre ce que le décodeur accepte.
Un format qui ne se décode pas échoue identiquement sur les deux chemins —
`openFile` lève `Image non supportée ou corrompue.` — donc élargir la liste ne
peut produire aucun état incohérent, seulement un refus honnête. On n'a pas
élargi une promesse : **on a supprimé une contradiction**, exactement comme le
ticket l'annonçait.

Ne sont NOMMÉS que les formats mesurés ici : JPEG (chemin quotidien) et PNG
(éprouvé le 2026-08-17, puis à nouveau ce jour). WebP et AVIF sont très
probablement décodés par WebView2 — **ils ne sont pas listés parce que personne
ne l'a vérifié**, et l'attrape-tout les rend déjà atteignables. Les nommer = une
mesure, puis un mot.

### Le mensonge attenant, retiré dans le même geste

Trois sites revendiquaient `{ type: "image/jpeg" }` sur des octets dont on ne
sait rien (`App.tsx` ×2, `usePhotoLayer.ts` ×2, dont une déjà sans type). C'était
inoffensif — `createImageBitmap` renifle le format et **personne ne lit `.type`
d'un fichier image** (vérifié : les deux seuls `.type` du dépôt sont les
discriminants de `MaskSource`) — mais ça se lisait comme la justification du
filtre. Les Blob n'annoncent plus rien, ce qui est la forme qu'avaient déjà
`render/renderer.ts` et l'import de texture.

Corrigé aussi : `EmptyWorkspace` disait « Dépose un JPEG ici », décrivant le
filtre du sélecteur et non ce que la toile accepte.

### L'export n'a pas bougé, et c'est dit à l'endroit où on le lira

Le ticket demandait de ne pas confondre le JPEG d'ENTRÉE et celui de SORTIE.
`is_jpeg_path` refuse toujours d'écrire ailleurs, et `exportImage.ts` refuse
toujours d'encoder un pixel non opaque. L'avertissement est écrit **dans l'en-tête
de `pick_image_file`**, c'est-à-dire sur le code qu'on lira en voulant élargir la
liste — pas dans un document séparé.

### Preuve, prise dans la vraie fenêtre

Un PNG **600×400 RGBA** fabriqué pour la mesure (disque rouge opaque, tout le
reste à alpha 0 — un PNG opaque n'aurait rien prouvé de plus qu'un JPEG) :

- `read_image_file` : 3168 octets lus ;
- `importPhotoByPath` : `layer-2`, `alpha-disque.png`, `sourceId photo-2` ;
- capture 1280×720, écart-type 42,6 (donc pas un aplat) : **le disque rouge est
  composé sur la photo, et le transparent autour laisse passer le ciel jusqu'au
  bord du disque**, à l'intérieur de la boîte de poignées.

Et le JPEG s'ouvre toujours après le retrait du type MIME (`openByPath`,
signature `moyenne 43,6 / écart 60,7`) — c'était le vrai risque du geste, le
reste étant de la prose.

⚠️ **Ce qui n'est PAS prouvé, et ne peut pas l'être ici** : le dialogue natif
lui-même. `pick_image_file` passe par `rfd`, et CLAUDE.md documente que ce
dialogue n'est pilotable ni par CDP ni par computer-use. `cargo check` passe ;
que la liste déroulante affiche bien ses deux entrées reste à voir à l'œil.

### ⚠️ Piège de sonde, payé ici

Un chemin Windows passé en antislashs à travers `driver.mjs eval` **perd ses
séparateurs** (`C:UsersLEETJAppData…`), et `importPhotoByPath` échoue alors en
rendant une promesse RÉSOLUE — la faute est avalée par son `catch`. La sonde a
donc d'abord rapporté « import OK, zéro calque », ce qui ressemble trait pour
trait à un bug de l'app. **Le témoin JPEG échouait exactement pareil**, et c'est
lui qui a montré que la sonde était en cause et non le geste. Remède : des
slashes AVANT dans tout chemin passé à `eval` — Windows les accepte, et il n'y a
plus d'échappement à compter.

### Gates

`npx tsc --noEmit` · `npm run lint` · `cargo check` · `npm run test` (130
fichiers, 1927 tests) · `npm run test-storybook` **en entier** (32 fichiers, 311
tests) — tous verts. `test:render` sans objet : aucun scénario, aucune référence
et aucun shader touchés.
