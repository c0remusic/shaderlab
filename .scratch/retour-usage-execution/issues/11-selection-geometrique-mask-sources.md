# 11 — Source de sélection géométrique dans mask/sources

**What to build:** Ajouter des sources géométriques (rectangle, ellipse au moins) à
l'union FERMÉE de `mask/sources/types.ts` — aujourd'hui `gradient` / `luminosity`
/ `colorRange` seulement, aucune source géométrique. Comble le trou signalé au
ROADMAP et sert de prefactor à l'outil Forme (ticket 12). « Make the change easy,
then make the easy change. »

**Blocked by:** None — le 10 est tranché (2026-08-27) : la géométrie vit ICI, en source de masque (rectangle/ellipse/polygone), le marquee de Photoshop chez nous.

**Status:** ready-for-human
**Type:** task

- [x] `mask/sources` porte des sources géométriques (rectangle + ellipse) — UNE source `shape` à param `mode` (0 rectangle, 1 ellipse), boîte à deux coins (`x0,y0,x1,y1`), `feather`, `invert`, `mode` en dernier. `src/mask/sources/shape.ts`.
- [x] Câblé de bout en bout : `MaskPanel` propose (registre → menu + groupe de bascules Rectangle/Ellipse), `App` ajoute, `LayerStack` + `MaskTextureResolver` (`PARAM_COUNT_BY_TYPE.shape=8`) consomment. WGSL validé STATIQUEMENT par naga (« Validation successful » ; seule erreur = l'écart connu toléré `array<f32,8>`, partagé par toutes les sources).
- [~] Référence de pixels posée : 3 scénarios (`masque-forme-temoin` / `-rectangle` / `-ellipse`, toile 320×192) + entrées `ATTENDU` écrits. ⚠️ Les 3 PNG NE SONT PAS ENCORE GÉNÉRÉS — `test:render --update` + `gpu-shader-check` exigent l'app avec CDP, et une instance `shaderlab` d'origine inconnue (PID 45940, `cargo run` dev, sans CDP) tournait : non écrasée (garde du brief). À finir en session principale : lancer l'app CDP, `npm run test:render --update` sur les 3 scénarios, relire les PNG à l'œil, `gpu-shader-check --origin`, PUIS committer l'ensemble en un seul commit (code + scénarios + ATTENDU + PNG). Sans les PNG, `npm run test` reste rouge sur ces 3 réfs — d'où l'absence de commit.
