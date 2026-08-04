# Le VERRE — plan de portage

> Statut : **validé par Antoine le 2026-08-03, TRANCHE 1 LIVRÉE le même jour.**
> `glass` est au registre avec ses neuf matières de feuille et treize références de
> pixels sur `mireVerre`. **La tranche 2 (les cinq matières de PAVÉ) reste à
> faire**, et ira à la fin de la liste de matières — pas dans un second effet.
> ⚠️ Le jugement visuel sur une vraie photo n'a PAS été rendu : les références
> prouvent que chaque matière porte sa propriété, pas qu'elle est belle. Antoine
> a marqué le `Dépoli` « à raffiner ».
> Les quatorze branches de la tranche 1 sont verrouillées par treize références :
> le scénario Cannelé simple couvre à la fois la matière 0 et le profil 0. Les
> sept références complémentaires distinguent explicitement Cannelé croisé de
> Cannelé simple, Gaufré de Cannelé croisé, Écorce de Martelé, et chacun des
> trois profils restants du profil Arc doux. Une référence exploratoire `Poli`
> à forte densité a été volontairement écartée : elle révélait un aliasing dû au
> pas de différences finies constant de cette branche ; la figer aurait verrouillé
> le défaut. Ce comportement reste à corriger ou à retirer de l'UI.
> Source : `C:\dev\portfolio\src\shaders\verre\site.fs.glsl` (1 405 lignes, GLSL).
> Écrit le 2026-08-03.

## 1. Ce que la source contient réellement

Deux chiffres de la note de reprise sont **faux**, et ils changent le découpage.
Relevés dans le code, pas dans le souvenir :

| | Note antérieure | Compté dans `site.fs.glsl` |
| --- | --- | --- |
| Matières de feuille | 8 | **9** utilisables (10 branches, moins `béton`) |
| Profils de section | 6 | **5** (`pente()`, quatre `if` + un `else`) |

### Matières — `motif`, quinze branches

**Feuille de verre**, `motif` 0 à 9. Chacune est une façon de fabriquer une
PENTE de surface ; l'optique en aval est la même pour toutes.

| # | Matière | Ce qui la fabrique |
| --- | --- | --- |
| 0 | Cannelé simple | `pente()` sur un axe, `orient` bascule |
| 1 | Cannelé croisé | `pente()` sur les deux axes |
| 2 | Gaufré | `pente × bosse` croisées — des dômes |
| 3 | Martelé | Voronoï lu par ses ARÊTES (Pilkington Arctic) |
| 4 | Écorce | maillage étiré en hauteur, plaques de tronc |
| 5 | ~~Béton~~ | **retiré sur demande d'Antoine** — la fonction `beton()` reste dans la source, on ne la porte pas |
| 6 | Aluminium | facettes PLANES, pente constante par cellule |
| 7 | Poli | feuille lisse, ondulation très lente |
| 8 | Dépoli / sablé | aucun relief macro — rugosité micron seule, l'image DIFFUSE au lieu d'être déviée |
| 9 | Cathédrale | bruit fortement anisotrope, `ÉTIRE = .085` (Pilkington Cotswold) |

**Pavés de verre**, `motif` 10 à 14. Machinerie séparée (`cellulePave`,
`grillePave`, `hauteurPave`) : une grille de blocs, un mortier, une arête
biseautée, et un moulage interne qui varie.

| # | Moulage interne du bloc |
| --- | --- |
| 10 | Nuage — bruit basse fréquence |
| 11 | Ondulé apériodique (Wave 1919) |
| 12 | Quadrillé anisotrope (Cross Small) |
| 13 | Alvéolaire (Sponge) |
| 14 | Lisse — seul le biseau travaille |

**Total utilisable : 14.**

### Profils de section — `profil`, cinq branches

Lus par `pente()` et `bosse()`, donc **applicables aux seules matières 0, 1
et 2**. Ailleurs la pente ne passe pas par ces fonctions et le curseur serait
inerte — c'est la première applicabilité à écrire.

| # | Profil | Forme |
| --- | --- | --- |
| 0 | Arc doux | arc de cercle × .35 |
| 1 | Arc plein | arc de cercle complet |
| 2 | Prisme | pente constante signée — un V |
| 3 | Fond plat | plateau + flanc en S, dérivée nulle aux deux raccords |
| 4 | Bourrelet | `(1 + cos πu)/2`, nervures jointives tangentes |

