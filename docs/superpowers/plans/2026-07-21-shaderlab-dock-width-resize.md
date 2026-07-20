# Dock Width Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la colonne dockée (`PanelColumn`) redimensionnable en largeur via une poignée sur son bord gauche, bornée à [240px, 400px].

**Architecture:** État `dockWidth` centralisé dans `App.tsx`, poussé comme UNE SEULE variable CSS (`--dock-width`) sur `<main className="workspace">` — consommée à la fois par `.panel-column` (largeur) et `.canvas-stage` (compensation de centrage), pour ne jamais laisser diverger deux valeurs qui doivent rester égales (même classe de bug que le `*2` du centrage corrigé le 2026-07-20). Poignée verticale sur le bord gauche de `PanelColumn`, pointer events (pas de DnD HTML5, convention déjà établie dans ce projet).

**Tech Stack:** React 19 + TS, Vitest, tokens CSS existants (`--inspector-width-min/max`).

## Global Constraints

- Bornes : 240px (`--inspector-width-min`) / 400px (`--inspector-width-max`), déjà définies dans `src/design/components.css:14,16` — ne pas les redéfinir, les référencer.
- Pas de persistance (état session, comme `panelOrder`/`layersCollapsed` déjà en place) — pas d'entrée d'historique undo/redo (disposition d'interface, pas donnée de calque).
- Pointer events uniquement (`setPointerCapture`), jamais le DnD HTML5 natif — confirmé peu fiable dans ce WebView2 (voir commentaire `LayerPanel.tsx:141-149`).
- Aucun test de rendu React dans ce repo — seule la fonction de clamp se teste unitairement.
- `git commit -m "message" -- <fichiers>` pathspec explicite obligatoire.
- Checkpoint visuel humain CDP obligatoire en fin de plan (Playwright headless inadapté sur ce projet, canvas WebGPU réel).
- **A11y clavier non couverte pour cette poignée précise** : contrairement au splitter vertical Calques/Réglages (géré par `react-resizable-panels`, qui gère nativement ArrowUp/Down/Left/Right/Home/End — vérifié sur pièce lors du chantier docked-panels), cette nouvelle poignée de largeur est un `<div role="separator">` custom SANS gestion clavier (`onKeyDown` absent). Assumé explicitement comme lacune ponctuelle (même famille que la lacune déjà acceptée pour le drag-to-reorder) plutôt que traité en douce — à corriger dans un futur chantier a11y dédié si besoin, pas ici.

---

## File Structure

**Créés :**
- `src/components/dockedPanel/dockWidth.ts` — constantes de bornes + fonction pure de clamp.
- `test/components/dockedPanel/dockWidth.test.ts` — tests de la fonction pure.

**Modifiés :**
- `src/App.tsx` — nouvel état `dockWidth`, variable CSS `--dock-width` posée sur `.workspace`, props `width`/`onWidthChange` passées à `PanelColumn`.
- `src/components/dockedPanel/PanelColumn.tsx` — poignée de redimensionnement (bord gauche), logique pointer, props `width`/`onWidthChange`.
- `src/components/dockedPanel/PanelColumn.css` — style de la poignée verticale, `.panel-column` consomme `var(--dock-width, ...)`.
- `src/components/Canvas.css:25` — `padding-right` consomme `var(--dock-width, ...)` ; corrige au passage un commentaire obsolète référençant `computeEffectiveViewportWidth` (fichier supprimé depuis le chantier docked-panels).

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
 * Bornes de largeur de la colonne dockée — mêmes valeurs que les tokens
 * `--inspector-width-min`/`--inspector-width-max` (src/design/components.css),
 * dupliquées ici en constantes JS pour le clamp du drag (même pattern que
 * les constantes déjà utilisées ailleurs dans le projet, ex.
 * CANVAS_MIN_WIDTH miroir de --canvas-min-width).
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

Dans `src/components/dockedPanel/PanelColumn.tsx`, ajouter l'import et étendre l'interface :

```tsx
import { useCallback, useRef } from "react";
import { clampDockWidth } from "./dockWidth";
```

Remplacer :

```tsx
export interface PanelColumnProps { panels: DockedPanelSpec[]; onReorder: (id: string, newIndex: number) => void; }
```

par :

```tsx
export interface PanelColumnProps {
  panels: DockedPanelSpec[];
  onReorder: (id: string, newIndex: number) => void;
  width: number;
  onWidthChange: (width: number) => void;
}
```

Dans le corps de `PanelColumn`, ajouter après la déclaration du hook `usePointerReorder` :

```tsx
export function PanelColumn({ panels, onReorder, width, onWidthChange }: PanelColumnProps) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(panels, (panel) => panel.id, "data-reorder-index", onReorder);

  // Redimensionnement en largeur — poignée sur le bord GAUCHE de la colonne.
  // La colonne est ancrée à droite (right: var(--space-6)), donc glisser
  // vers la GAUCHE agrandit la largeur, glisser vers la DROITE la réduit —
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

Dans le JSX retourné, ajouter la poignée juste après l'ouverture de la `<div className="panel-column" ...>` (avant `<Group ...>`) :

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

- [ ] **Step 2: Styles de la poignée verticale**

Dans `src/components/dockedPanel/PanelColumn.css`, ajouter :

```css
/* Poignée de redimensionnement en LARGEUR — bord gauche de la colonne,
   symétrique au splitter vertical (.panel-column__handle) entre Calques/
   Réglages : même style au repos (invisible), même feedback au survol. */
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

Remplacer la règle `.panel-column` existante (largeur fixe) :

```css
.panel-column {
  position: absolute;
  top: var(--space-6);
  right: var(--space-6);
  bottom: var(--space-6);
  width: var(--inspector-width-default);
  min-width: var(--inspector-width-min);
  max-width: var(--inspector-width-max);
  z-index: var(--z-floating-panel);
}
```

par :

```css
.panel-column {
  position: absolute;
  top: var(--space-6);
  right: var(--space-6);
  bottom: var(--space-6);
  width: var(--dock-width, var(--inspector-width-default));
  min-width: var(--inspector-width-min);
  max-width: var(--inspector-width-max);
  z-index: var(--z-floating-panel);
}
```

(`.panel-column` doit garder `position: relative` implicite via son parent pour que `.panel-column__width-handle` en `position: absolute` se positionne par rapport à elle — vérifier au Step 4 que ce n'est pas déjà cassé par une autre règle : `.panel-column` a déjà `position: absolute`, donc c'est lui-même l'ancêtre positionné, pas un souci ici puisque la poignée y est un enfant direct.)

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: des erreurs sont attendues sur `App.tsx` (qui ne fournit pas encore `width`/`onWidthChange`) — corrigées en Task 3, normal à ce stade.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add width-resize handle to PanelColumn" -- src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css
```

---

### Task 3 : Câbler `App.tsx` et la compensation canvas

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Canvas.css:1-26`

**Interfaces:**
- Consumes: `clampDockWidth`, `DOCK_WIDTH_MAX` (utilisé comme défaut initial) de `dockWidth.ts` (Task 1) ; `PanelColumnProps.width`/`onWidthChange` (Task 2).
- Produces: nouvel état `dockWidth` dans `App.tsx`, variable CSS `--dock-width` posée sur `.workspace`.

- [ ] **Step 1: Ajouter l'état et l'import**

Dans `src/App.tsx`, ajouter à la suite des imports existants :

```tsx
import { clampDockWidth } from "./components/dockedPanel/dockWidth";
```

Remplacer :

```tsx
  const [panelOrder, setPanelOrder] = useState<string[]>(["layers", "params"]);
  const handlePanelReorder = useCallback((id: string, newIndex: number) => {
    setPanelOrder((prev) => reorderById(prev, (panelId) => panelId, id, newIndex));
  }, []);
```

par :

```tsx
  const [panelOrder, setPanelOrder] = useState<string[]>(["layers", "params"]);
  const handlePanelReorder = useCallback((id: string, newIndex: number) => {
    setPanelOrder((prev) => reorderById(prev, (panelId) => panelId, id, newIndex));
  }, []);
  // Largeur du dock — état session, pas d'entrée d'historique (disposition
  // d'interface, pas donnée de calque, même principe que panelOrder ci-dessus).
  const [dockWidth, setDockWidth] = useState(320);
  const handleDockWidthChange = useCallback((width: number) => setDockWidth(clampDockWidth(width)), []);
```

- [ ] **Step 2: Poser `--dock-width` sur `.workspace` et câbler `PanelColumn`**

Remplacer :

```tsx
      <main className="workspace" ref={workspaceRef}>
```

par :

```tsx
      <main className="workspace" ref={workspaceRef} style={{ "--dock-width": `${dockWidth}px` } as React.CSSProperties}>
```

Remplacer la fermeture de `<PanelColumn ... onReorder={handlePanelReorder} />` :

```tsx
        })} onReorder={handlePanelReorder} />
```

par :

```tsx
        })} onReorder={handlePanelReorder} width={dockWidth} onWidthChange={handleDockWidthChange} />
```

- [ ] **Step 3: Compensation canvas — consommer la même variable partagée**

Dans `src/components/Canvas.css`, remplacer le commentaire et la règle (lignes 12-25) :

```css
  /* Compensation statique du centrage (design.md §8) : décale le point de
     centrage vers la gauche de la largeur par défaut du dock virtuel, pour
     que la photo ne semble pas centrée SOUS les panneaux Calques/Réglages
     à leur position de départ. Calculée une fois, pas réactive à un
     déplacement ultérieur des panneaux par l'utilisateur — voir
     computeEffectiveViewportWidth (src/components/floatingPanel/effectiveViewport.ts)
     et son commentaire pour la valeur exacte et le futur usage pan/zoom.
     En centrage flexbox, `padding-right: P` déplace le centre visuel de
     P/2 (le contenu se centre dans l'espace restant W-P, dont le centre
     est à (W-P)/2, soit un décalage de P/2 par rapport au centre naturel
     W/2) — donc P doit être ÉGAL à la largeur du dock à compenser, pas le
     double (bug corrigé 2026-07-20 : le canvas était décalé deux fois plus
     loin que prévu avec `* 2`). */
  padding-right: var(--inspector-width-default);
```

par :

```css
  /* Compensation du centrage (design.md §8) : décale le point de centrage
     vers la gauche de la largeur RÉELLE du dock (--dock-width, posée par
     App.tsx sur .workspace, cf. src/components/dockedPanel/PanelColumn.css
     pour l'autre consommateur de cette même variable) — réactive au
     redimensionnement du dock depuis 2026-07-21 (Task 3 du plan
     dock-width-resize), plus une valeur figée à l'ouverture.
     En centrage flexbox, `padding-right: P` déplace le centre visuel de
     P/2 (le contenu se centre dans l'espace restant W-P, dont le centre
     est à (W-P)/2, soit un décalage de P/2 par rapport au centre naturel
     W/2) — donc P doit être ÉGAL à la largeur du dock à compenser, pas le
     double (bug corrigé 2026-07-20 : le canvas était décalé deux fois plus
     loin que prévu avec `* 2`). `--dock-width`/`--inspector-width-default`
     DOIVENT rester la seule et même source pour PanelColumn et ce padding —
     ne jamais réintroduire deux valeurs séparées qui pourraient diverger. */
  padding-right: var(--dock-width, var(--inspector-width-default));
```

(Le commentaire référençant `computeEffectiveViewportWidth`/`src/components/floatingPanel/effectiveViewport.ts` — fichier supprimé depuis le chantier docked-panels du 2026-07-20 — est retiré au passage, c'était un résidu obsolète repéré lors de la revue de ce même chantier.)

- [ ] **Step 4: Vérifier compilation, tests, build**

Run: `npx tsc --noEmit && npm run test && npm run build`
Expected: 0 erreur, tous les tests verts (208/208 attendu : 203 existants + 5 nouveaux de Task 1), build Vite réussi.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: wire dockWidth state and shared --dock-width CSS var (App.tsx + Canvas compensation)" -- src/App.tsx src/components/Canvas.css
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

1. Une poignée verticale (curseur `col-resize`) est présente sur le bord gauche de la colonne (Calques/Réglages).
2. Glisser cette poignée vers la gauche agrandit la colonne, vers la droite la rétrécit.
3. La largeur ne peut pas descendre sous ~240px ni dépasser ~400px, même en glissant plus loin.
4. Pendant le redimensionnement, le canvas reste centré correctement (pas de décalage double ni de saut) — la compensation suit la largeur en temps réel, pas seulement à l'ouverture.
5. Le splitter vertical (Calques/Réglages) et le drag-to-reorder des cartes continuent de fonctionner normalement après un redimensionnement en largeur.
6. Focus clavier (Tab) sur la nouvelle poignée affiche un anneau de focus visible.

- [ ] **Step 3: Si un point échoue, corriger et relancer ce Step 2 avant de continuer**

- [ ] **Step 4: Commit final si des corrections ont eu lieu**

```bash
git commit -m "fix: address dock width resize checkpoint findings" -- <fichiers corrigés>
```

(Si aucune correction n'est nécessaire, ne rien committer à ce step — le checkpoint confirmé n'est pas un changement de code.)

---

## Self-Review (effectuée par l'auteur du plan)

**Couverture** : poignée + clamp (Task 1-2), état centralisé + variable CSS partagée pour éviter la divergence dock/canvas (Task 3), checkpoint (Task 4). Le point le plus risqué du chantier (deux valeurs qui doivent rester égales) est traité par construction (une seule variable CSS, deux consommateurs) plutôt que par une règle à ne pas oublier.

**Aucun placeholder détecté** — chaque step contient du code complet ou une commande exacte avec sortie attendue.

**Cohérence de types** : `PanelColumnProps.width`/`onWidthChange` (Task 2) consommés à l'identique en Task 3 (`width={dockWidth}`, `onWidthChange={handleDockWidthChange}`) ; `clampDockWidth` (Task 1) utilisé à la fois dans `PanelColumn.tsx` (Task 2, pendant le drag) et `App.tsx` (Task 3, garde supplémentaire côté état) — double clamp inoffensif (idempotent), pas une incohérence.

**Nettoyage opportuniste** : le commentaire obsolète de `Canvas.css:17` (référence à `computeEffectiveViewportWidth`/`floatingPanel/` supprimé) est corrigé dans ce plan puisque ce fichier est de toute façon touché par la Task 3 — pas un nouveau scope creep, un nettoyage local au fichier déjà modifié.
