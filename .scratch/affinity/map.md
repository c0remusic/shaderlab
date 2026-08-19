# Carte — Affinity comme référence, et comme voisin

Label : `wayfinder:map`
Chartée le 2026-08-19, après quatre relevés sur l'application et ses binaires.

## D'où ça vient

Antoine, le 2026-08-19 : « on annule tout, on va se baser sur affinity pour le
design de l'appli », puis « ça serait pas plus simple de porter nos effets dans
affinity plutôt que de construire shaderlab ? », puis « et en lisant le
binaire ? », puis « full scope ».

**Rien n'a été annulé** — arbitrage du même jour : relever d'abord, décider
ensuite. Le code du 2026-08-19 (dock à onglets, retrait de la carte Textures,
quatre verrous) est intact sur `master`.

## Les quatre relevés, et ce que chacun a coûté en erreurs

| Document | Ce qu'il établit |
| --- | --- |
| [`affinity-observations`](../../docs/design-system/affinity-observations-2026-08-19.md) | l'interface réelle, capturée sur la fenêtre d'Antoine |
| [`affinity-porter-les-effets`](../../docs/design-system/affinity-porter-les-effets-2026-08-19.md) | le SDK JS : 5,2 s par passe, ~83× trop lent |
| [`affinity-binaire`](../../docs/design-system/affinity-binaire-2026-08-19.md) | OpenCL, et **deux** portes ouvertes |
| [`affinity-full-scope`](../../docs/design-system/affinity-full-scope-2026-08-19.md) | outils, masques, sélections, UX, UI |
| [`affinity-ce-quon-peut-lui-prendre`](../../docs/design-system/affinity-ce-quon-peut-lui-prendre-2026-08-19.md) | six idées à prendre, trois où nous sommes devant |
| ⭐ [`affinity-plugin-verdict`](../../docs/design-system/affinity-plugin-verdict-2026-08-19.md) | **le verdict mesuré** : perfs, qualité, et ce qui a été pris |
| ⭐ [`affinity-audit`](../../docs/design-system/affinity-audit-2026-08-19.md) | **LE CHAPEAU** — l'audit full scope consolidé par axe (outillage, effets, code, UI, UX), avec niveaux de preuve, chemins d'implémentation, et NEUF candidats sans ticket que les catalogues portaient sans qu'aucun relevé ne les ait synthétisés (export, historique visible, raccourcis) |

