# Exécution du retour d'usage — backlog de tickets

Tranches verticales issues du **grilling du 2026-08-21** (carte
`.scratch/retour-usage-2026-08-20/`, 16 questions tranchées). Découpées via
`/to-tickets` le 2026-08-21, approuvées par Antoine (« les 14 » + recherche de
source pour les textures = 15).

Frontière = tout ticket dont les bloqueurs sont fermés. Numérotés en ordre de
dépendance (bloqueurs d'abord). Réclamer = `Status: claimed`.

⚠️ **Deux tickets sont des DÉCISIONS que trancher LIVE avec Antoine** (`ready-for-human`) :
**06** (encre procédurale) et **10** (modèle de la forme). L'agent ne décide pas à
sa place. **14** (mesure lensBlur prod) est aussi HITL — le sandbox bloque
`target/`, Antoine lance le probe.

## Graphe

```
UI          01 aperçu fusion (libre)
            02 panneau latéral (libre, réaction wireframe) → 03 libellé « Verrous : »
            04 coût aperçu effet (libre) → 05 vignettes de galerie
Encre/Tex   06 effet AQUARELLE — la photo bave [LIVE, requalifié 2026-09-09] → ~~07 encre dans Impression~~ (wontfix)
            08 chercher source textures + licences → 09 plus de textures
Aplat       10 modèle de la forme [LIVE] → 11 sélection géométrique → 12 outil Forme → 13 poignées
lensBlur    14 mesurer prod [Antoine] → 15 levier perf
Déplacer    20 Déplacer agit sur les effets placés (libre)
            21 quels effets gagnent un lieu [LIVE]
Verre Poli  16 Fresnel rampant → 17 reflet d'environnement → 18 réfraction de bord → 19 rim + frange
Transform   24 transform du rendu (livré) · 26 sélection auto au clic (livré)
Calques     27 Aplatir : Tampon + Fusionner (livré 09-09) → 28 clic droit pile → 29 clic droit toile → 30 raccourcis → 31 renommer (tous livrés 09-09/10)
Toile       32 recadrage : A moteur (livré 09-10) → B outil Recadrer (en cours)
```

⚠️ **Les tickets 27 à 32 sont nés le 2026-09-09/10 d'une phrase d'Antoine chacun**,
pas du grilling du 21/08 — le README dit « 15 tickets » plus haut, le dossier en
porte 32. Le 09 (pack de textures) était livré avant qu'on le croie ouvert.

⚠️ **Les tickets 16-19 (verre Poli) sont issus de la recherche
`../retour-usage-2026-08-20/research/01-glass-shading.md`**, sliceés le 2026-08-21
sur « go pour l'afk » — draft à relire par Antoine. Chacun change le rendu du verre
et se JUGE devant photo par lui (l'esthétique ne se grille pas ; un banc prouve que
ça agit, jamais que c'est beau). Chaîne linéaire : une seule évolution du chemin
`glass.ts` à la fois, chacune régénère les 18 références.

## Note d'exécution

Tout ticket UI (01, 02, 03, 05, 12, 13) change le rendu → **validation à l'œil
d'Antoine par capture CDP** (un sous-agent headless ne juge pas le visuel). Aucun
rendu figé sans sa relecture. Protocole `/run-shaderlab`.
