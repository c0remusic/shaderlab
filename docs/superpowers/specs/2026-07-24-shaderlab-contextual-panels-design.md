# Panneaux contextuels (Réglages/Masque) + rail d'icônes manuel

**Statut** : direction confirmée par Antoine après wireframes itératifs —
**relecture du présent design doc EN ATTENTE** avant passage à
`writing-plans`. Ne pas traiter ce document comme validé tant qu'Antoine ne
l'a pas explicitement confirmé.

## Contexte et origine

Suite directe de la session duotone/posterize (2026-07-24) : en ajoutant un
sélecteur de couleur (swatch → picker) au `ColorGroupControl` du panneau
Réglages, Antoine a proposé de généraliser le principe d'affichage
contextuel (apparaît/disparaît selon une condition) à Réglages et Masque
eux-mêmes, plutôt que de les garder comme panneaux dockés toujours présents.

Ce chantier correspond exactement au **rail d'icônes** déjà identifié et
explicitement laissé hors scope lors de la refonte des panneaux dockés
(`docs/superpowers/specs/2026-07-20-shaderlab-docked-panels-design.md` §
Hors scope, référencé comme `PRD-floating-panel-rail.md` — ce fichier PRD
séparé n'a en réalité jamais été écrit, seulement mentionné). Ce document
reprend ce fil laissé en attente depuis le 2026-07-20/21.

Référence visuelle fournie par Antoine : capture d'écran de Photoshop
desktop montrant un rail d'icônes fixe (Calques/Réglages/Historique/
Partage/Commentaire) qui bascule manuellement quelle carte est visible,
les cartes visibles s'empilant verticalement dans une colonne unique,
chacune avec son propre bouton fermer (X).

Direction validée par itération de wireframes (`mcp__visualize`, jetables,
non committés) : rail à droite du dock existant, panneaux Calques/Réglages/
Masque unifiés sous un seul mécanisme, le picker couleur restant **à part**
(position fixe, hors dock, pas d'icône rail — décision explicite d'Antoine
après une hésitation initiale).

## Périmètre

**Dans le scope** :
- Un hook générique `useContextualPanel` (visibilité combinant condition
  automatique + préférence manuelle explicite).
- Application de ce hook aux 3 panneaux existants du dock : Calques,
  Réglages, Masque.
- Un nouveau composant `PanelRail` (icônes de bascule manuelle).
- Le composant `ColorPickerPanel` (swatch → picker HSL, SV square + bande de
  teinte + hex) pour le `ColorGroupControl` du duotone — implémenté en
  parallèle car c'est ce qui a motivé ce chantier, mais **ne passe pas** par
  `useContextualPanel` (voir plus bas).

**Hors scope** :
- Toute modification de `PanelColumn.tsx`/`DockedPanelCard.tsx`/
  `dockLayout.ts` — ces fichiers restent inchangés. Le mécanisme filtre
  uniquement le tableau `panels` passé à `PanelColumn` ; drag-reorder,
  largeur partagée et positionnement 2D restent exactement ce qu'ils sont
  aujourd'hui.
- Persistance inter-session du layout/de la visibilité : `dockLayout` est
  aujourd'hui un `useState` en mémoire (pas de `localStorage`), et ce
  chantier ne change pas ça — "le logiciel se souvient du layout" veut dire
  *pendant la session courante*, pas après un rechargement de l'app.
