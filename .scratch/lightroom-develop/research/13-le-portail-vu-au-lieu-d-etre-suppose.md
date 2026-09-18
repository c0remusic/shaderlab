# Le portail de Texture, REGARDÉ — la variance du flou sépare 1,50 × là où la variance locale sépare 1,14 ×

Status: ready-for-agent
Type: research

Mesuré le 2026-09-18 sur `DSCF5171.JPG` (original boîtier), Texture +60.
Instrument : `assets/sonde-portail.mjs`.

[`08`](08-le-portail-de-texture.md) se termine par une consigne, et elle est
impérative :

> C'est le geste à refaire avant de toucher à un coefficient — pas une formule
> de plus.

Deux corrections y ont déjà été écrites et revertées pour avoir **modulé un
coefficient jamais regardé**. Ce fichier est le geste, pas la troisième
correction.

## La question posée, et une seule

Le portail actuel lit `varMoyenne = E[y²] − E[y]²` sur le support de la
pyramide : c'est le **flou de la variance**, donc grain compris. `08` établit
qu'il faudrait la **variance du flou** — la structure mesurée sur un signal où
le grain a déjà disparu. Sépare-t-elle mieux un bord d'un grain ?

Candidats : l'écart-type de `auxPass.g` (la luminance DÉJÀ LISSÉE par la section
moyenne) sur une tente 3×3, à quatre écartements. **Calculé en REGISTRES** —
c'est le point, et il n'est pas décoratif : un aller-retour par une cible 8 bits
détruirait une variance de l'ordre de 1e-4 (le pas de quantification y vaut
~0,004 en lumière).

Classement bord / plat par le **gradient de l'image elle-même**, sur toute la
photo, jamais sur un bord choisi à la main.

## Le relevé

| champ | plat (médiane) | bord (médiane) | **rapport** |
|---|---|---|---|
| **actuel** — écart-type de la variance locale | 0,02122 | 0,02416 | **1,14** |
| structure, écartement 2 px | 0,00061 | 0,00091 | **1,50** |
| structure, écartement 4 px | 0,00121 | 0,00182 | **1,50** |
| structure, écartement 8 px | 0,00212 | 0,00273 | 1,29 |
| structure, écartement 16 px | 0,00439 | 0,00561 | 1,28 |

✅ **La sonde recoupe celle de `08` sur le champ actuel** : elle y mesurait la
variance à 0,0142 au loin contre 0,0180 au bord, soit **1,13 en écart-type**.
Ici 1,14. Les deux instruments, écrits à deux jours d'écart et sur des chemins
différents, donnent le même rapport — l'échelle absolue diffère (la sonde de
`08` sortait `varMoyenne × 50`), le rapport non, et c'est lui qui décide.

## Ce que ça dit

**La variance du flou sépare mieux — et pas assez.** Le rapport passe de 1,14 à
1,50, soit une marge au-dessus de l'unité **3,6 fois plus grande** (0,14 → 0,50).
C'est un vrai gain, mesuré, et c'est la première fois que la direction proposée
par `08` est vérifiée au lieu d'être argumentée.

⚠️ **Mais 1,50 ne fait pas un détecteur de bord.** Un portail `ε/(v²+ε)` avec un
ε recalé à cette échelle donnerait de l'ordre de 0,60 sur le plat contre 0,40 au
bord — une course de 33 % là où l'actuel en a 15 %. Deux fois mieux, et toujours
loin d'une porte qui s'ouvre et se ferme.

Et l'écartement optimal est **court** (2 à 4 px de l'image, soit 1 à 2 texels de
la section moyenne). Au-delà, le rapport retombe à 1,28 : la tente finit par
enjamber d'autres structures, et la mesure se remet à ressembler à une moyenne
de matière. Ce n'est donc pas « plus profond = mieux ».

## Ce qui n'est PAS fait, délibérément

**Aucune ligne de shader.** Le gain est réel mais modeste, il demanderait un
champ de plus, un ε recalé, et de nouvelles références ; et `08` porte deux
corrections écrites puis retirées sur ce même coefficient. Le dépôt a déjà payé
deux fois pour avoir écrit avant d'avoir le chiffre. Le chiffre est là
maintenant : 1,50 contre 1,14, écartement 2 à 4 px.

**Ce qu'il faudrait avant d'écrire**, dans cet ordre :

1. **Le même relevé chez Lightroom.** Leur portail s'ouvre-t-il réellement
   davantage ? `08` le déduit d'un chiffre indirect — ils amplifient le grain
   ×1,76 contre ×1,62 pour nous — jamais d'une mesure de leur masque. La
   campagne `ph-*` existe, le plugin aussi.
2. **Une photo à GRAIN FAIBLE.** Tout ce dossier est mesuré sur des fichiers qui
   portent ~12 niveaux de grain luma, et c'est ce grain qui remplit la variance.
   Une photo propre dirait si le portail actuel fonctionne quand son hypothèse de
   calibration (une mire sans grain) est respectée — et donc si le défaut est le
   portail ou la photo.
3. **Vérifier que la tranchée suit le portail.** `08` montre qu'elle est
   ENTIÈREMENT portée par la bande moyenne. Rien ne prouve encore qu'ouvrir le
   portail la supprime plutôt que de l'amplifier avec le reste.

## Le mécanisme, lui, est prêt

La section moyenne est **exposée** en `auxPass` (`1254ade`) et la pyramide porte
un **troisième canal** de détail (`2e8ad6a`), tous deux bit-exacts. Le champ
mesuré ici se lit sur `auxPass.g` sans une passe de plus. Le blocage de structure
que `08` décrivait — « notre chaîne n'a qu'un seul créneau de lissage » — n'existe
plus ; ce qui reste est un problème de SÉPARATION, pas de plomberie.
