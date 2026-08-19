# Un plugin Affinity améliorerait-il les PERFS de nos effets ? Leur QUALITÉ ?

Type: research
Status: open
Parent: ../map.md

Question d'Antoine, le 2026-08-19.

## Pourquoi ce n'est PAS le ticket 01

Le [ticket 01](01-contrat-8bf.md) demande **si c'est possible** — un `.8bf`
est-il appliqué une fois ou enveloppé en filtre live. Celui-ci demande **si ce
serait MEILLEUR**. Les deux axes sont indépendants, et ils ne se mesurent pas
avec les mêmes outils.

⚠️ **Ils ne se répondent pas non plus ensemble** : le gain de PERF viendrait de
notre code, le gain de QUALITÉ viendrait de l'HÔTE. On peut très bien avoir
l'un sans l'autre.

## Axe 1 — les PERFS

**L'hypothèse naïve** : nous rendons en WebGPU dans une WebView2 ; un plugin
natif parle au pilote sans navigateur ; donc plus rapide.

⚠️ **Cette hypothèse est probablement fausse, et le dépôt a déjà la mesure qui
le dit.** Le § « le coût du verre » a établi par ABLATION que notre coût
dominant est la **cohérence de cache** — une lecture dispersée vaut ~25 lectures
cohérentes — et pas la couche d'abstraction. La géométrie est gratuite ;
l'échantillonnage coûte. Retirer WebGPU ne change rien à ça.

Et une piste d'optimisation ALU a déjà été écrite, mesurée à 8 % pour dix-huit
références déplacées, puis **revertée** : on ne réduit pas un coût de cache en
retirant des multiplications. Changer d'API est le même genre de pari.

**Ce qu'il faut mesurer, et l'ordre compte :**

1. **D'abord la part de l'abstraction dans notre coût actuel.** Chronométrage
   GPU par passe (`__shaderlabDebug.capturerTimingGpu()`) contre le temps mur.
   Si le GPU est saturé, l'hôte n'y peut rien et l'axe 1 est clos sans écrire
   une ligne de C++.
2. Seulement si l'écart est réel : le coût d'un aller-retour `FilterRecord` chez
   Affinity, et si un plugin peut garder son device GPU entre deux appels ou
   doit le recréer.
3. ⚠️ En build de **PRODUCTION** — le plancher du build de dev est 2,6× celui de
   la prod et noie les petits signaux.

⚠️ **Et un contre-argument structurel** : un `.8bf` reçoit des pixels et rend des
pixels. Notre pile compose N calques en ping-pong sur le GPU **sans jamais
redescendre en mémoire centrale**. Un plugin par effet ferait N allers-retours
CPU↔GPU là où nous en faisons zéro. **Ça pourrait être plus LENT, pas plus
rapide** — et c'est l'issue à écarter en premier.

## Axe 2 — la QUALITÉ

Celui-là est plus prometteur, et pour une raison qui n'a rien à voir avec nos
shaders : **ce qu'on gagnerait vient de l'hôte, pas du code**.

| Ce qu'Affinity a | Ce que nous avons |
| --- | --- |
| `RGB96Mode` — 32 bits flottants | 8 bits, `rgba8unorm-srgb` |
| `Depth16Bit` | rien (export print bloqué) |
| ICC : `ICCManager`, `SetICCProfile`, `CreateHardwareICCTransform` | JPEG traité comme sRGB, aucun profil lu |
| OCIO : `OCIOManager`, `OCIOConvert`, `OCIODisplay` | rien |
| `SoftProof`, `RenderingIntent`, `LUT3D` | rien |
| `GainMap`, HDR, `ToneMappingPersona` | rien |

**Nos dégradés de bloom et de halation bandent en 8 bits** — c'est le motif
même du `PRD-print-export.md`. Sous Affinity en 16 ou 32 bits, ils ne
banderaient pas, sans qu'on change une ligne de shader.

⚠️ **Mais ce gain est disponible SANS plugin.** Le [ticket 11](11-debloquer-le-16-bit.md)
montre la voie pour l'avoir chez nous : chaîne linéaire, encodage explicite à la
sortie. **La vraie question de l'axe 2 est donc « moins cher chez eux ou chez
nous ? »**, pas « qui l'a ».

## Ce qui prouve que le ticket est fini

Deux verdicts séparés, chacun avec son chiffre :

- **Perf** : la part du temps GPU dans notre coût actuel, et l'issue
  « N allers-retours CPU↔GPU » écartée ou confirmée.
- **Qualité** : le coût du 16 bits chez nous (ticket 11) contre le coût d'un
  plugin, à bénéfice égal.

Et une phrase écrite qui dise lequel des deux, s'il y en a un, justifie d'écrire
du C++.
