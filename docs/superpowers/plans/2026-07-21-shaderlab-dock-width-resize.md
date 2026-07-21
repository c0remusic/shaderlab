# Dock Width Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RÉÉCRIT le 2026-07-21** : la version précédente ciblait l'ancienne API `panelOrder`/`onReorder` de `PanelColumn` (une seule colonne). Le dock est depuis passé à une grille 2D (`DockLayout = string[][]`, plan `2026-07-21-shaderlab-dock-grid.md`, Tasks 1-3 committées) : `layout`/`onMove` remplacent `panelOrder`/`onReorder`, plusieurs colonnes peuvent coexister côte à côte, chaque colonne (`.panel-column__stack`) a aujourd'hui une largeur fixe `flex: 0 0 var(--inspector-width-default)`. Décision Antoine 2026-07-21 (AskUserQuestion) : le redimensionnement porte sur la **largeur globale du dock** — une seule poignée sur le bord gauche de toute la zone dockée (`.panel-column`), une seule variable de largeur partagée par TOUTES les colonnes (elles se redimensionnent ensemble, pas indépendamment). Le redimensionnement par colonne est explicitement écarté (YAGNI, pas demandé).

**Goal:** Rendre la zone dockée (`PanelColumn`, toutes colonnes confondues) redimensionnable en largeur via une poignée sur son bord gauche, bornée à [240px, 400px].

**Architecture:** État `dockWidth` centralisé dans `App.tsx`, poussé comme UNE SEULE variable CSS sur `<main className="workspace">`. Cette variable réutilise le nom déjà en place dans `Canvas.css:25` (`--dock-reserved-width`, actuellement figé sur son fallback `var(--inspector-width-default)` faute d'émetteur) plutôt que d'en introduire une seconde — même principe que le plan précédent (une variable, deux consommateurs, jamais de divergence possible) : `--dock-reserved-width` est consommée à la fois par `.panel-column__stack` (largeur de CHAQUE colonne, elles partagent toutes la même) et `.canvas-stage` (compensation de centrage, déjà câblée). Poignée verticale sur le bord gauche de `.panel-column` (le conteneur de grille entier, pas une colonne individuelle), pointer events (pas de DnD HTML5, convention déjà établie dans ce projet).

**Limite assumée (pas un bug)** : avec plusieurs colonnes ouvertes côte à côte, la compensation canvas (`--dock-reserved-width`) ne reflète que la largeur d'UNE colonne, pas la largeur totale de la grille (N colonnes + gaps) — c'est déjà l'approximation statique préexistante (compensation figée, non réactive à un état multi-colonnes), pas une régression introduite par ce plan. Documenté, pas corrigé ici (hors scope, YAGNI tant que le cas multi-colonnes réel n'est pas fréquent en usage).

**Tech Stack:** React 19 + TS, Vitest, tokens CSS existants (`--inspector-width-min/max`).

## Global Constraints

