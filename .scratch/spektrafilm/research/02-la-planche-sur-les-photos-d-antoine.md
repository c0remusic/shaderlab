# La planche : spektrafilm contre notre pile, sur trois photos d'Antoine

Rendu le 2026-09-23, après le feu vert d'Antoine (« go ») et la licence tranchée
(dépôt passé en GPL-3.0-or-later). **Aucun changement dans `src/`.** Les rendus
sont ses photos : ils restent hors du dépôt, dans le scratchpad de session. Les
scripts qui les refont sont versionnés à côté.

## Ce qui a été rendu

Trois photos choisies pour le phénomène sur une planche-contact des deux dossiers :

- **DSCF5163**, une bougie et des raies de lumière sur un fond noir, pour la
  halation et la diffusion ;
- **DSCF5160**, un ciel de coucher de soleil derrière une silhouette, pour la
  couleur et la tenue des hautes lumières ;
- **DSCF5171**, des lys blancs, des fleurs rouges et du feuillage, pour la
  séparation des couleurs et les blancs.

Sept colonnes par photo, chacune en image entière réduite et en crop 1:1 à
pleine résolution :

1. l'original ;
2. notre pile `glow` + `halation` + `grain` aux **défauts** ;
3. la même pile **dosée** — un réglage à l'œil de la session, pas un preset :
   glow à un cinquième avec retenue des noirs, halation à moitié, grain à moitié
   et plus fin ;
4. à 7. quatre stocks spektrafilm rendus **tels quels**, exposition automatique
   coupée : Portra 400 tiré sur Portra Endura, Vision3 500T sur 2383, Ektar 100 sur
   Endura Premier, Velvia 100 (inversible, scanné directement).

Contrôles : sur les crops, le témoin de l'app est identique à l'original (écart
moyen 0,00, cadrage et orientation EXIF justes) ; spektrafilm calcule la taille
physique du pixel sur l'image entière avant la découpe
(`runtime/services/resize.py`), donc un crop 1:1 garde l'échelle du grain et de
la halation. Coût : **24 s par image de 1,6 Mpx** sur le CPU (numba), ~8 à 14 s par
crop — une image de 26 Mpx à pleine résolution en demanderait plusieurs minutes.

## Ce que les mesures disent

`assets/planche-film-mesures.py`, sur les crops 1:1 :

| rendu | noir | teinte du noir (B−R) | pixels écrêtés (bougie) | grain luma | grain chroma |
|---|---|---|---|---|---|
| original | 0,0 | 0,0 | 18,62 % | 12,86 | 2,29 |
| notre pile, défauts | 1,1 | −2,5 | **36,03 %** | 11,73 | **9,66** |
| notre pile, dosée | 0,0 | 0,0 | 33,07 % | 13,69 | 5,84 |
| Portra 400 → Endura | **14,7** | +4,0 | **0,00 %** | 5,55 | 3,87 |
| Vision3 500T → 2383 | 1,0 | 0,0 | **0,00 %** | 6,89 | 4,28 |
| Ektar 100 → Endura Premier | **11,0** | +9,1 | **0,00 %** | 5,24 | 4,10 |
| Velvia 100, scan | 1,3 | +1,0 | **0,00 %** | 5,34 | 3,74 |

Trois constats, du plus fort au plus faible :

1. **Aucun stock n'écrête un seul pixel dans la bougie.** L'original en écrête
   18,6 % ; notre pile, qui AJOUTE de la lumière, monte à 33–36 %. L'épaule d'une
   courbe de film n'amène jamais un pixel au blanc : c'est la différence la plus
   nette de la planche, et la moins chère à prendre — une courbe par canal avec
   une épaule, que l'étage de développement sait déjà porter.
2. **Le noir d'un tirage est relevé et teinté, pas celui d'un inversible.**
   Portra et Ektar relèvent le noir de 11 à 15 niveaux et le bleutent ; Vision3 sur
   2383 (papier de cinéma) et Velvia le gardent profond. C'est une propriété du
   stock, pas un réglage global.
3. **Le film REMPLACE le grain du fichier au lieu de l'ajouter.** L'original porte
   déjà ~13 niveaux de bruit en luma (le grain de fichier connu de ces photos) ;
   les quatre stocks rendent 5,2 à 6,9, plus fin, parce que leur chaîne diffuse
   avant de poser son grain. Notre pile additionne (11,7 à 13,7) et, aux
   défauts, ajoute une forte chroma (9,7 contre 3,7–4,3 chez eux).

⚠️ **Une quatrième mesure a été jetée** : le liseré rouge de halation, compté en
pixels sombres rougeâtres le long d'une ligne, comptait le lavis orange du glow
comme un liseré (187 pixels pour notre pile contre 8 à 12 pour les stocks). Elle
ne sépare pas un halo large d'un liseré fin. Le liseré se voit à l'œil sur les
crops des feuilles contre le ciel ; le mesurer demande un profil en travers du
bord.

## Ce que ça dit de nos défauts

Aux défauts, notre pile délave les noirs et plaque un grain fort : 29 à 49 niveaux
d'écart moyen avec l'original sur les crops. Les défauts de chaque effet sont
faits pour le MONTRER seul ; empilés, ils ne composent pas un look. Ce n'est pas un
défaut de code, mais c'est ce qu'un utilisateur voit en posant les trois effets à
la suite.

## Scripts

- `assets/spektrafilm-rendre.py`, `assets/spektrafilm-lot.py` — le rendu
  spektrafilm (venv hors dépôt, cœur installé sans l'interface graphique) ;
- `assets/planche-notre-pile.mjs` — notre pipeline réel par le harnais
  `render-check-page`, à pleine résolution, app lancée avec CDP ;
- `assets/planche-film-assembler.py`, `assets/planche-film-mesures.py`.
