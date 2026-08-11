# Quelles fonctions retenir, et dans quel ordre

Type: grilling
Status: open
Blocked by: 10
Parent: ../map.md

## Question

[Quelles fonctions de Photoshop et Lightroom compléteraient les nôtres](10-quelles-fonctions-completeraient-les-notres.md)
a instruit **12 fonctions**, en a écarté huit comme doublons et en a rejeté
cinq sur la règle d'Antoine — voir
[`research/10-fonctions-complementaires.md`](../research/10-fonctions-complementaires.md).

**Lesquelles retenir pour ce palier, et dans quel ordre ?**

## Le candidat qui domine, et pourquoi il est à part

**Les quatre modes de fusion non séparables** (Couleur, Luminosité, Teinte,
Saturation). C'est le seul candidat dont l'absence se prouve **par la forme de
l'opérateur** et non par un essai : tous nos modes sont des fonctions canal par
canal (`blend/modes.ts`), donc aucun ne peut préserver la luminance en
changeant la chroma. Ce n'est pas « nous ne l'avons pas encore fait », c'est
« la famille actuelle ne peut structurellement pas le produire ».

Coût le plus bas du document : l'interface est déjà `vec3→vec3`, et
`blendMode` est une **chaîne** (`src/layers/types.ts:58`), donc en ajouter
quatre ne déplace **aucun index de preset** — contrairement à un choix nommé
d'effet, où l'index EST persisté.

Et il solde une dette nommée : le **split-tone**, différé depuis le
2026-07-20 dans `PRD-print-export.md`, devient atteignable par la pile sans
nouvel effet.

## Les quatre autres retenus

- **Netteté / contraste local** — absent, et DOUBLEMENT bloqué : aucun mode de
  fusion signé (ni Différence ni Soustraction), et un effet ne peut lire aucun
  autre calque. ⚠️ **C'est le mot le plus répété du cahier d'Antoine — neuf
  mentions, zéro effet.** Le déséquilibre mérite d'être expliqué avant d'être
  corrigé : est-ce un vrai manque, ou le cahier décrit-il un geste que la pile
  fait autrement ?
- **Carte de déplacement pilotée par une image** — le binding 7 d'ADR-0018 la
  rend bon marché ; `warp` et `glass` déplacent par champ procédural,
  `texture` lit une image mais sort le scan brut.
- **Courbe libre / solarisation** — le shader l'évalue DÉJÀ ; c'est
  `constrainCurvePoint`, côté interface, qui l'interdit. Le coût est donc
  celui de lever une contrainte, pas d'écrire un effet.
- **Masque mesuré sur le composite en dessous** (façon Blend If) — nos sources
  sont ancrées sur la photo ORIGINALE **par décision écrite**. La rouvrir est
  un vrai arbitrage, pas un oubli.

Plus cher et probablement hors de ce palier : groupes de calques (~96 Mo par
niveau, `LayerState` plat à passer en arbre), déformation peinte, pixel
sorting.

## Ce que ce ticket doit produire, en plus d'une liste

Un **ordre**, pas seulement un tri. Les quatre modes de fusion et la courbe
libre lèvent des contraintes existantes ; la netteté et le Blend If ouvrent des
capacités nouvelles. Les premiers rendent les seconds moins chers ou inutiles —
l'inverse n'est pas vrai. L'ordre porte donc de l'information que la liste ne
porte pas.

## La règle qui garde ce ticket honnête

**Le doublon se mesure avant de s'écrire**, et la mesure répond souvent deux
choses (ADR-0016 : 0,005 % d'écart sur un axe, 23,1 % sur l'autre). Les huit
écartées l'ont été sur lecture — dont le **bleach bypass**, jugé atteignable
par deux calques existants, donc un PRESET et non un effet. Avant de clore,
décider lesquelles de ces huit méritent une mesure plutôt qu'une lecture.