## 2. L'optique, et pourquoi elle se porte telle quelle

Le cœur tient en quatre lignes de la source et ne dépend d'aucune matière :

- **`refract(I, N, 1/IOR)`**, `IOR = 1.52`. Le ratio est air→verre, et la note
  du fichier dit pourquoi : passer `IOR` au lieu de `1/IOR` provoquait une
  réflexion totale qui n'a pas lieu d'être. À reprendre à l'identique.
- **Dispersion** : trois indices, `ior ± (ior − 1) · DISP_K · disp` avec
  `DISP_K = .175`. Un tap par canal.
- **Traversée diffuse** (`traverser`) : neuf taps, poids `1 − .55|t|`, plus un
  étalement LATÉRAL `sin(t · 9.42) · f · .38`. Ce dernier n'est pas décoratif —
  sans lui, neuf taps alignés donnent neuf copies décalées et une striure qui
  trahit le procédé.
- **Spéculaire + Fresnel**, sur la normale PLEINE : `relief` n'atténue que la
  déviation, jamais les reflets.

Rien là-dedans ne demande de passe interne. **Un effet mono-passe**, comme
`outlines` en modes locaux.

## 3. Ce qu'on NE porte PAS

Tout ce qui appartient à la page du portfolio, et c'est la moitié des uniformes :
`sujet`, `mire`, `montre`, `bande`, `fondu`, `traverse`, `voile`, `matiere`,
`gouttes[6]`, `decalage`, `fond1/2/3`, `versFond`, `cartouche`, `titreBoite`,
`epCart`, `nettete`, `seuilNet`, `champ`, `res`, `tex`, `aspectXY`.

Trois remplacements plutôt que des portages :

- `aspectXY` → `aspectScale()` d'`uvSpace.ts`, qui fait déjà ce travail et le
  fait pour tout le dossier.
- `res` → `textureDimensions(srcTexture)`. Les paramètres « en pixels de rendu »
  deviennent des pixels pleine définition, ce qui est plus simple ici : shaderlab
  n'a pas de distinction preview/export.
- `nettete` / `seuilNet` (reconstruction Catmull-Rom + CAS) → **non portés dans
  la tranche 1.** Ils corrigent un artefact de sous-échantillonnage propre au
  portfolio, où le sujet est une texture plus petite que l'écran. Ici la source
  est à résolution native. À reconsidérer si le flou fort trahit la mosaïque.

## 4. Découpage proposé

### UN SEUL effet au registre, `glass` / « Verre », livré en DEUX tranches

Et non deux effets. La journée du 2026-08-03 a défait cinq séparations de ce
genre (ADR-0011 à 0016) ; en créer une nouvelle le lendemain demanderait un
argument que je n'ai pas. Les pavés et la feuille répondent à la même question —
« que fait ce verre à l'image derrière lui ? » — et ne diffèrent que par la
façon de fabriquer la pente, exactement comme les trois modes de détection
d'`outlines` diffèrent par la façon de trouver un bord.

« Étage 1 / étage 2 » devient donc un ordre de LIVRAISON, pas deux entrées.

**Tranche 1 — la feuille** (matières 0-4, 6-9). 14 paramètres.
**Tranche 2 — les pavés** (matières 10-14). 8 paramètres de plus, soit 22.

22 sur un plafond de 32 : aucun élargissement de `MAX_EFFECT_PARAMS` nécessaire,
et 10 slots de marge. C'est le premier effet du registre à s'en approcher —
`outlines` en compte 26 depuis ce matin, donc le précédent existe.

### Table des paramètres

Indices figés dès la tranche 1 : ils sont persistés dans les presets, et les
huit de la tranche 2 vont **à la fin**, jamais au milieu.

