# 11 — Source de sélection géométrique dans mask/sources

**What to build:** Ajouter des sources géométriques (rectangle, ellipse au moins) à
l'union FERMÉE de `mask/sources/types.ts` — aujourd'hui `gradient` / `luminosity`
/ `colorRange` seulement, aucune source géométrique. Comble le trou signalé au
ROADMAP et sert de prefactor à l'outil Forme (ticket 12). « Make the change easy,
then make the easy change. »

**Blocked by:** 10 — le modèle de la forme décide si la géométrie vit ici ou ailleurs.

**Status:** ready-for-agent
**Type:** task

- [ ] `mask/sources` porte des sources géométriques (rectangle, ellipse).
- [ ] Câblé de bout en bout : `MaskPanel` propose, `App` ajoute, `LayerStack` et `MaskTextureResolver` consomment, le shader compile (`gpu-shader-check`).
- [ ] Référence de pixels posée (mire qui montre la forme bornée).
