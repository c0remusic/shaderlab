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

⚠️ **TROIS conclusions fausses dans ce fil, toutes du même type** : conclure
d'une ABSENCE constatée à l'endroit où j'avais regardé. Détail dans le document
`affinity-binaire`, § « La leçon ». La règle qui en sort et qui vaut pour toute
la carte : **une absence ne se conclut que si on peut dire OÙ on a cherché et
pourquoi c'était le bon endroit.**

## La destination

Deux questions, et elles ne se répondent pas ensemble.

**Q1 — shaderlab doit-il exister ?** Rouverte par les relevés, pas fermée. Un
plugin `.8bf` est techniquement possible ; ce qu'on y gagnerait et perdrait
n'est pas chiffré.

**Q2 — que prendre à Affinity, dans shaderlab tel qu'il est ?** Répondable tout
de suite, et c'est là que sont les tickets.

## Ce qui RESTE — les tickets

### Décider (Q1)

- [01 — Le contrat `.8bf` réel](issues/01-contrat-8bf.md) · `research`
  Un filtre Photoshop est-il appliqué UNE FOIS chez Affinity, ou enveloppé en
  filtre live ? La différence décide de Q1 à elle seule.
- [02 — Le langage de la texture procédurale](issues/02-langage-texture-procedurale.md) · `research`
  Combien de nos 27 effets s'y expriment ?
- [12 — Un plugin améliorerait-il les PERFS ? La QUALITÉ ?](issues/12-plugin-perfs-et-qualite.md) · `research`
  ⭐ Question d'Antoine, et **ce n'est pas le ticket 01** : celui-là demande si
  c'est possible, celui-ci si ce serait MEILLEUR. Deux axes indépendants — le
  gain de perf viendrait de notre code, le gain de qualité de l'HÔTE.
  ⚠️ L'hypothèse « du natif, donc plus rapide » est probablement fausse : notre
  coût dominant mesuré est la cohérence de CACHE, pas la couche d'abstraction.
  Et un `.8bf` par effet ferait N allers-retours CPU↔GPU là où notre pile en
  fait zéro.

### Prendre — le mécanisme existe déjà chez nous

- [03 — Texturer le masque](issues/03-texturer-le-masque.md) · `task`
  ⭐ La plus alignée du relevé. Le binding 7 charge déjà des images.
- [04 — Plage tonale sur `glow`](issues/04-plage-tonale-glow.md) · `task`
  ⭐ `tonalRangeControl` existe, utilisé par `curves`.
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

### Chantiers

- [09 — Masque par bande de fréquence](issues/09-masque-bandpass.md) · `prototype`
- [10 — Pinceau d'effet](issues/10-pinceau-d-effet.md) · `prototype`

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
**dix-huit** de nos effets sans équivalent chez eux. Les deux bibliothèques ne
visent pas la même chose — la leur est photographique et retouche, la nôtre
optique, analogique et imprimée. **Un ticket qui propose de copier une
fonctionnalité doit dire quel GESTE elle débloque chez NOUS**, sinon il n'a rien
à faire ici.

**Deux choses sont ÉCARTÉES, pas oubliées** : le flou bilatéral (retiré par
ADR-0011 sur arbitrage d'usage — leur `Bilateral` n'est donc pas un manque), et
le moteur de pinceau à dynamiques, nozzles et mélange pigmentaire Mixbox — nous
peignons des masques, pas de la peinture.