- Bornes : 240px (`--inspector-width-min`) / 400px (`--inspector-width-max`), déjà définies dans `src/design/components.css:14,16` — ne pas les redéfinir, les référencer.
- Pas de persistance (état session, comme `dockLayout`/`layersCollapsed` déjà en place) — pas d'entrée d'historique undo/redo (disposition d'interface, pas donnée de calque).
- Pointer events uniquement (`setPointerCapture`), jamais le DnD HTML5 natif — confirmé peu fiable dans ce WebView2 (voir commentaire `LayerPanel.tsx:141-149`).
- Aucun test de rendu React dans ce repo — seule la fonction de clamp se teste unitairement.
- `git commit -m "message" -- <fichiers>` pathspec explicite obligatoire.
- Checkpoint visuel humain CDP obligatoire en fin de plan (Playwright headless inadapté sur ce projet, canvas WebGPU réel).
- **A11y clavier non couverte pour cette poignée précise** : `<div role="separator">` custom SANS gestion clavier (`onKeyDown` absent) — même lacune assumée que le drag-to-reorder des cartes. À corriger dans un futur chantier a11y dédié si besoin, pas ici.
- Le drag-to-reorder des cartes (`usePointerReorder`/`movePanelInDock`) et le redimensionnement en largeur sont deux gestes indépendants sur des zones distinctes de `PanelColumn` (poignée dédiée vs titlebar de carte) — ne pas les faire interférer.

---

## File Structure

**Créés :**
- `src/components/dockedPanel/dockWidth.ts` — constantes de bornes + fonction pure de clamp.
- `test/components/dockedPanel/dockWidth.test.ts` — tests de la fonction pure.

**Modifiés :**
- `src/App.tsx` — nouvel état `dockWidth`, variable CSS `--dock-reserved-width` posée sur `.workspace`, props `width`/`onWidthChange` passées à `PanelColumn`.
- `src/components/dockedPanel/PanelColumn.tsx` — poignée de redimensionnement (bord gauche du conteneur `.panel-column`), logique pointer, props `width`/`onWidthChange`.
- `src/components/dockedPanel/PanelColumn.css` — style de la poignée verticale ; `.panel-column__stack` et `.panel-column__ghost` consomment `var(--dock-reserved-width, ...)` au lieu de `var(--inspector-width-default)` en dur.
- `src/components/Canvas.css:25` — déjà câblé sur `--dock-reserved-width` (aucun changement requis, juste vérifier que la valeur reçue est bien réactive une fois `App.tsx` l'émet).

---

### Task 1 : Fonction pure de clamp de largeur

**Files:**
- Create: `src/components/dockedPanel/dockWidth.ts`
- Test: `test/components/dockedPanel/dockWidth.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `export const DOCK_WIDTH_MIN = 240`, `export const DOCK_WIDTH_MAX = 400`, `export function clampDockWidth(width: number): number` — consommés par Task 2 (`PanelColumn`) et Task 3 (`App.tsx`).

- [ ] **Step 1: Écrire les tests**

```ts
import { describe, it, expect } from "vitest";
import { clampDockWidth, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX } from "../../../src/components/dockedPanel/dockWidth";

describe("clampDockWidth", () => {
  it("valeur dans les bornes -> inchangée", () => {
    expect(clampDockWidth(320)).toBe(320);
  });
  it("valeur sous le minimum -> clampée au minimum", () => {
    expect(clampDockWidth(100)).toBe(DOCK_WIDTH_MIN);
  });
  it("valeur au-dessus du maximum -> clampée au maximum", () => {
    expect(clampDockWidth(999)).toBe(DOCK_WIDTH_MAX);
  });
  it("valeur exactement au minimum -> inchangée", () => {
    expect(clampDockWidth(DOCK_WIDTH_MIN)).toBe(DOCK_WIDTH_MIN);
  });
  it("valeur exactement au maximum -> inchangée", () => {
    expect(clampDockWidth(DOCK_WIDTH_MAX)).toBe(DOCK_WIDTH_MAX);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- dockWidth`
Expected: FAIL — `Cannot find module '../../../src/components/dockedPanel/dockWidth'`

- [ ] **Step 3: Écrire l'implémentation**

```ts
/**
 * Bornes de largeur du dock — mêmes valeurs que les tokens
 * `--inspector-width-min`/`--inspector-width-max` (src/design/components.css),
 * dupliquées ici en constantes JS pour le clamp du drag (même pattern que
 * les constantes déjà utilisées ailleurs dans le projet).
 */
export const DOCK_WIDTH_MIN = 240;
export const DOCK_WIDTH_MAX = 400;

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, width));
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `npm run test -- dockWidth`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add clampDockWidth pure function for dock width resize" -- src/components/dockedPanel/dockWidth.ts test/components/dockedPanel/dockWidth.test.ts
```

---

### Task 2 : Poignée de redimensionnement dans `PanelColumn`

**Files:**
- Modify: `src/components/dockedPanel/PanelColumn.tsx`
- Modify: `src/components/dockedPanel/PanelColumn.css`

**Interfaces:**
- Consumes: `clampDockWidth` (Task 1).
- Produces: `PanelColumnProps` étendue avec `width: number` et `onWidthChange: (width: number) => void` — consommé par Task 3 (`App.tsx`).

- [ ] **Step 1: Étendre `PanelColumnProps` et ajouter la poignée**

Dans `src/components/dockedPanel/PanelColumn.tsx`, ajouter l'import :

```tsx
import { useCallback, useRef, useState } from "react";
import { clampDockWidth } from "./dockWidth";
```

(`useState` est déjà importé pour `dragState` — fusionner avec l'import existant plutôt que le dupliquer.)

Remplacer :

```tsx
export interface PanelColumnProps {
  panels: DockedPanelSpec[];
  layout: DockLayout;
  onMove: (id: string, target: DockDropTarget) => void;
}
```

par :

```tsx
export interface PanelColumnProps {
  panels: DockedPanelSpec[];
  layout: DockLayout;
  onMove: (id: string, target: DockDropTarget) => void;
  width: number;
  onWidthChange: (width: number) => void;
}
```

Remplacer la signature de la fonction :

```tsx
export function PanelColumn({ panels, layout, onMove }: PanelColumnProps) {
```

par :

```tsx
export function PanelColumn({ panels, layout, onMove, width, onWidthChange }: PanelColumnProps) {
```

Ajouter, juste après la déclaration de `dragState`/`draggedPanel` (avant `handlePointerDown`) :

```tsx
  // Redimensionnement en largeur — poignée sur le bord GAUCHE de TOUT le
  // conteneur .panel-column (toutes colonnes confondues, décision Antoine
  // 2026-07-21 : largeur globale partagée, pas de redimensionnement par
  // colonne indépendant). La colonne est ancrée à droite (right: var(--space-6)),
  // donc glisser vers la GAUCHE agrandit la largeur, vers la DROITE la réduit —
  // pas de magnétisme, juste un clamp aux bornes. État de drag en ref (pas
  // besoin de re-render pendant le geste : la largeur elle-même vit dans
  // App.tsx via onWidthChange, appelé à chaque pointermove).
  const widthDragRef = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);

  const handleWidthPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      widthDragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: width };
    },
    [width]
  );

  const handleWidthPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = widthDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const delta = e.clientX - drag.startClientX;
      onWidthChange(clampDockWidth(drag.startWidth - delta));
    },
    [onWidthChange]
  );

  const handleWidthPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = widthDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    widthDragRef.current = null;
  }, []);

  const handleWidthPointerCancel = handleWidthPointerUp;