- Historique/Partage/Commentaire (panneaux visibles sur la référence
  Photoshop mais sans équivalent fonctionnel dans shaderlab aujourd'hui).

## Le mécanisme : `useContextualPanel`

```ts
function useContextualPanel(
  conditionMet: boolean,
  triggerKey: string | null
): { visible: boolean; dismiss: () => void; toggleRail: () => void }
```

Le hook garde en état `{ key: string | null; override: "open" | "closed" }
| null` (une préférence manuelle, valable seulement tant que `triggerKey` ne
change pas) :

- `visible = override === "open" || (override === null && conditionMet)`
  — quand aucune préférence n'a été posée pour ce `triggerKey`, la
  condition automatique décide seule.
- `dismiss()` pose `override = "closed"` pour le `triggerKey` courant (bouton
  X de la carte).
- `toggleRail()` bascule entre `"open"` et `"closed"` par rapport à l'état
  visible ACTUEL (clic sur l'icône du rail) — fonctionne même si
  `conditionMet` est faux (force l'ouverture, affiche l'état vide existant).
- Dès que `triggerKey` change (nouvelle sélection de calque), toute
  préférence posée pour l'ancien `triggerKey` est ignorée — la condition
  automatique reprend la main pour le nouveau `triggerKey`. C'est la RÈGLE
  UNIQUE, valable pour le X et pour le rail, confirmée par Antoine.

**Câblage par panneau** (dans `App.tsx`) :

| Panneau  | `conditionMet`                | `triggerKey`                  |
|----------|--------------------------------|--------------------------------|
| Calques  | `true` (toujours)               | `"static"` (constant)          |
| Réglages | `selectedLayer !== null`        | `selectedLayer?.id ?? null`    |
| Masque   | `selectedLayer !== null`        | `selectedLayer?.id ?? null`    |

Calques passe par le même hook que les deux autres (uniformité du
mécanisme demandée par Antoine) — sa condition est toujours vraie, mais il
reste togglable manuellement via le rail comme dans la référence Photoshop.

**Pourquoi ce hook plutôt qu'un contrôleur central ou un dock "condition-aware"**
(2 approches écartées en brainstorming) :
- Un contrôleur central serait une couche d'orchestration pour seulement 3
  panneaux sans règle de coordination réelle entre eux — sur-ingénierie
  (YAGNI).
- Rendre `PanelColumn`/`DockedPanelCard` condition-aware coderait une notion
  métier ("trigger", "condition") dans un composant déjà stabilisé sur
  plusieurs sessions passées (drag-reorder, largeur partagée) — couplage
  qui fuiterait un détail d'implémentation dans son interface, pour un gain
  nul (le filtrage du tableau `panels` en amont suffit).
- `triggerKey` est un `string | null` générique, pas lié aux calques : un
  futur panneau contextuel réutilise le hook tel quel, sans modification.

## `PanelRail`

Nouveau composant, une colonne d'icônes fixe (à droite du dock, comme la
référence Photoshop) :

```ts
interface PanelRailItem {
  id: string;
  icon: React.ComponentType; // lucide-react, cohérent avec le reste du dock
  label: string;             // aria-label
  active: boolean;           // = panel.visible, pour le style surligné
  onClick: () => void;       // = panel.toggleRail
}
```

3 items (Calques/Réglages/Masque), boutons natifs `<IconButton>` (déjà
utilisé ailleurs dans le dock — cf. `DockedPanelCard.tsx`), pas de nouvelle
primitive de bouton. États : actif (surligné, `--surface-selected`) / inactif
(neutre) — pas de désactivation grisée, tous les items restent cliquables à
tout moment (cliquer Réglages sans calque sélectionné force l'état vide,
comportement confirmé par Antoine).

## `ColorPickerPanel` (hors `useContextualPanel`)

État local simple dans `App.tsx` (pas un hook générique — un seul
consommateur, condition triviale) :

```ts
const [colorPicker, setColorPicker] = useState<{
  layerId: string;
  key: string;
  label: string;
  hue: EffectParam;
  saturation: EffectParam;
  lightness: EffectParam;
} | null>(null);
```

Rendu conditionnel : `colorPicker && selectedLayer?.id === colorPicker.layerId`
(garde-fou anti-référence périmée si le calque change/disparaît). Fermeture :
bouton X propre au composant, ou automatiquement si `selectedLayer` change
(le garde-fou ci-dessus suffit, pas besoin d'un `useEffect` de reset).
Position : `position: absolute` ancré au bord gauche du dock (calculé depuis
`dockWidth`, déjà suivi dans `App.tsx`), **pas** de slot dans `dockLayout`,
**pas** d'icône dans `PanelRail` — décision explicite d'Antoine.

`ColorGroupControl` (`src/components/ui/color-group-control.tsx`) gagne un
prop `onOpenPicker?: () => void` sur le swatch (bouton natif désormais, pas
un `<span>`, pour l'accessibilité clavier) — `stopPropagation()` pour ne pas
aussi déclencher le disclosure existant.

Conversion hex ↔ HSL : `src/ui/hsl.ts` a déjà `hslToHex` ; ce chantier y
ajoute `hexToHsl` (inverse), utilisé par le champ hex du picker.

## Fichiers touchés

- `src/ui/contextualPanel.ts` (nouveau) — le hook, testable en isolation
  (pas de DOM, state machine pure).
- `src/components/dockedPanel/PanelRail.tsx` (+ `.css`, nouveau).
- `src/components/ColorPickerPanel.tsx` (+ `.css`, nouveau) — SV square +
  bande de teinte (canvas + pointer drag) + champ hex.
- `src/ui/hsl.ts` — ajout `hexToHsl`.
- `src/components/ui/color-group-control.tsx` — swatch devient un bouton,
  nouveau prop `onOpenPicker`.
- `src/components/ParamPanel.tsx` — thread `onOpenColorPicker` à travers
  `groupEffectParams`/`ColorGroupControl`.
- `src/App.tsx` — 3 instances de `useContextualPanel`, état `colorPicker`,
  filtrage du tableau `panels`, rendu de `PanelRail` et `ColorPickerPanel`.

**Non touchés** : `PanelColumn.tsx`, `DockedPanelCard.tsx`, `dockLayout.ts`,
`dockWidth.ts`.

## Tests

- `contextualPanel.test.ts` : le hook en isolation (state machine pure,
  aucun rendu React nécessaire au-delà de `renderHook`) — cas couverts :
  condition seule (pas de préférence posée), dismiss puis même trigger
  (reste fermé), dismiss puis trigger différent (condition reprend la
  main), toggleRail force l'ouverture avec condition fausse, toggleRail
  ferme un panneau ouvert par condition.
- `hsl.test.ts` (existant, étendu) : `hexToHsl` — round-trip avec
  `hslToHex` sur un échantillon de couleurs, cas limites (`#000000`,
  `#ffffff`, gris purs `s=0`).
- Pas de test de rendu pour `PanelRail`/`ColorPickerPanel` (convention du
  projet : aucun test ne rend de composant React, cf. `CLAUDE.md` § Stack).
  Vérification visuelle via CDP/checkpoint humain, comme le reste de l'UI.

## Risques / points d'attention

- Le garde-fou `colorPicker.layerId === selectedLayer?.id` doit être vérifié
  à CHAQUE rendu (pas seulement à l'ouverture) — sinon un calque supprimé
  pendant que son picker est ouvert laisserait un panneau orphelin pointant
  vers des `EffectParam` d'un calque qui n'existe plus.
- Le canvas SV du picker doit être redessiné à chaque changement de teinte
  (la grille saturation/luminosité dépend de la teinte courante) — coût
  potentiellement non-trivial si le pointer-drag redessine à chaque
  `pointermove` ; à vérifier en implémentation (throttle si nécessaire).
