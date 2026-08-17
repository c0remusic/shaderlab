# Le sélecteur de fichier refuse ce que le glisser-déposer accepte

Type: task
Status: open
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
