# La migration shadcn est-elle encore la direction

Type: grilling
Status: resolved
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

---

## Answer — RÉSOLU le 2026-08-18

**Ni oui ni non : on NOMME le patron qui a déjà gagné** (arbitrage d'Antoine).
Et la mesure a corrigé le ticket dans les deux sens — la dette est pire qu'il ne
disait sur un axe, et **quatre fois moindre** sur celui qui compte.

### La règle, telle qu'elle doit être écrite

> **Un composant compose les primitives `src/components/ui/` pour tout ce qui
> est un CONTRÔLE — bouton, curseur, sélecteur, case, bascule — et habille sa
> MISE EN PAGE en CSS classique à noms BEM.**
>
> Ce n'est ni « migrer vers Tailwind » ni « rester en CSS » : les deux couches
> ont chacune leur travail. Un contrôle écrit à la main est le défaut ; une
> grille de panneau écrite en utilitaires ne l'est pas.

Elle se pose comme ADR-0001 : **au moment où le composant s'écrit, jamais dans
un lot de rattrapage.** C'est cette forme-là qui manquait, et c'est pourquoi
cinq composants sont arrivés en trois semaines dans un style que la
documentation déclarait en cours d'abandon.

### Ce que la re-mesure du 2026-08-18 a trouvé, et qui n'était pas dans le ticket

Le ticket comptait 27 composants et 17 en CSS classique (mesure du 2026-08-12).
Re-mesuré sur 30 composants applicatifs, hors stories et hors les 13 primitives
`ui/` :

| | Composants |
| --- | --- |
| CSS classique (noms BEM) | **24** |
| Hybride (BEM + utilitaires Tailwind) | 3 — `EffectPicker`, `ErrorBanner`, `Toolbar` |
| **Tailwind PUR** | **0** |
| Sans style propre | 3 |

⚠️ **Zéro composant n'a jamais été entièrement migré.** Ce que le plan de
2026-07-20 a produit, ce sont **trois hybrides**, pas trois migrés — et
`CLAUDE.md` annonce `BrushToolbar` parmi eux alors qu'il porte son propre
`BrushToolbar.css` et n'a aucun utilitaire. La phrase « ErrorBanner / Toolbar /
BrushToolbar migrés » est fausse sur un tiers et généreuse sur le reste.

⚠️ **Et mon premier comptage était faux, pour la troisième fois de la journée
sur le même schéma.** J'ai d'abord testé « le composant importe-t-il un
`.css` ? », ce qui range `ToolPalette`, `BrushToolbar` et `EmptyWorkspace` en
« ni l'un ni l'autre » alors qu'ils portent des classes BEM dont la feuille est
ailleurs. **Un test qui interroge la forme du CODE au lieu de la nature de la
CHOSE se trompe silencieusement.** Le test juste regarde ce que les classes
SONT, pas d'où le fichier les importe.

### Le payoff, et c'est la raison de répondre ça plutôt qu'autre chose

Mesuré sous la règle ci-dessus — un composant est conforme s'il compose des
primitives `ui/` :

| | Composants |
| --- | --- |
| **Déjà conformes** | **24 / 30** |
| **Contrôles écrits à la main** (le vrai reste) | **4** |
| Aucun contrôle, rien à migrer par construction | 2 |

**La dette passe de 17 à 4.** Elle ne diminue pas parce qu'on baisse la barre —
elle diminue parce que la barre était mal placée : elle mesurait le style de
l'habillage au lieu de la provenance des contrôles.

Les quatre : **`CurveControl`**, **`EffectPicker`**, **`PropertiesPanel`**,
**`TexturePicker`**.

⚠️ Et `EffectPicker` est **l'un des trois hybrides** — celui qui avait l'air le
plus avancé. Son champ de recherche est un `<input>` écrit à la main sous des
classes utilitaires. Sous l'ancienne grille il passait pour migré ; sous la
bonne, il fait partie du reste à faire. C'est le meilleur argument pour la
règle : elle range différemment, et mieux.

### Ce que ça ne dit pas, et qu'il ne faut pas lui faire dire

- **Ce n'est pas un verdict sur Tailwind.** Les 13 primitives `ui/` sont en
  Tailwind, utilisées par 24 composants sur 30, et rien ici ne les remet en
  cause. Le socle est porteur.
- **La dette n'a jamais été une dette de design system.** `lint:tokens` est vert
  sur les 261 fichiers, CSS classique compris : aucun style ne contourne un
  token. C'était une dette d'homogénéité, et la règle la requalifie plutôt
  qu'elle ne l'efface.
- **Les trois hybrides ne deviennent pas des anomalies à corriger.** Rien
  n'oblige à retirer leurs utilitaires ; la règle porte sur les CONTRÔLES.

### Ce qui doit se corriger dans le même geste

`CLAUDE.md` § Stack annonce depuis le 2026-07-20 une « migration en cours
composant par composant » et, depuis le 2026-08-12, une dette de 17. Les deux
formulations tombent. Corrigé dans le commit qui porte cette résolution — laisser
le document dire « en cours » est précisément la faute que ce ticket
diagnostique.

## Une sortie de portée est une réponse valide

Si la conclusion est « on gèle la migration et on assume l'hétérogénéité », elle
va dans **Out of scope** de la carte avec sa raison — et `CLAUDE.md` se corrige
dans le même geste. Ce qui n'est pas acceptable est de laisser le document dire
« en cours » pendant que l'écart grandit à chaque chantier.
