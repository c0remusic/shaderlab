# La migration shadcn est-elle encore la direction

Type: grilling
Status: open
Parent: ../map.md

## Question

`CLAUDE.md` annonce depuis le 2026-07-20 : « Migration en cours composant par
composant : `ErrorBanner`/`Toolbar`/`BrushToolbar` migrés ; `LayerPanel`/
`ParamPanel`/`Canvas` encore en CSS classique. » Ça décrit une dette de **trois**
composants.

**Mesuré le 2026-08-12 : il y en a dix-sept.**

| Mesure | Valeur |
| --- | --- |
| Composants (`src/components/*.tsx`, hors stories) | 27 |
| Fichiers `.css` classiques dans `src/components/` | 20 |
| Composants en **CSS classique pur** (aucune classe Tailwind) | **17** |
| Composants hybrides (`.css` + Tailwind) | 1 |
| Composants migrés par le plan | 3 |

**Et la migration n'a pas calé — elle s'est fait DÉPASSER.** Le plan
`docs/superpowers/plans/2026-07-20-shadcn-migration.md` ne visait que trois
composants et disait explicitement « ne jamais toucher `LayerPanel`,
`ParamPanel`, `Canvas` — hors-scope ». Il a donc été **fini comme prévu**. Ce
qui a changé, c'est tout ce qui est arrivé après :

| Composant | Créé le | Style |
| --- | --- | --- |
| `ToolPalette` | 2026-07-31 | CSS classique |
| `CurveControl` | 2026-08-04 | CSS classique |
| `PropertiesPanel` | 2026-08-04 | CSS classique |
| `ColorRampControl` | 2026-08-04 | CSS classique |
| `TexturePicker` | 2026-08-05 | CSS classique |

Chaque chantier livré depuis trois semaines a ajouté des composants **dans le
style que la documentation déclare en cours d'abandon**. Personne n'a décidé
d'arrêter la migration ; personne n'a décidé de la continuer non plus.

**La migration shadcn/Tailwind est-elle encore la direction ?**

## Les deux réponses, et ce qu'elles coûtent chacune

- **OUI** → la dette est de 17 composants, pas 3, et le vrai problème n'est pas
  de les migrer mais **d'arrêter d'en produire** : sans une règle qui morde au
  moment où un composant est écrit, la migration restera toujours en retard sur
  la création. C'est exactement la forme d'ADR-0001 (« tout élément ajouté passe
  la checklist AU MOMENT où il est ajouté, jamais dans un lot de rattrapage »),
  et cette règle existe parce qu'elle a déjà été enfreinte le jour de sa pose.
- **NON** → alors `CLAUDE.md` § Stack est faux sur un point structurant, les
  trois composants migrés sont l'anomalie et non l'avant-garde, et il faut le
  dire au lieu de laisser « migration en cours » vieillir. Le socle Tailwind v4
  + tokens reste utile même sans migrer les panneaux — ce n'est pas un retrait
  du design system.

## Ce qu'il faut interroger

- **Qu'est-ce que la migration a réellement apporté sur les trois migrés ?**
  Trois semaines de recul existent. Si la réponse est « rien de visible », c'est
  un argument, et il se mesure sur pièce plutôt qu'au ressenti.
- **`npm run lint:tokens` est vert sur les 250 fichiers**, CSS classique
  compris. Donc le CSS classique **ne contourne pas les tokens** — la dette
  n'est pas une dette de design system, c'est une dette d'homogénéité. Ce n'est
  pas le même degré d'urgence, et le dire change la réponse.
- **Qu'est-ce qui a poussé chaque nouveau composant vers le CSS classique ?**
  La proximité des voisins, l'absence de règle, ou une vraie inadéquation de
  Tailwind à ces contrôles (poignées sur toile, courbes, rampes) ? La troisième
  réponse serait un verdict d'usage — même famille que le retrait de
  `surfaceBlur` (ADR-0011) — et elle trancherait toute seule.
- **Le dock est déjà stabilisé** (`PanelColumn`/`DockedPanelCard`) et
  `components/` ne porte aucune logique métier. Une migration de style y est
  donc peu risquée fonctionnellement — mais elle touche 17 fichiers, et le seul
  filet est Storybook (305 tests).

## Contraintes dures

- Les tokens de marque (`src/design/{primitives,semantic,components}.css`)
  restent la **seule** source de vérité couleur/espacement/rayon. Le thème
  Tailwind les LIT (`src/design/tailwind-theme.css`), ne les redéfinit jamais.
- `react-resizable-panels` a été **retiré** le 2026-07-21 : ne rien proposer
  qui suppose un dock redimensionnable.
- Ne pas citer `FloatingPanel` ni `src/components/floatingPanel/` — supprimés.
- Le style shadcn de ce dépôt est **`base-nova`, PAS Radix** (`components.json`).

## Une sortie de portée est une réponse valide

Si la conclusion est « on gèle la migration et on assume l'hétérogénéité », elle
va dans **Out of scope** de la carte avec sa raison — et `CLAUDE.md` se corrige
dans le même geste. Ce qui n'est pas acceptable est de laisser le document dire
« en cours » pendant que l'écart grandit à chaque chantier.
