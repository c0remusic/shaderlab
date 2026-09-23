# Audit spektrafilm — ce que shaderlab peut en utiliser, et sous quel régime

Audité le 2026-09-23, sur demande d'Antoine (« fais un full audit de tout ce qu'on
pourrait utiliser chez eux »). **Aucun changement dans `src/`, aucun code copié,
rien exécuté ni installé.**

**Objet.** [spektrafilm](https://github.com/andreavolpato/spektrafilm) (Andrea
Volpato, ex-agx-emulsion, Python) simule en spectral toute la chaîne argentique :
négatif, agrandisseur, papier, scanner. Son portage
[spektrafilm-ofx](https://github.com/chaert-s/spektrafilm-ofx) (Aedan Diez) en fait
un plugin OpenFX pour Resolve et Nuke, avec des shaders Vulkan et Metal. Clones lus
en lecture seule : amont `3bb2c2d`, OFX `86476af`.

**Méthode.** Un workflow de 23 agents : onze lots d'audit, chacun passé devant un
vérificateur adverse qui rouvre les `fichier:ligne` cités, contrôle chaque régime
de licence et vérifie les affirmations sur shaderlab contre notre code ; puis un
critique de complétude sur la liste entière des fichiers. Bilan : **121
éléments, 35 corrections, 0 rejet, 28 manques trouvés par les vérificateurs, 9
fichiers qu'aucun lot n'avait ouverts.** Le détail, élément par élément, est dans
[l'annexe](01-annexe-elements.md), où les constantes lues dans leur code sont
caviardées.

## 0. Le verdict en cinq lignes

1. **Leur code ne sert à rien tel quel** : tout est GPL-3.0, amont comme OFX,
   shaders compris. En porter une ligne obligerait à passer shaderlab entier en
   GPL-3.0.
2. **Leurs profils d'émulsion sont d'une autre licence** — CC BY-SA 4.0, choisie
   exprès pour les données. Ils sont embarquables sans toucher au code de
   shaderlab, mais avec des obligations dures (§1) et un préambule qui revendique
   aussi les reproductions.
3. **Il existe une voie entièrement permissive** pour le même résultat :
   [JanLohse/spectral_film_lut](https://github.com/JanLohse/spectral_film_lut)
   (MIT), [colour-science](https://github.com/colour-science/colour) (BSD-3, qui
   livre Jakob-Hanika 2019 et Mallett 2019),
   [rgb2spec](https://github.com/mitsuba-renderer/rgb2spec) (BSD-3), et les fiches
   techniques Kodak et Fuji, à numériser nous-mêmes.
4. **Un étage film complet est bloqué par notre architecture**, pas par la
   licence. Deux murs (§2) et un coût par pixel de 45 à 50 fois celui de toute
   notre pile.
5. **Ce qui passe tout de suite** : trois améliorations d'effets existants (grain,
   diffusion, halation), deux verrous de test qu'on n'a pas (spectre radial pour
   le grain, mire de réponse fréquentielle), une autoexposition, et une synergie
   avec le chantier Lightroom (§3, point 8).

## 1. La licence, actif par actif

⚠️ **Ce n'est pas un avis juridique.** Si shaderlab devient distribuable, les
points marqués « juriste » en demandent un.

| actif | licence | si shaderlab reste sans licence | si shaderlab passe GPL-3.0 |
|---|---|---|---|
| code amont (Python) et OFX (C++, shaders Vulkan et Metal) | GPL-3.0, au niveau du dépôt, sans en-tête par fichier | **inutilisable** ; lecture pour comprendre = zone grise, copie = interdite | utilisable, avec attribution et sources publiées |
| profils d'émulsion amont (28 stocks, `data/profiles`) | **CC BY-SA 4.0** + préambule v1.1 | embarquables : attribution partout, partage à l'identique sur la donnée et ses dérivés | idem |
| mêmes profils dans le dépôt OFX | double estampille (GPL, « All rights reserved ») | prendre la copie amont | idem — **juriste** : une double offre ne s'annule pas forcément |
| LUT de spectral upsampling « hanatos » | provenance documentée (vkdt, `THIRD_PARTY_NOTICES.txt:18-24`), **termes du fichier indéterminés** | ne pas embarquer | ne pas embarquer |
| spectres de filtres (Schott, Thorlabs, Edmund, Durst, Canon) | données fabricant | sans usage hors chaîne spectrale | idem |
| profils ICC embarqués (165) | CC BY-SA 3.0 (ellelstone), MIT (saucecontrol) | sans objet | sans objet |
| binaires officiels OFX | notice propriétaire | **ne jamais en extraire une ressource** | idem |
| LUT exportées par l'OFX | licence propre, pas de revente | sans objet | sans objet |
| **images rendues par l'OFX** | **explicitement non restreintes** | **boîte noire légitime** | idem |
| noms et icônes (spektrafilm, flow, dev) | aucune licence de marque | citer oui, s'en servir pour la marque non | idem |

**Ce qu'impose CC BY-SA 4.0 si on embarque un profil** — la liste complète, deux
obligations ayant échappé à l'auditeur :

- attribution partout où la donnée circule, écran « À propos » compris ;
- le texte de la licence, ou son URI, joint à l'artefact distribué ;
- partage à l'identique sur tout dérivé : LUT, courbe réajustée, table ;
- aucune mesure technique qui empêcherait d'extraire la donnée ;
- un journal des modifications livré avec la donnée modifiée.

**Le préambule va plus loin que le texte légal**, et c'est le point le plus
délicat. Il étend la licence à « tout autre format qui encode le même contenu »
(`SPEKTRAFILM_LICENSE.txt:8-12`), demande que l'information ne disparaisse jamais
(`:70-73`), refuse l'usage du nom dans une marque (`:112-113`) et demande de ne pas
entraîner de modèle qui imite ou remplace le rendu spektrafilm (`:123-126`, une
requête plutôt qu'une clause). Caler en boîte noire une LUT qui reproduit un
**stock nommé** (Portra, Velvia…) heurte donc au minimum la volonté déclarée de
l'auteur — **juriste** avant d'en faire un produit. Mesurer un **mécanisme
générique** (profil de diffusion, rebonds de halation, statistique du grain) n'est
pas concerné : c'est de la physique publiée.

Le `CITATION.cff` revendique aussi le copyleft sur tout code « directement inspiré
de ses méthodes ». Les idées ne sont pas protégeables par le droit d'auteur,
mais c'est une volonté déclarée. Pour une licence commerciale, l'auteur donne un
contact (`SPEKTRAFILM_LICENSE.txt:136`).

## 2. Les deux murs, et le coût

La chaîne canonique, lue dans `runtime/topology.py` (qu'aucun lot n'avait
ouvert) :

```
rgb_in → [compression de gamut d'entrée] → rgb_pre
       → EXPOSITION (RGB → raw spectral, reconstruction des hautes lumières,
         diffusion caméra, halation, flou d'objectif, log10) → log_e_film
       → DÉVELOPPEMENT (courbes de densité, coupleurs DIR) → cmy_film
       → [scan du négatif]  OU  [TIRAGE : agrandisseur → papier] → cmy_print
       → SCAN (flou optique, accentuation, voile, compression de gamut de sortie,
         encodage) → rgb_out
```

**Mur 1 — la précision entre les passes.** Notre ping-pong couleur est en 8 bits
sRGB par le format (`imageFrameResources.ts:130`). Chez eux, tout ce qui se trouve
entre `rgb_pre` et `rgb_out` vit en lumière de scène, en log d'exposition ou en
densité, sur une plage signée [−0,25 ; 64] (`ofx/tests/test_sdr_transfer_encode.py`).
C'est le prérequis 16 bits déjà identifié
(`.scratch/prochain-palier/research/01-16-bit-hors-du-depot.md`), et il bloque
toute la chaîne comme la reconstruction des hautes lumières.

**Mur 2 — les paramètres.** Notre uniform porte 48 flottants
(`MAX_EFFECT_PARAMS`). Un profil en pèse des centaines : 81 bandes × 3
sensibilités, des courbes de densité à 256 points. Un stock n'est donc pas un
effet, c'est un **étage à données en texture**, sur le modèle de
`developRegistry.ts` et du binding 7 des textures de bibliothèque.

**Le coût.** Simulation OFX complète : 512 ms à 1080p (83 passes), 3 410 ms en 4K ;
leur meilleur raccourci, la diffusion sous-échantillonnée, descend à 83 et 367 ms.
Ramené au pixel, c'est **45 à 50 fois** toute notre pile (23 ms sur 26 Mpx). Et
leurs chiffres supposent un APERÇU réduit (`simulate_preview`, `preview_max_size`)
là où shaderlab a tranché un seul pipeline à résolution native : à résolution
native, leur coût est pire que ce qu'ils publient.

**Conclusion architecturale** : un LOOK isolé en une à trois passes (une
diffusion, une halation, un grain) tient en 8 bits. Une chaîne profonde de 60
passes accumulées en fp32 ne tient pas.

## 3. Ce qu'on peut prendre — classé

### Prendre maintenant (une session chacun, régime propre)

1. **Un verrou par spectre radial (FFT) pour les effets stochastiques.** Leur
   harnais de parité juge le grain sur la similarité de spectre radial
   (`run_parity_harness.py:611-688`) ; nous n'avons aucune métrique fréquentielle,
   et notre seule référence de grain (`grain-graine-fixe`) fige la graine, pas la
   granulométrie. **À poser AVANT de toucher au grain** : c'est la preuve qui rend
   le point 3 vérifiable.
2. **Une mire de réponse fréquentielle** : zone plate radiale et bord incliné.
   Aucune de nos mires ne montre qu'une accentuation déborde en halo de contour,
   qu'un flou est plus fort sur un axe, qu'un noyau oscille (barres de période 32 px
   et damier de 8 px seulement). Méthode publique, pas de code.
3. **Grain : taille de particule par canal.** Leur couche bleue a des grains 2,5 à
   3,2 fois plus gros. Notre `grain.ts` ne varie que l'amplitude par canal, ce qui
   laisse le « grain en plaque uniforme » que son propre commentaire (`:73-78`)
   désigne comme le défaut à éviter. Notre réponse tonale 4t(1−t) approche déjà la
   variance binomiale, et notre mode Numérique n'a pas d'équivalent chez eux.
   ⚠️ Ils lient aussi le grain au FORMAT de film, en microns physiques ; nous le
   lions à un cadre fixe de 3 000 px. À trancher en même temps.
4. **Autoexposition.** Sept patrons de mesure, cible gris 18 %. C'est de la
   photométrie d'appareil classique. Shaderlab n'a rien de tel. Calcul côté JS,
   aucun coût de rendu. ⚠️ Leur « auto-neutre » n'est PAS une balance des blancs
   gray-world : c'est un facteur d'exposition scalaire. Un auto-blanc serait notre
   idée, pas la leur.

### Mesurer d'abord (quelques sessions)

5. **La famille des filtres de diffusion → `glow`.** `glow` cite Pro-Mist, Black
   Pro-Mist et Glimmerglass et n'en rend que deux ; il n'a pas non plus la queue
   longue en loi de puissance que donne un vrai filtre. Leur outil : un profil
   radial arbitraire obtenu comme somme de gaussiennes évaluées sur pyramide, ce
   qui garde notre coût plat. ⚠️ **Caler sur de vrais filtres** (Tiffen, Moment),
   pas sur leur réglage : il vient de « notes de caractérisation privées »
   (`diffusion.py:165-166`), et le reconstruire depuis leurs sorties est la
   branche grise.
6. **Halation : rebonds multiples et conservation d'énergie.** Une somme de N
   gaussiennes aux largeurs espacées en √k, une renormalisation qui empêche une
   halation forte de brûler les blancs, un liseré chaud au bord et un cœur froid.
   Notre `halation.ts` fait déjà le dégradé orange → rouge : ce n'est pas là
   qu'est le gain. Sa limite de fond est sa PLACE — posée sur l'image du calque, là
   où la leur agit avant la courbe de densité — et celle-là attend l'étage film.
7. **Coupleurs DIR — l'effet inter-image.** C'est **le seul mécanisme vraiment
   neuf** de tout l'audit. L'inhibiteur libéré par chaque couche dépend de sa
   densité et diffuse vers les couches voisines, ce qui donne un contraste local
   qui suit la densité et des franges de couleur aux transitions. `channelMixer`
   est un croisement 3×3 statique et global ; rien chez nous ne dépend du signal
   ni du voisinage. Physique publique (sensitométrie couleur, Hunt) ; leurs
   coefficients par défaut sont du code GPL, **à re-mesurer**. Coût L.
8. **Une courbe caractéristique 1D par canal — et c'est la MÊME machinerie que
   Lightroom.** Le look d'un stock (pied, épaule, croisement des canaux) est porté
   par trois courbes 1D, ce qui reste dans le 8 bits. Or
   [research/23](../../lightroom-develop/research/23-le-brevet-b220-decrit-l-operateur.md)
   vient d'établir que le Color Grading de Lightroom est EXACTEMENT ça : trois
   courbes 1D par canal en primaires ProPhoto. **Construire une fois** — tables 1D
   calculées sur le CPU, appliquées canal par canal dans un espace de travail —
   sert les deux chantiers. La plomberie « table calibrée + jumeau TS/WGSL » existe
   déjà (`reglagesDeBaseTable.ts`, `colorGradingTable.ts`).
9. **Bleach bypass.** Argent retenu, contraste fort, désaturation. Aucun effet
   shaderlab ne le donne (aucune occurrence dans `src/render`). Procédé de labo
   documenté ; leur implémentation n'existe que dans l'OFX, en GPL.
10. **Virage dépendant de la densité (Beer-Lambert, via Megajuicer).** Ombres et
    hautes lumières virent différemment selon la densité, pour une exponentielle
    par canal. À comparer à `duotone`, qui porte onze réglages.
11. **Un balayage joint performance + parité.** Pour chaque raccourci, leur
    harnais mesure la cadence ET l'écart de pixels, et ne le marque « promotable »
    que si la parité tient (`tools/run_perf_quality_sweep.py`). C'est la forme
    exacte qui a manqué à l'arbitrage d'optimisation du verre.
12. **Une comparaison entre révisions git.** Un worktree détaché par révision,
    rejoué, distances par paire (`scripts/compare_simulation_revisions.py`). Ça
    répond à « cette branche a-t-elle changé un pixel ? » sans montage à la main.

### Plus tard — chantiers

13. **L'étage film lui-même** : un conteneur sur le modèle de l'étage de
    développement, à données en texture, dans l'ordre de `topology.py`. Bloqué par
    le mur 1. Entrée spectrale par la matrice de Mallett (colour-science, BSD-3),
    triviale en WGSL mais utile seulement dans cet étage.
14. **Le grain de Newson** (IPOL 2017, modèle booléen de disques, indépendant de
    la résolution) : le grain « pas filtre 2005 » par excellence. Coût Monte-Carlo
    par pixel, que l'OFX atténue par échantillonnage adaptatif et un plafond de
    grains par cellule.
15. **Masquer les réglages par NIVEAU** (basique / avancé), et pas seulement par
    mode. ⚠️ Leur champ `tier` est **dormant** — rien ne le lit — donc c'est une
    idée à nous, pas un mécanisme éprouvé. Elle touche le chantier des panneaux
    (15 effets sur 26 sans aucune condition).
16. **L'export de LUT** : couleur seulement par construction, alors que notre
    pile est spatiale à environ 80 %. Leur `lut_creator` fait mieux que ça — des
    lots de plusieurs LUT avec points d'injection intermédiaires — mais
    l'applicabilité chez nous reste étroite.
17. **La compression de gamut d'entrée**, radiale vers le locus spectral, façon
    ACES. Utile surtout à l'étage film.

### Écarter

Porter leur code ; embarquer la LUT hanatos ; exposer les filtres dichroïques
Y/M/C comme réglage (hors chaîne spectrale, c'est un doublon moins lisible de la
balance des blancs et du Color Grading) ; flou optique et accentuation du scanner
(`nettete` le couvre, et la famille des flous est close) ; voile de scanner ;
tuilage ; stockage fp16 (leur propre mesure est négative) ; grain animé (images
fixes) ; profils ICC. **Déjà chez nous** : diffusion sous-échantillonnée puis
remontée (`blurChain.ts`), mire d'impulsion lumineuse pour la halation
(`mireLampes`), groupes de réglages repliables, pistes de curseur colorées,
retour de gamut à teinte conservée (`clipGamut`).

## 4. Ce que l'audit corrige, chez nous et dans ce que j'ai dit

- **`glow` rend deux filtres, pas un** — Pro-Mist et Black Pro-Mist. Seul
  Glimmerglass manque. Deux auditeurs avaient écrit « un seul ».
- **`halation` compose en lumière linéaire** (`halation.ts:183, 200`) ; seule la
  teinte est choisie en HSL. « Recolorée en sRGB » était faux, dans l'audit comme
  dans mon premier message.
- **`duotone` porte onze réglages**, pas deux.
- **Le commentaire de `gpuContext.ts:12-15` est périmé** : il dit que les masques
  sont créés au format sRGB, alors qu'ils sont en `r8unorm`
  (`maskTextureResolver.ts`). Vérifié.
- **Le registre sur disque porte 27 effets**, avec `aquarelle` — c'est le travail
  non commité d'une autre session, pas le nôtre.

## 5. Ce qui demande Antoine

1. **La posture de licence.** Tant qu'elle n'est pas tranchée, on ne prend que des
   méthodes publiées, des mesures en boîte noire de MÉCANISMES, et du code
   permissif. Embarquer un profil CC BY-SA, ou caler un stock nommé, attend sa
   décision.
2. **Ouvrir ou non l'étage film.** C'est un chantier flou de plusieurs sessions,
   derrière le prérequis 16 bits : il a la forme d'un `/wayfinder`.
3. **L'ordre proposé**, si rien ne s'y oppose : 1 et 2 (les verrous), puis 3 (le
   grain par canal, qu'ils rendent vérifiable), puis 8 (les courbes 1D par canal,
   partagées avec le Color Grading). Le reste attend.
