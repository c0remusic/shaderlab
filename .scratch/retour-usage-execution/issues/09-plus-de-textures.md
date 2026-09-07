# 09 — Plus de textures pour l'effet Texture

**What to build:** L'effet `Texture` propose un jeu de textures plus riche — pack
embarqué et/ou générateur procédural, selon la source retenue en 08. Le mécanisme
`libraryTexture` (rang dans le catalogue trié, binding 7, ADR-0018) doit tenir
avec le catalogue étendu.

**Blocked by:** None — TRANCHÉ au grilling du 2026-08-27 : voie DOUBLE de la recherche 08 (pack CC0 curé Texture Ninja + générateur procédural), budget pack **~20-30 Mo**, curation axée RELIEF (le manque mesuré de displacementMap), preuve de licence versionnée dans le repo.

**Status:** ready-for-human
**Type:** task

- [x] Le catalogue de textures est enrichi (pack et/ou procédural). — Pack CC0 curé
  livré : **19 scans Texture Ninja, 19,55 Mo, 2K q92**, axés RELIEF (rstd 11,8–28,8 ;
  distinct 118–220 /255). `src-tauri/textures/sl-*.jpg`. Le générateur procédural
  (voie DOUBLE) reste un ticket à part, hors périmètre de cette tranche.
- [x] Licences respectées : attribution et emplacement documentés si pack embarqué. —
  `src-tauri/textures/LICENSES.md` (source, URL par fichier, CC0 verbatim, date, mesure
  de relief). README + `.gitignore` mis à jour (négation `!sl-*`).
- [x] `libraryTexture` / rang tient avec le catalogue étendu (pyramide de mipmaps intacte). —
  Dossier livré était VIDE d'images : les rangs 0..18 sont établis à neuf, aucun rang
  existant décalé. Préfixe `sl-NN` zéro-padé = ordre de tri déterministe, ajouts futurs
  en fin sans décalage. `mipLevelCountFor`/`MipmapGenerator` acceptent toute dimension
  ≤ 8192 : mes 2K passent le chemin identique à tout scan.
- [ ] Validé à l'œil par Antoine.