| # | Nom | Plage / défaut | Applicabilité |
| --- | --- | --- | --- |
| 0 | `material` | 14 choix, déf. Cannelé simple | — |
| 1 | `density` (`n`) | — | toutes sauf Poli |
| 2 | `depth` (`creux`) | — | toutes sauf Dépoli |
| 3 | `profile` | 5 choix, déf. Arc doux | **Cannelé simple / croisé / Gaufré seulement** |
| 4 | `flat` (`plat`) | — | idem `profile` |
| 5 | `fillet` (`lissage`) | — | idem `profile` |
| 6 | `orientation` (`orient`) | 0/1 | matières directionnelles : Cannelé simple, Cathédrale, Ondulé, Quadrillé |
| 7 | `irregularity` (`irreg`) | — | toutes sauf Poli, Dépoli, Aluminium |
| 8 | `grain` | — | toutes |
| 9 | `thickness` (`ep`) | — | toutes |
| 10 | `specular` (`spec`) | — | toutes |
| 11 | `dispersion` (`disp`) | — | toutes |
| 12 | `diffusion` (`flouSup`) | — | toutes |
| 13 | `relief` | — | toutes |
| 14-21 | *tranche 2* : `blockSize`, `mortar`, `mortarHue`, `mortarLightness`, `edgeDepth`, `edgeWidth`, `bevel`, `inner` | | **pavés seulement** |

Chaque `hint` porte son « Sans objet en … », comme `hatching` et `outlines` le
font déjà. C'est le seul garde-fou de densité disponible tant que `ParamPanel`
ne sait pas masquer un contrôle inerte.

⚠️ **`EffectParam.maxFrom` existe depuis aujourd'hui** et sert ici : `fillet` est
une fraction de demi-cellule, `edgeWidth` et `bevel` aussi. Si l'un d'eux a un
maximum effectif lié à `density` ou `blockSize`, il le déclare au lieu d'offrir
une course morte — le défaut qu'on vient de corriger sur `sliceShift`.

## 5. La mire, et pourquoi elle vient AVANT le code

Règle du dépôt, payée par `lensBlur` : un verrou dont la mire ne peut pas montrer
la propriété ne verrouille rien.

Ce que ce shader doit pouvoir montrer, et ce que la mire commune ne montre pas :

1. **Le déplacement par réfraction** — visible sur du contraste fin. Le damier
   convient.
2. **La dispersion** — un liseré coloré sur un bord ACHROMATIQUE. Le damier de
   la mire commune est coloré : un liseré rouge sur du rouge ne se voit pas. Il
   faut une zone **neutre à fort contraste**.
3. **La périodicité de la cannelure** — se lit sur une grande plage unie
   traversée par un bord droit, pas sur un damier dont la période interfère avec
   celle des stries (crénelage de battement, qu'on prendrait pour un défaut).
4. **La diffusion du dépoli** — demande un détail fin qui DISPARAÎT, donc une
   zone de haute fréquence.

**Aucune mire existante ne réunit les quatre.** `mireDamierNeutre` (utilisée par
l'aberration latérale) est neutre et fine — bonne pour 2 et 4, mauvaise pour 3.
Proposition : **écrire `mireVerre`** — un quart de damier neutre fin, un quart
d'aplat uni traversé d'un bord droit franc, un quart de rampe, un quart de
texture haute fréquence. Une seule mire, quatre lectures. À écrire et à regarder
AVANT la première ligne de shader.

## 6. Coût

Par pixel, tranche 1 : 3 évaluations de la fonction de matière (différences
finies pour la normale) + 9 taps × 3 canaux pour la traversée dispersée = **27
lectures** dans le cas diffus, **3** quand la diffusion est sous-pixellaire (la
source court-circuite déjà ce cas).

C'est le plus cher du registre après `lensBlur` (48 taps). Aucune passe interne,
aucune texture intermédiaire, donc aucun coût VRAM au-delà du ping-pong existant.

## 7. Ce qui reste à trancher

1. **Le nom.** `glass` / « Verre », ou quelque chose qui dise que c'est un verre
   IMPRIMÉ (`reeded`, « Verre imprimé ») ? Le registre n'a pas de convention de
   langue pour les `name` — ils sont en anglais (`Lens distortion`, `Slice
   shift`) alors que les labels de paramètres sont en français.
2. **Le dépoli mérite-t-il d'être une matière ?** Il n'a aucun relief : c'est une
   DIFFUSION pure. C'est un flou, et la famille des flous est déclarée close à
   deux. Le garder ici est défendable — la diffusion d'un verre sablé n'est ni un
   noyau d'objectif ni une trajectoire — mais c'est une exception à une règle
   posée le même mois, donc à dire à voix haute plutôt qu'à laisser passer.
3. **`material` à 14 choix dans une liste déroulante.** C'est deux fois plus long
   que tout ce que le panneau porte aujourd'hui. À regarder au checkpoint visuel
   avant de considérer la tranche 1 terminée.