⚠️ **SIX conclusions fausses dans ce fil, toutes du même type** : conclure
d'une ABSENCE constatée à l'endroit où j'avais regardé. Détail des quatre
premières dans `affinity-binaire` § « La leçon » ; les cinquième et sixième
(« le chemin live n'est pas pilotable », « aucun accès buffer aux pixels »)
sont tombées le soir même en auditant les outils internes — les réponses
étaient dans `nodes.js` et `rasterobject.js`, deux fichiers du même SDK
(voir l'encadré du verdict et l'audit, axe 5 point 7). La règle qui en sort
et qui vaut pour toute la carte : **une absence ne se conclut que si on peut
dire OÙ on a cherché et pourquoi c'était le bon endroit.**

**La quatrième est la plus chère du lot** (2026-08-19, corrigée le soir même) :
« le SDK ne pilote pas les filtres d'Affinity, même les siens ». Faux —
`commands.js` en expose une trentaine, plus une vingtaine d'ajustements. Ils ne
sont pas des méthodes de `Document` mais des `DocumentCommand`, dans un AUTRE
fichier du même SDK. Corollaire à ajouter aux trois autres : **une absence
constatée dans un fichier de SDK ne se conclut qu'après avoir cherché dans les
autres fichiers du même SDK.**

Ce que cette correction a débloqué : **on peut piloter leurs filtres, relire les
pixels et comparer aux nôtres.** Tout ce qui suit en sort — et c'est la seule
méthode admissible ici, puisque recopier leur implémentation serait du dérivé et
non de l'interopérabilité.

## La destination

Deux questions, et elles ne se répondent pas ensemble.

**Q1 — shaderlab doit-il exister ?** ✅ **REFERMÉE le 2026-08-19, par mesure des
deux côtés** (ticket 12). Un plugin `.8bf` reste techniquement possible et il
serait **plus LENT** : leur filtre natif le moins cher coûte 136 ms sur 26 Mpx
quand notre pile entière à cinq effets recompose en 23 ms. Le gain de qualité,
lui, vient de leur HÔTE et est atteignable chez nous pour moins cher
(ticket 11). Ce qui restait à trancher — le contrat `.8bf` du ticket 01 — ne
décide donc plus de rien.

⚠️ Ce que la mesure NE dit pas : elle ne compare pas notre pile à leur aperçu de
filtre LIVE, qui n'est pas pilotable par le SDK. Elle compare une recomposition
à résolution native à une application destructive, qui est justement le régime
d'un `.8bf`.

**Q2 — que prendre à Affinity, dans shaderlab tel qu'il est ?** Répondable tout
de suite, et c'est là que sont les tickets.

## Ce qui RESTE — les tickets

### Décider (Q1) — ✅ SOLDÉ

- ✅ [12 — Un plugin améliorerait-il les PERFS ? La QUALITÉ ?](issues/12-plugin-perfs-et-qualite.md) · `research`
  **Fermé le 2026-08-19 : non aux deux.** L'hypothèse « du natif, donc plus
  rapide » n'était pas seulement fausse, elle était inversée — 6 à 25 fois en
  notre faveur. Verdict et protocole :
  [`affinity-plugin-verdict`](../../docs/design-system/affinity-plugin-verdict-2026-08-19.md).
- [01 — Le contrat `.8bf` réel](issues/01-contrat-8bf.md) · `research`
  Ouvert, mais **plus bloquant** : le ticket 12 a répondu à Q1 sans lui. Un
  indice penche vers « appliqué une fois » (leur plugin est enveloppé par un
  `RasterFilterPluginWrapper`, et « RasterFilter » est chez eux la famille
  destructive). Trancher demande d'installer un `.8bf` tiers — accord d'Antoine
  requis, et à faire seulement s'il veut la réponse pour elle-même.
- [02 — Le langage de la texture procédurale](issues/02-langage-texture-procedurale.md) · `research`
  Combien de nos 27 effets s'y expriment ? ⚠️ Sa valeur a changé de nature : il
  ne sert plus Q1 (close) mais l'idée de sa dernière section — **prototyper un
  effet avant de l'écrire en WGSL**. Et une mesure de plus le rend moins
  probable : le filtre n'a **aucune commande dans le SDK**, donc il n'est
  ouvert qu'à un humain dans l'interface.

### Prendre — le mécanisme existe déjà chez nous

- [03 — Texturer le masque](issues/03-texturer-le-masque.md) · `task`
  ⭐ La plus alignée du relevé. Le binding 7 charge déjà des images.
- ✅ [04 — Plage tonale sur `glow`](issues/04-plage-tonale-glow.md) · `task`
  **Livré le 2026-08-19, mais PAS ce que le ticket décrivait.** La mesure a
  démenti sa prémisse : leurs trois curseurs ne gatent pas la SOURCE du halo,
  ils décident dans quels tons du RECEVEUR la lumière est reposée, avec un
  PLANCHER sous lequel il ne se passe rien. C'est le plancher qui a été repris,
  sur un seul axe — la **retenue des noirs**, qui donne à `glow` le *Black*
  Pro-Mist que son propre en-tête citait sans le rendre. `tonalRangeControl`
  n'a PAS servi : il décrit quatre bornes, il en fallait deux.
- [05 — Couleur de surimpression du masque](issues/05-couleur-surimpression.md) · `task`
  La nôtre est rouge en dur, invisible sur une photo rouge.
- [06 — Les modes de fusion manquants](issues/06-modes-de-fusion.md) · `task`
  Ils en ont ~32, nous 17. Et deux mécanismes autour : `BlendGamma` réglable et
  `BlendRanges`.

### Trancher une POSITION, pas combler un manque

- [07 — Sélection : en avons-nous besoin ?](issues/07-selection-ou-masque.md) · `grilling`
  Leur modèle a sélections ET masques ; le nôtre n'a que des masques. Défendable,
  jamais écrit.
- [08 — Ajustement contre filtre](issues/08-ajustement-contre-filtre.md) · `grilling`
  Ils séparent « par pixel » de « par voisinage ». Nos six catégories
  éditoriales ne portent pas cette frontière.

### Pris hors ticket, parce que la mesure l'a fait apparaître

- ✅ **Feather en S** (2026-08-19 au soir). Leur feather mesuré au pixel est
  un erf (σ ≈ 0,4·rayon) ; le nôtre était une rampe box à deux cassures.
  Livré en UNE passe — quatre fenêtres pondérées sur la MÊME SAT
  (`FEATHER_WINDOWS`, mask/refineEdgeWgsl.ts), le cache de la table et le
  coût plat au rayon survivent. Écart au erf ≤ 0,045 borné par test ; mire
  dédiée `masque-feather-fort` (les scénarios existants, à feather 2-6, ne
  MONTRAIENT pas le S — leçon du verrou aveugle).
- ✅ **Morphologie octogonale** (2026-08-19 au soir). Leur grow est un disque
  euclidien (flag `circular` mesuré) ; notre contract/dilate était un carré
  qui débordait de 41 % en diagonale. Livré : passes D1/D2 + `octagonRadii`
  (extension axiale exacte, ±14 % au pire en diagonale, preuve de Minkowski
  au test).
- ✅ **Courbure des lames sur `lensBlur`** (2026-08-19). Leur
  `LensBlurFilterParameters` porte un `bladeCurvature` qu'aucun ticket n'avait
  relevé — le décompte de paramètres de la veille comparait des NOMBRES
  (lensBlur 11 contre 7) sans regarder lesquels. Rendu sur cinq sources
  ponctuelles : pentagone à arêtes droites à 0, disque à 1. Une lame réelle est
  un arc. Livré dans `effects/aperture.ts`, donc partagé avec `lensFlare` — un
  objectif n'a qu'un diaphragme. Écart au vrai arc **borné par un test** :
  0,16 % à six lames, 3,16 % au pire (le triangle).

### Chantiers

- [09 — Masque par bande de fréquence](issues/09-masque-bandpass.md) · `prototype`
- [10 — Pinceau d'effet](issues/10-pinceau-d-effet.md) · `prototype`

### Candidats SANS ticket — relevés par l'audit du 2026-08-19, à charter si voulus

L'[audit](../../docs/design-system/affinity-audit-2026-08-19.md) § Récapitulatif
les liste. Les neuf du relevé initial (export réglable/PNG, panneau
Historique, raccourcis centralisés, presets de masque, copie de masque entre
calques, snapping système, deux zones fixes du panneau Calques, Glitch par
canal sur `sliceShift`, LUT 3D), plus ceux de l'audit des outils internes du
soir : le **smooth géométrique** (mesuré chez eux — arrondit la FORME en
gardant le bord net ; ⚠️ change le sens du curseur `smooth`, arbitrage
d'Antoine requis, les passes D1/D2 dont il a besoin existent depuis les
prises ci-dessus), le stabilisateur de trait, le lot « développement »
(WhiteBalance/Exposure/Vibrance/HSL, moitié Lightroom de l'hybride), et le
**chantier calque de retouche** (pixels peints — le préalable structurel de
clone/healing/inpainting/dodge/burn, ADR d'abord). Les deux autres mesures au
pixel du soir (feather en S, grow en disque) sont PRISES — voir « Pris hors
ticket ». Aucun candidat n'est ouvert d'office : la règle des notes
s'applique — un geste nommé chez NOUS, sinon rien.

### Débloquer un chantier ARRÊTÉ ailleurs

- [11 — Débloquer le 16 bits](issues/11-debloquer-le-16-bit.md) · `grilling`
  ⭐ **Le relevé a débloqué un arbitrage que le dépôt avait laissé ouvert en
  toutes lettres.** L'export print bute sur « sRGB par le FORMAT » contre
  « aucun format flottant n'a de variante `-srgb` », et
  `01-16-bit-hors-du-depot.md` §1.7 conclut « ce document ne choisit pas lequel
  céder ». Affinity montre une TROISIÈME voie : ne pas choisir, retirer au
  format le rôle de porter l'espace. Détail :
  [`research/01-comment-affinity-fait-le-16-bit`](research/01-comment-affinity-fait-le-16-bit.md).

## Notes — contraintes permanentes de cet effort

**Lecture seule sur les binaires.** Recherche d'interopérabilité sur une copie
licenciée. Aucun binaire modifié, aucune protection touchée, rien redistribué.
Cette limite ne se négocie pas, quel que soit le ticket.

**Un nom de symbole prouve l'EXISTENCE, jamais la qualité.**
`BandpassMaskRasterNode` existe ; ce qu'il rend ne se lit pas dedans. Tout
ticket qui part d'un symbole doit REGARDER le résultat dans Affinity avant
d'écrire une ligne — la règle du dépôt sur les apparences
(`apparence-ne-se-deduit-pas-d-une-spec`).

**Nous ne sommes pas en retard partout, et le relevé le prouve** : `motionBlur`
7 paramètres contre 2, `texture` 9 contre 3, `lensBlur` 11 contre 7, et
**dix-huit** de nos effets sans équivalent chez eux.
⚠️ **AMENDÉ le 2026-08-19 au soir** : cette note disait « les deux
bibliothèques ne visent pas la même chose — la leur est photographique et
retouche, la nôtre optique, analogique et imprimée ». Antoine a corrigé :
**la retouche est AUSSI notre territoire — l'app est un hybride
Photoshop/Lightroom.** La frontière qui reste vraie est plus étroite : pas
d'IA embarquée, pas de peinture COULEUR. **Un ticket qui propose de copier une
fonctionnalité doit dire quel GESTE elle débloque chez NOUS**, sinon il n'a rien
à faire ici — la règle tient, le périmètre des gestes recevables s'est élargi.

**Deux choses sont ÉCARTÉES, pas oubliées** : le flou bilatéral (retiré par
ADR-0011 sur arbitrage d'usage — leur `Bilateral` n'est donc pas un manque), et
le moteur de pinceau à dynamiques, nozzles et mélange pigmentaire Mixbox — nous
peignons des masques, pas de la peinture.
