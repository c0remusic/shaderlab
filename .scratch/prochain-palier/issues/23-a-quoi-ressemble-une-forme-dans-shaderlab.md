# À quoi ressemble une forme dans shaderlab

Type: prototype
Status: resolved
Parent: ../map.md

## Question

Antoine, mis devant le périmètre du [ticket 03](03-une-forme-a-t-elle-besoin-de-contentsource.md)
le 2026-08-17 : « je ne sais pas encore — montre-moi ».

C'est une réponse juste et non une esquive : 03 demande de choisir entre un
troisième genre de calque et un effet ordinaire, et ce choix dépend de ce que
« forme » veut dire pour lui — question d'APPARENCE, que ce dépôt a déjà appris à
ne pas trancher sur du texte (les trois constantes de `glass` écrites sur des
specs avant qu'une photo soit ouverte, ROADMAP § aspect du verre).

**À quoi ressemble le besoin réel, montré sur une de ses photos ?**

## Ce qui est construit, et pourquoi celui-là

La chose RÉELLE la moins chère qui puisse répondre : un effet **Couleur unie**,
dans le vrai registre, rendu par le vrai pipeline, borné par les vrais masques.

Pas une maquette HTML. Une maquette dirait ce que shaderlab POURRAIT faire ; le
dépôt a déjà payé la différence entre décrire et montrer, et une planche qui
promet un rendu qu'aucun shader ne produit est pire qu'un refus.

Il montre les deux premiers des trois niveaux, qui sont exactement les deux
demandes du cahier de postproduction :

1. **couleur unie bornée par un MASQUE** — l'ombre graphique du §393 (« formes
   vectorielles noires », `Multiply`, « masque suivant les volumes du corps ») ;
2. **couleur unie bornée par une PRIMITIVE posée** — l'aplat d'espace négatif du
   §453, réglé par une grille.

Le troisième niveau — forme libre à N points, Bézier, perspective — **ne se
prototype pas à ce prix**, et c'est précisément l'information : c'est le seul
qui bute sur `params: Record<string, number>` borné à 48 flottants, donc le seul
qui demande la voie A.

## Ce que ce ticket ne tranche PAS

Le choix lui-même. Il fabrique de quoi le prendre ; c'est
[03](03-une-forme-a-t-elle-besoin-de-contentsource.md) qui le prend.

## Answer

**Le prototype existe, il est au registre, il rend.** `src/render/effects/aplat.ts`,
dix paramètres, une passe, aucune ligne touchée dans `LayerState`.

Trois scènes montées dans la vraie fenêtre sur `photo-1.jpg` (26 Mpx), capturées
par CDP :

| Scène | Ce qu'elle montre | Signature |
| --- | --- | --- |
| **Rectangle** | L'aplat d'espace négatif du §453 : bande crème posée à côté de la photographie, bord franc | moyenne 102,4 / écart 102,6 |
| **Masque, encre claire** | La borne par masque de luminosité : les silhouettes deviennent des formes PLATES, sans détail | moyenne 189,9 / écart 28,4 |
| **Masque, encre noire** | L'ombre graphique du §393 : ombres écrasées en aplat noir, seules les hautes lumières survivent | moyenne 14,3 / écart 21,3 |

### Ce que le prototype établit, et qui ne se devinait pas sur le papier

1. **Les deux demandes du cahier se rendent SANS aucune géométrie nouvelle.**
   L'ombre graphique du §393 ne demande pas de primitive du tout — elle sort d'une
   couleur unie plus un masque de luminosité, deux pièces qui existaient déjà. La
   seule chose qui manquait au dépôt était la couleur unie.
2. **La primitive est du CONFORT, pas une capacité.** Le rectangle sert le cas
   §453, qui veut un bord droit posé sur une grille — un masque au pinceau le
   ferait, mais mal et à la main. Ça reste un argument d'ergonomie, pas de
   modèle : il tient en six flottants.
3. **`appliesWhen` fonctionne dans les deux sens, mesuré ici** : trois curseurs
   affichés en mode masque, neuf en mode rectangle, et la section Forme
   disparaît entièrement quand elle n'a pas d'objet.

### Ce que le prototype ne peut pas montrer, et c'est l'information

La **forme libre** — N points, Bézier, perspective. Elle n'est pas absente par
manque de temps : `params` est un `Record<string, number>` servi par un uniform
`array<f32, 48>`, et une forme à douze points en consomme vingt-quatre pour ses
seules coordonnées. C'est le seul des trois niveaux qui bute sur le modèle, donc
le seul qui puisse justifier la voie A.

⚠️ **Le gate WGSL a attrapé une faute que `tsc` ne voit pas** : `srgb_to_linear3`
appelle le scalaire `srgb_to_linear`, et importer le premier sans le second donne
une chaîne WGSL qui compile côté TypeScript et échoue à la validation. Rappel que
`test:wgsl` est le seul filet sur le contenu d'un `wgsl:`.

Portes : tsc, lint, **1908 tests unitaires**, `gpu-shader-check --origin`
(163 shaders composés, dont les trois variantes d'`aplat`).