```

Dans le JSX retourné, ajouter la poignée comme premier enfant de la `<div className="panel-column" ...>` (avant `<div className="panel-column__grid">`) :

```tsx
      <div
        className="panel-column__width-handle"
        onPointerDown={handleWidthPointerDown}
        onPointerMove={handleWidthPointerMove}
        onPointerUp={handleWidthPointerUp}
        onPointerCancel={handleWidthPointerCancel}
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner la largeur du dock"
        tabIndex={0}
      />
```

**Attention aux handlers pointer déjà posés sur `.panel-column`** (`onPointerMove`/`onPointerUp`/`onPointerCancel` du drag-to-reorder, conditionnés à `dragState`) : la poignée de largeur a ses PROPRES handlers sur son propre élément, ils ne se substituent pas à ceux du parent. Les deux gestes restent bien distincts (le pointer capture de la poignée empêche le parent de recevoir les mêmes événements pendant un resize).

- [ ] **Step 2: Styles de la poignée verticale + largeur partagée**

Dans `src/components/dockedPanel/PanelColumn.css`, ajouter :

```css
/* Poignée de redimensionnement en LARGEUR — bord gauche du conteneur
   .panel-column entier (toutes colonnes), symétrique dans son style au
   feedback hover déjà utilisé pour les séparateurs de ce projet. */
.panel-column__width-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--space-2) * -1);
  width: var(--space-4);
  cursor: col-resize;
}

.panel-column__width-handle::after {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 50%;
  width: 1px;
  background: var(--border-subtle);
  transform: translateX(-50%);
}

.panel-column__width-handle:hover::after {
  background: var(--border-selection);
}

.panel-column__width-handle:focus-visible {
  outline: var(--focus-width) solid var(--focus-color);
  outline-offset: var(--focus-offset);
}
```

Remplacer `.panel-column` pour lui donner un contexte de positionnement pour la poignée (elle est déjà `position: absolute`, donc déjà l'ancêtre positionné — aucun changement requis ici, juste vérifier au Step 3 que ça tient).

Remplacer les deux usages en dur de `var(--inspector-width-default)` :

```css
.panel-column__stack {
  display: flex;
  flex: 0 0 var(--inspector-width-default);
  flex-direction: column;
  gap: var(--space-4);
  max-height: inherit;
  overflow-y: auto;
}
```

par :

```css
.panel-column__stack {
  display: flex;
  flex: 0 0 var(--dock-reserved-width, var(--inspector-width-default));
  flex-direction: column;
  gap: var(--space-4);
  max-height: inherit;
  overflow-y: auto;
}
```

et :

```css
.panel-column__ghost {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--inspector-width-default);
  opacity: .85;
  pointer-events: none;
  box-shadow: var(--shadow-dragging);
  z-index: var(--z-popover);
}
```

par :

```css
.panel-column__ghost {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--dock-reserved-width, var(--inspector-width-default));
  opacity: .85;
  pointer-events: none;
  box-shadow: var(--shadow-dragging);
  z-index: var(--z-popover);
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: des erreurs sont attendues sur `App.tsx` (qui ne fournit pas encore `width`/`onWidthChange`) — corrigées en Task 3, normal à ce stade.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add width-resize handle to PanelColumn, shared across all dock columns" -- src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css
```

---

### Task 3 : Câbler `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `clampDockWidth`, `DOCK_WIDTH_MAX`/défaut initial (Task 1) ; `PanelColumnProps.width`/`onWidthChange` (Task 2).
- Produces: nouvel état `dockWidth` dans `App.tsx`, variable CSS `--dock-reserved-width` posée sur `.workspace` (déjà consommée en lecture par `Canvas.css:25` et, depuis Task 2, par `PanelColumn.css`).

- [ ] **Step 1: Ajouter l'état et l'import**

Dans `src/App.tsx`, ajouter à la suite des imports existants :

```tsx
import { clampDockWidth } from "./components/dockedPanel/dockWidth";
```

Localiser l'état existant lié à la disposition du dock (`dockLayout`/`handlePanelMove`) et ajouter juste après :

```tsx
  // Largeur du dock — état session, partagée par toutes les colonnes,
  // pas d'entrée d'historique (disposition d'interface, pas donnée de
  // calque, même principe que dockLayout ci-dessus).
  const [dockWidth, setDockWidth] = useState(320);
  const handleDockWidthChange = useCallback((width: number) => setDockWidth(clampDockWidth(width)), []);
```

- [ ] **Step 2: Poser `--dock-reserved-width` sur `.workspace` et câbler `PanelColumn`**

Remplacer :

```tsx
      <main className="workspace" ref={workspaceRef}>
```

par :

```tsx
      <main className="workspace" ref={workspaceRef} style={{ "--dock-reserved-width": `${dockWidth}px` } as React.CSSProperties}>
```

Remplacer la fermeture de `<PanelColumn ... layout={dockLayout} onMove={handlePanelMove} />` :

```tsx
        }]} layout={dockLayout} onMove={handlePanelMove} />
```

par :

```tsx
        }]} layout={dockLayout} onMove={handlePanelMove} width={dockWidth} onWidthChange={handleDockWidthChange} />
```

- [ ] **Step 3: Vérifier compilation, tests, build**

Run: `npx tsc --noEmit && npm run test && npm run build`
Expected: 0 erreur, tous les tests verts (nombre exact = tests existants + 5 nouveaux de Task 1 — vérifier le total affiché avant Task 1 pour comparer, ne pas deviner un chiffre figé).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: wire dockWidth state and shared --dock-reserved-width CSS var in App.tsx" -- src/App.tsx
```

---

### Task 4 : Checkpoint visuel humain

**Files:**
- Aucun — vérification uniquement.

**Interfaces:**
- Consumes: build complet des Tasks 1-3.
- Produces: confirmation visuelle humaine.

- [ ] **Step 1: Lancer l'app en mode debug**

Run: `npm run dev:debug` puis `npm run dev:monitor`.

- [ ] **Step 2: Points à confirmer avec Antoine**

1. Une poignée verticale (curseur `col-resize`) est présente sur le bord gauche de la zone dockée.
2. Glisser cette poignée vers la gauche agrandit toutes les colonnes ouvertes, vers la droite les rétrécit — ensemble, pas indépendamment.
3. La largeur ne peut pas descendre sous ~240px ni dépasser ~400px, même en glissant plus loin.
4. Pendant le redimensionnement, le canvas reste centré correctement (pas de décalage double ni de saut) — la compensation suit la largeur en temps réel, pas seulement à l'ouverture. Si plusieurs colonnes sont ouvertes côte à côte, la compensation restera approximative (limite assumée, documentée en tête de plan) — vérifier seulement qu'elle n'est pas pire qu'avant.
5. Le drag-to-reorder des cartes (dans une colonne et entre colonnes) continue de fonctionner normalement après un redimensionnement en largeur.
6. Focus clavier (Tab) sur la nouvelle poignée affiche un anneau de focus visible.

- [ ] **Step 3: Si un point échoue, corriger et relancer ce Step 2 avant de continuer**

- [ ] **Step 4: Commit final si des corrections ont eu lieu**

```bash
git commit -m "fix: address dock width resize checkpoint findings" -- <fichiers corrigés>
```

(Si aucune correction n'est nécessaire, ne rien committer à ce step — le checkpoint confirmé n'est pas un changement de code.)

---

## Self-Review (effectuée par l'auteur de la réécriture)

**Couverture** : poignée + clamp (Task 1-2), état centralisé + variable CSS partagée réutilisant le nom déjà présent dans `Canvas.css` plutôt que d'en introduire un doublon (Task 3), checkpoint (Task 4). Le redimensionnement par colonne indépendante est explicitement écarté (question posée à Antoine, réponse : largeur globale).

**Écart avec le plan précédent (périmé)** : `PanelColumnProps` utilise `layout: DockLayout`/`onMove` (grille 2D) et non `panels`/`onReorder` (liste plate) — toutes les références à l'ancienne API ont été retirées. La poignée est posée sur `.panel-column` (conteneur global) et non sur une `.panel-column` par ancienne "colonne unique" — il n'y a plus qu'un seul conteneur, les colonnes sont désormais `.panel-column__stack` à l'intérieur.

**Aucun placeholder détecté** — chaque step contient du code complet ou une commande exacte avec sortie attendue.

**Cohérence de types** : `PanelColumnProps.width`/`onWidthChange` (Task 2) consommés à l'identique en Task 3 (`width={dockWidth}`, `onWidthChange={handleDockWidthChange}`).

**Nettoyage évité (scope creep)** : la limite de compensation canvas en cas multi-colonnes n'est pas corrigée ici — documentée comme limite assumée pré-existante, pas régression de ce plan.
