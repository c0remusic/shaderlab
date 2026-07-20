# Panneaux flottants (Calques/Réglages) — FloatingPanel générique — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer Calques et Réglages, aujourd'hui dockés dans `Inspector.tsx` (aside fixe), en instances d'un composant `FloatingPanel` générique déplaçable/magnétique/repliable, le canvas passant plein écran. `FloatingPanel` doit être directement réutilisable par la Tranche 4 du masquage (panneau Masques, déjà designé).

**Architecture:** `FloatingPanel` (nouveau) est un composant de présentation pur — position et repli remontés à l'appelant (`App.tsx`), même philosophie que `LayerPanel`/`ParamPanel` existants. Le drag utilise des pointer events (`setPointerCapture`), jamais le DnD HTML5 natif (WebView2 ne relaie pas `dragover`/`drop` — cause déjà établie pour `LayerPanel`). Le calcul de magnétisme (multi-panneaux + bords canvas) est une fonction pure testable sans DOM, appliquée UNE fois au relâchement du drag/nudge clavier. `.workspace` passe d'un flex-row Canvas+aside à un canvas plein écran avec panneaux en `position: absolute` par-dessus.

**Tech Stack:** TypeScript, React 19, Vitest (Node env, aucun test ne rend un composant React ni de WebGPU réel), tokens `src/design/{primitives,semantic,components}.css`.

## Global Constraints

- **Aucune interaction visuelle de ce plan (drag, fantôme, magnétisme, repli instantané, plein écran du canvas) n'est unitairement testable** — moyen de preuve = checkpoint visuel humain via CDP sur la vraie fenêtre WebView2 (`npm run dev:debug` + `npm run dev:monitor`), **jamais Playwright headless** (canvas WebGPU rend noir en headless). Ne jamais cocher une étape de checkpoint visuel sans confirmation explicite d'Antoine.
- **Ce qui DOIT rester unitairement testable** (logique pure, sans DOM/GPU, même famille que `computeInsertIndex` dans `LayerPanel.tsx`) : la fonction de magnétisme, la fonction de nudge clavier bornée aux limites du canvas, la fonction de calcul du viewport effectif (fenêtre − largeur de dock).
- **Pas de DnD HTML5 natif** (`draggable`/`onDragStart`/`onDragOver`/`onDrop`) — pointer events uniquement (`pointerdown` + `setPointerCapture` sur la poignée de titre, `pointermove`/`pointerup` filtrés par `pointerId`), même infrastructure que `LayerPanel.tsx`.
- **Position et repli remontés à l'appelant** (`App.tsx`) — `FloatingPanel` ne possède aucun state de position interne, seulement le state éphémère du drag en cours (fantôme).
- **Repli/dépli instantané, sans transition** — le contenu est démonté/remonté (`collapsed && null`), jamais une hauteur animée. Toute autre interaction (apparition, résolution du drag) garde une transition (tokens `--duration-*`/`--ease-*` existants).
- **Magnétisme au relâchement du drag/nudge uniquement, jamais pendant** — pas de recalcul dynamique si un panneau ancre bouge ensuite (pas de "suivi" automatique).
- **Écart panneau↔panneau = `PANEL_GAP` (8px), jamais 0**. Chaque panneau garde son propre cadre/ombre, jamais fusionné visuellement avec un voisin. Magnétisme panneau↔bord canvas retiré après retour Antoine (2026-07-20) — voir Task 9 Step 8 §4 pour le détail.
- **Alternative clavier obligatoire au drag** (convention d'accessibilité du projet, `docs/design-system/patterns.md`) : poignée de titre focusable (`tabIndex=0`), flèches directionnelles = nudge par `KEYBOARD_NUDGE_STEP` (16px), `Shift`+flèche = pas large. Le magnétisme s'applique aussi au nudge clavier.
- **Aucune valeur codée en dur qui contourne un token existant** — réutiliser `--space-*`, `--radius-panel`, `--z-*`, `--duration-*`/`--ease-*`, `--surface-*`/`--border-*`/`--text-*` de `src/design/*.css`. Nouveaux tokens ajoutés par ce plan (ombre de panneau, z-index panneau flottant) vont DANS `src/design/components.css`/`primitives.css`, jamais isolés dans un composant.
- **Rétro-compatibilité fonctionnelle stricte** : aucune régression sur le comportement métier existant de `LayerPanel`/`ParamPanel` (sélection, toggle, reorder, opacité, blend mode, ajout d'effet, mode peinture masque) — seul le CONTENEUR change.
- **Hors scope de ce plan** (voir design.md § Différé) : contenu du panneau Masques (Tranche 4 — seule l'infra `FloatingPanel` est construite ici), redimensionnement des panneaux, persistance de position entre sessions.

---

### Task 1: Modèle — fonction pure de magnétisme (multi-panneaux + bords canvas)

**Files:**
- Create: `src/components/floatingPanel/snapping.ts`
- Test: `test/components/floatingPanel/snapping.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Rect { x: number; y: number; width: number; height: number; }
  export interface SnapCandidate { rect: Rect; id: string; }
  export const PANEL_GAP = 8;
  export const SNAP_DISTANCE = 12;
  export function computeSnappedPosition(
    dragged: Rect,
    others: SnapCandidate[],
    canvasSize: { width: number; height: number }
  ): { x: number; y: number };
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/components/floatingPanel/snapping.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { computeSnappedPosition, PANEL_GAP, SNAP_DISTANCE } from "../../../src/components/floatingPanel/snapping";
import type { Rect, SnapCandidate } from "../../../src/components/floatingPanel/snapping";

const CANVAS = { width: 1000, height: 800 };

function rect(x: number, y: number, width = 200, height = 150): Rect {
  return { x, y, width, height };
}

describe("computeSnappedPosition", () => {
  it("aucun candidat sous le seuil -> position brute inchangée", () => {
    const dragged = rect(500, 400);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result).toEqual({ x: 500, y: 400 });
  });

  it("accroche horizontalement à un panneau voisin avec un écart PANEL_GAP (jamais 0)", () => {
    // Panneau voisin à x=100..300 (width 200). Le panneau glissé (width 200)
    // est relâché juste à droite, à SNAP_DISTANCE-1 du bord droit du voisin.
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) };
    const dragged = rect(300 + SNAP_DISTANCE - 1, 100);
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    // Bord gauche du glissé doit finir à bord-droit-voisin + PANEL_GAP.
    expect(result.x).toBe(100 + 200 + PANEL_GAP);
    expect(result.y).toBe(100); // vertical déjà aligné, inchangé
  });

  it("accroche verticalement à un panneau voisin avec un écart PANEL_GAP", () => {
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) };
    const dragged = rect(100, 250 + SNAP_DISTANCE - 1);
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    expect(result.y).toBe(100 + 150 + PANEL_GAP);
    expect(result.x).toBe(100);
  });

  it("accroche simultanément horizontal ET vertical (coin proche d'un coin)", () => {
    const neighbor: SnapCandidate = { id: "layers", rect: rect(100, 100) };
    const dragged = rect(300 + SNAP_DISTANCE - 2, 250 + SNAP_DISTANCE - 2);
    const result = computeSnappedPosition(dragged, [neighbor], CANVAS);
    expect(result.x).toBe(100 + 200 + PANEL_GAP);
    expect(result.y).toBe(100 + 150 + PANEL_GAP);
  });

  it("accroche à un bord du canvas de façon flush (0px, pas de PANEL_GAP)", () => {
    const dragged = rect(SNAP_DISTANCE - 1, 400);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result.x).toBe(0);
  });

  it("accroche au bord droit du canvas de façon flush", () => {
    const dragged = rect(CANVAS.width - 200 - (SNAP_DISTANCE - 1), 400);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result.x).toBe(CANVAS.width - 200);
  });

  it("plusieurs candidats sous le seuil -> retient le plus proche (distance minimale)", () => {
    const near: SnapCandidate = { id: "near", rect: rect(300 + PANEL_GAP + 1, 100) }; // presque déjà accroché
    const far: SnapCandidate = { id: "far", rect: rect(100, 400) };
    // dragged juste à gauche de `near`, dans le rayon de snap de near mais pas de far.
    const dragged = rect(300 + PANEL_GAP + 1 - 200 - PANEL_GAP + 1, 100);
    const result = computeSnappedPosition(dragged, [near, far], CANVAS);
    expect(result.x).toBe(near.rect.x - 200 - PANEL_GAP);
  });

  it("égalité exacte de distance -> résolue par l'ordre de rendu (premier trouvé)", () => {
    // Deux voisins à distance identique du glissé sur l'axe x, dans le tableau
    // `others` le premier (index 0) doit gagner.
    const first: SnapCandidate = { id: "first", rect: rect(0, 100) };
    const second: SnapCandidate = { id: "second", rect: rect(500, 100) };
    // dragged pile au milieu, à distance égale des deux bords candidats.
    const dragged = rect(250 - 100, 100, 200, 150);
    const result = computeSnappedPosition(dragged, [first, second], CANVAS);
    // Les deux sont à la même distance -> le premier de `others` doit être retenu.
    // (Vérifié en comparant au résultat obtenu en inversant l'ordre du tableau.)
    const resultReversed = computeSnappedPosition(dragged, [second, first], CANVAS);
    expect(result.x).not.toBe(resultReversed.x);
  });

  it("contraint le panneau relâché à rester dans les limites du canvas", () => {
    const dragged = rect(-999, -999);
    const result = computeSnappedPosition(dragged, [], CANVAS);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + dragged.width).toBeLessThanOrEqual(CANVAS.width);
    expect(result.y + dragged.height).toBeLessThanOrEqual(CANVAS.height);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npm run test -- floatingPanel/snapping`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `computeSnappedPosition`**

Créer `src/components/floatingPanel/snapping.ts` :

```ts
/**
 * Magnétisme de FloatingPanel — appliqué UNE fois au relâchement du drag ou
 * du nudge clavier, jamais pendant (design.md §5 : pas de recalcul dynamique
 * si un panneau ancre bouge ensuite).
 *
 * Deux familles de candidats, résolues séparément par axe (x et y) :
 * - bords des autres panneaux visibles (écart PANEL_GAP, jamais 0)
 * - bords du canvas (flush, 0px)
 * Le candidat retenu par axe est celui de distance minimale sous SNAP_DISTANCE ;
 * égalité exacte -> le premier trouvé dans l'ordre de `others` (déterministe).
 * Enfin, le résultat est contraint aux limites du canvas (jamais hors-écran).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapCandidate {
  id: string;
  rect: Rect;
}

export const PANEL_GAP = 8;
export const SNAP_DISTANCE = 12;

interface AxisSnap {
  value: number;
  distance: number;
}

function snapAxisToNeighbors(
  draggedStart: number,
  draggedEnd: number,
  neighborStarts: number[],
  neighborEnds: number[]
): AxisSnap | null {
  let best: AxisSnap | null = null;
  // Bord "début" du glissé collé juste APRÈS le bord "fin" d'un voisin (+ gap).
  for (const end of neighborEnds) {
    const candidateValue = end + PANEL_GAP;
    const distance = Math.abs(draggedStart - candidateValue);
    if (distance <= SNAP_DISTANCE && (best === null || distance < best.distance)) {
      best = { value: candidateValue, distance };
    }
  }
  // Bord "fin" du glissé collé juste AVANT le bord "début" d'un voisin (- gap).
  for (const start of neighborStarts) {
    const candidateValue = start - PANEL_GAP - (draggedEnd - draggedStart);
    const distance = Math.abs(draggedStart - candidateValue);
    if (distance <= SNAP_DISTANCE && (best === null || distance < best.distance)) {
      best = { value: candidateValue, distance };
    }
  }
  return best;
}

function snapAxisToCanvasEdges(draggedStart: number, draggedEnd: number, canvasExtent: number): AxisSnap | null {
  let best: AxisSnap | null = null;
  const distanceToStart = Math.abs(draggedStart - 0);
  if (distanceToStart <= SNAP_DISTANCE) best = { value: 0, distance: distanceToStart };
  const flushEndValue = canvasExtent - (draggedEnd - draggedStart);
  const distanceToEnd = Math.abs(draggedStart - flushEndValue);
  if (distanceToEnd <= SNAP_DISTANCE && (best === null || distanceToEnd < best.distance)) {
    best = { value: flushEndValue, distance: distanceToEnd };
  }
  return best;
}

function resolveAxis(
  draggedStart: number,
  draggedSize: number,
  neighborStarts: number[],
  neighborEnds: number[],
  canvasExtent: number
): number {
  const draggedEnd = draggedStart + draggedSize;
  const neighborSnap = snapAxisToNeighbors(draggedStart, draggedEnd, neighborStarts, neighborEnds);
  const edgeSnap = snapAxisToCanvasEdges(draggedStart, draggedEnd, canvasExtent);
  // Egalité exacte entre les deux familles -> neighborSnap gagne car
  // `others` est parcouru en premier ; sinon la distance minimale gagne.
  if (neighborSnap && edgeSnap) {
    return neighborSnap.distance <= edgeSnap.distance ? neighborSnap.value : edgeSnap.value;
  }
  if (neighborSnap) return neighborSnap.value;
  if (edgeSnap) return edgeSnap.value;
  return draggedStart;
}

function clampToCanvas(value: number, size: number, canvasExtent: number): number {
  const max = Math.max(0, canvasExtent - size);
  return Math.min(Math.max(value, 0), max);
}

export function computeSnappedPosition(
  dragged: Rect,
  others: SnapCandidate[],
  canvasSize: { width: number; height: number }
): { x: number; y: number } {
  const neighborStartsX = others.map((o) => o.rect.x);
  const neighborEndsX = others.map((o) => o.rect.x + o.rect.width);
  const neighborStartsY = others.map((o) => o.rect.y);
  const neighborEndsY = others.map((o) => o.rect.y + o.rect.height);

  const snappedX = resolveAxis(dragged.x, dragged.width, neighborStartsX, neighborEndsX, canvasSize.width);
  const snappedY = resolveAxis(dragged.y, dragged.height, neighborStartsY, neighborEndsY, canvasSize.height);

  return {
    x: clampToCanvas(snappedX, dragged.width, canvasSize.width),
    y: clampToCanvas(snappedY, dragged.height, canvasSize.height),
  };
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npm run test -- floatingPanel/snapping`
Expected: PASS (les 9 tests).

Note sur le test "égalité exacte" : il vérifie une propriété (ordre-dépendance), pas une valeur numérique exacte, car construire un cas d'égalité *stricte* entre deux candidats symétriques nécessite un dragged pile au centre — le test compare deux appels avec `others` inversé et vérifie que le résultat DIFFÈRE, prouvant que l'ordre de `others` (pas un choix arbitraire à l'exécution) décide. Si l'implémentation ci-dessus produit une égalité totale par accident (les deux résultats identiques), revoir `resolveAxis` pour garantir que le premier candidat rencontré dans `others` gagne en cas d'égalité stricte de distance — actuellement garanti par la condition `distance < best.distance` (strict), qui ne remplace `best` que si le nouveau candidat est STRICTEMENT plus proche, donc le premier trouvé (indépendamment de la famille voisins/bords si `neighborSnap.distance <= edgeSnap.distance`) est conservé en cas d'égalité.

- [ ] **Step 5: Commit**

```bash
git add src/components/floatingPanel/snapping.ts test/components/floatingPanel/snapping.test.ts
git commit -m "feat(floating-panel): add pure snapping calculation (multi-panel + canvas edges)"
```

---

### Task 2: Modèle — nudge clavier borné aux limites du canvas

**Files:**
- Create: `src/components/floatingPanel/keyboardNudge.ts`
- Test: `test/components/floatingPanel/keyboardNudge.test.ts`

**Interfaces:**
- Consumes: `Rect` (Task 1, `src/components/floatingPanel/snapping.ts`).
- Produces:
  ```ts
  export const KEYBOARD_NUDGE_STEP = 16;
  export const KEYBOARD_NUDGE_STEP_LARGE = 64;
  export type NudgeDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
  export function computeNudgedPosition(
    current: Rect,
    direction: NudgeDirection,
    large: boolean,
    canvasSize: { width: number; height: number }
  ): { x: number; y: number };
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/components/floatingPanel/keyboardNudge.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  computeNudgedPosition,
  KEYBOARD_NUDGE_STEP,
  KEYBOARD_NUDGE_STEP_LARGE,
} from "../../../src/components/floatingPanel/keyboardNudge";
import type { Rect } from "../../../src/components/floatingPanel/snapping";

const CANVAS = { width: 1000, height: 800 };

function rect(x: number, y: number): Rect {
  return { x, y, width: 200, height: 150 };
}

describe("computeNudgedPosition", () => {
  it("ArrowRight déplace de KEYBOARD_NUDGE_STEP sur x", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowRight", false, CANVAS);
    expect(result).toEqual({ x: 100 + KEYBOARD_NUDGE_STEP, y: 100 });
  });

  it("ArrowLeft déplace de -KEYBOARD_NUDGE_STEP sur x", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowLeft", false, CANVAS);
    expect(result).toEqual({ x: 100 - KEYBOARD_NUDGE_STEP, y: 100 });
  });

  it("ArrowDown déplace de KEYBOARD_NUDGE_STEP sur y", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowDown", false, CANVAS);
    expect(result).toEqual({ x: 100, y: 100 + KEYBOARD_NUDGE_STEP });
  });

  it("ArrowUp déplace de -KEYBOARD_NUDGE_STEP sur y", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowUp", false, CANVAS);
    expect(result).toEqual({ x: 100, y: 100 - KEYBOARD_NUDGE_STEP });
  });

  it("Shift+flèche utilise KEYBOARD_NUDGE_STEP_LARGE", () => {
    const result = computeNudgedPosition(rect(100, 100), "ArrowRight", true, CANVAS);
    expect(result).toEqual({ x: 100 + KEYBOARD_NUDGE_STEP_LARGE, y: 100 });
  });

  it("reste contraint dans les limites du canvas (bord gauche)", () => {
    const result = computeNudgedPosition(rect(5, 100), "ArrowLeft", false, CANVAS);
    expect(result.x).toBe(0);
  });

  it("reste contraint dans les limites du canvas (bord droit)", () => {
    const result = computeNudgedPosition(rect(CANVAS.width - 200 - 5, 100), "ArrowRight", false, CANVAS);
    expect(result.x).toBe(CANVAS.width - 200);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- floatingPanel/keyboardNudge`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `src/components/floatingPanel/keyboardNudge.ts` :

```ts
/**
 * Alternative clavier au drag (finding revue adverse codex-crosscheck sur le
 * design.md §4 — drag-and-drop DOIT avoir une alternative clavier, convention
 * du projet). La poignée de titre focusable reçoit les flèches directionnelles ;
 * ce module traduit une pression de touche en nouvelle position, bornée aux
 * limites du canvas comme le magnétisme (snapping.ts). Le magnétisme lui-même
 * s'applique APRÈS ce nudge, côté appelant (voir Task 4) — ce module ne fait
 * que le déplacement brut + la contrainte de limites.
 */
import type { Rect } from "./snapping";

export const KEYBOARD_NUDGE_STEP = 16;
export const KEYBOARD_NUDGE_STEP_LARGE = 64;

export type NudgeDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function clamp(value: number, size: number, extent: number): number {
  const max = Math.max(0, extent - size);
  return Math.min(Math.max(value, 0), max);
}

export function computeNudgedPosition(
  current: Rect,
  direction: NudgeDirection,
  large: boolean,
  canvasSize: { width: number; height: number }
): { x: number; y: number } {
  const step = large ? KEYBOARD_NUDGE_STEP_LARGE : KEYBOARD_NUDGE_STEP;
  let { x, y } = current;
  if (direction === "ArrowLeft") x -= step;
  if (direction === "ArrowRight") x += step;
  if (direction === "ArrowUp") y -= step;
  if (direction === "ArrowDown") y += step;
  return {
    x: clamp(x, current.width, canvasSize.width),
    y: clamp(y, current.height, canvasSize.height),
  };
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npm run test -- floatingPanel/keyboardNudge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/floatingPanel/keyboardNudge.ts test/components/floatingPanel/keyboardNudge.test.ts
git commit -m "feat(floating-panel): add pure keyboard-nudge calculation with canvas clamping"
```

---

### Task 3: Modèle — viewport effectif (compensation statique du dock)

**Files:**
- Create: `src/components/floatingPanel/effectiveViewport.ts`
- Test: `test/components/floatingPanel/effectiveViewport.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEFAULT_PANEL_COLUMN_WIDTH = 288;
  export function computeEffectiveViewportWidth(windowWidth: number): number;
  ```

Contexte (design.md §8) : le centrage du canvas doit compenser UNE FOIS la largeur par défaut du dock virtuel (Calques + Réglages empilés à leur position de départ), PAS un recalcul réactif si l'utilisateur déplace les panneaux ensuite. Cette fonction pure isole ce calcul pour que la future intégration pan/zoom (`2026-07-18-shaderlab-canvas-pan-zoom-prd.md`, non implémentée) puisse le réutiliser tel quel (design.md §8, "séquencement non tranché" — ce plan pose la constante, le futur PRD pan/zoom la consommera).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/components/floatingPanel/effectiveViewport.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  computeEffectiveViewportWidth,
  DEFAULT_PANEL_COLUMN_WIDTH,
} from "../../../src/components/floatingPanel/effectiveViewport";

describe("computeEffectiveViewportWidth", () => {
  it("soustrait DEFAULT_PANEL_COLUMN_WIDTH de la largeur fenêtre", () => {
    expect(computeEffectiveViewportWidth(1600)).toBe(1600 - DEFAULT_PANEL_COLUMN_WIDTH);
  });

  it("ne descend jamais sous un plancher de canvas-min-width (480px)", () => {
    // Fenêtre minimale (--window-min-width: 900px, CLAUDE.md) moins le dock
    // ne doit pas produire un viewport négatif ou absurdement petit.
    expect(computeEffectiveViewportWidth(900)).toBeGreaterThanOrEqual(480);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run test -- floatingPanel/effectiveViewport`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `src/components/floatingPanel/effectiveViewport.ts` :

```ts
/**
 * Compensation STATIQUE du centrage canvas pour la largeur par défaut du dock
 * virtuel (Calques + Réglages à leur position de départ) — design.md §8.
 * Calculée UNE fois sur cette constante, jamais recalculée sur la position
 * réelle des panneaux si l'utilisateur les déplace ensuite. La valeur reprend
 * `--inspector-width-default` (288px, src/design/components.css) : le dock
 * virtuel occupe visuellement la même largeur que l'ancien Inspector docké.
 */
export const DEFAULT_PANEL_COLUMN_WIDTH = 288;

// Plancher aligné sur --canvas-min-width (src/design/components.css) : la
// compensation ne doit jamais réduire le viewport effectif sous ce minimum,
// même sur la largeur de fenêtre plancher du projet (--window-min-width: 900px).
const CANVAS_MIN_WIDTH = 480;

export function computeEffectiveViewportWidth(windowWidth: number): number {
  return Math.max(windowWidth - DEFAULT_PANEL_COLUMN_WIDTH, CANVAS_MIN_WIDTH);
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npm run test -- floatingPanel/effectiveViewport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/floatingPanel/effectiveViewport.ts test/components/floatingPanel/effectiveViewport.test.ts
git commit -m "feat(floating-panel): add pure effective-viewport calculation (static dock compensation)"
```

---

### Task 4: Tokens — z-index et ombre de panneau flottant

**Files:**
- Modify: `src/design/primitives.css` (z-index)
- Modify: `src/design/components.css` (ombre)

**Interfaces:**
- Produces: `--z-floating-panel` (nouveau), `--shadow-panel-resting`/`--shadow-panel-dragging` (nouveaux).

Ambiguïté tranchée ici (aucune échelle de z-index ni d'ombre pour un panneau flottant n'existe dans le repo — `src/design/primitives.css` a `--z-canvas-overlay: 10` / `--z-sticky: 20` / `--z-popover: 40`, rien entre les deux ; `components.css` n'a aucun token `--shadow-*`) : les panneaux flottants sont au-dessus du canvas mais sous tout overlay de type popover/dialog/tooltip → nouvelle valeur `15`, entre `--z-canvas-overlay` (10) et `--z-sticky` (20). L'ombre est nouvelle (le design.md §3 exige "cadre et ombre propres à chaque panneau, jamais fusionnés" — la règle globale UI socle exige une échelle nommée, pas une valeur ad hoc par composant) : deux valeurs, repos et pendant-drag (légèrement plus prononcée, cohérent avec `--panel-radius`/`--radius-panel` existants).

- [ ] **Step 1: Ajouter le z-index dans `src/design/primitives.css`**

Dans le bloc `:root`, entre `--z-canvas-overlay: 10;` et `--z-sticky: 20;` (ligne ~86) :

```css
  --z-canvas-overlay: 10;
  --z-floating-panel: 15;
  --z-sticky: 20;
```

- [ ] **Step 2: Ajouter les tokens d'ombre dans `src/design/components.css`**

Dans le bloc `:root`, après le groupe `--panel-*` (ligne ~44-46) :

```css
  --panel-bg: var(--surface-panel);
  --panel-border: var(--border-default);
  --panel-radius: var(--radius-panel);
  --shadow-panel-resting: 0 2px 8px rgba(8, 7, 6, .32);
  --shadow-panel-dragging: 0 6px 20px rgba(8, 7, 6, .44);
```

- [ ] **Step 3: Vérifier le lint de tokens**

Run: `npm run lint:tokens`
Expected: PASS (les nouveaux tokens sont déclarés dans les fichiers canoniques, pas de valeur en dur introduite par ce commit).

- [ ] **Step 4: Commit**

```bash
git add src/design/primitives.css src/design/components.css
git commit -m "feat(design): add floating-panel z-index and shadow tokens"
```

---

### Task 5: Composant `FloatingPanel` — structure statique (sans drag)

**Files:**
- Create: `src/components/floatingPanel/FloatingPanel.tsx`
- Create: `src/components/floatingPanel/FloatingPanel.css`

**Interfaces:**
- Consumes: rien (composant de présentation pur, pas encore de drag — Task 6 l'ajoute).
- Produces:
  ```ts
  export interface FloatingPanelProps {
    title: string;
    position: { x: number; y: number };
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
    children: React.ReactNode;
  }
  export function FloatingPanel(props: FloatingPanelProps): JSX.Element;
  ```

Ce composant pose la structure visuelle (barre de titre + chevron de repli + contenu, positionné en absolu) SANS le drag — Task 6 ajoute `onPositionChange`/le pointer-events handling par-dessus, pour isoler la review du markup/CSS de celle de l'interaction (chaque tâche démontrable seule : celle-ci se vérifie déjà visuellement — panneau statique bien positionné, repli instantané fonctionnel — avant d'ajouter la complexité du drag).

- [ ] **Step 1: Écrire le composant**

Créer `src/components/floatingPanel/FloatingPanel.tsx` :

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";

export interface FloatingPanelProps {
  title: string;
  position: { x: number; y: number };
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
}

/**
 * Conteneur générique flottant — Calques/Réglages aujourd'hui, Masques
 * (Tranche 4 du chantier calques/masquage) demain. Position et repli sont
 * TOUJOURS remontés à l'appelant (App.tsx) : ce composant ne possède aucun
 * state de position persistant, même philosophie que LayerPanel/ParamPanel
 * (state remonté, composants de présentation purs).
 *
 * Repli/dépli INSTANTANÉ, sans transition (design.md §6, observé sur
 * Photoshop réel) : le contenu est démonté/remonté (`collapsed && null`),
 * jamais une hauteur animée.
 */
export function FloatingPanel({ title, position, collapsed, onCollapsedChange, children }: FloatingPanelProps) {
  return (
    <div
      className="floating-panel"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="floating-panel__titlebar">
        <span className="floating-panel__title">{title}</span>
        <IconButton
          label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
          size="compact"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </IconButton>
      </div>
      {!collapsed && <div className="floating-panel__content">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Écrire le CSS**

Créer `src/components/floatingPanel/FloatingPanel.css` :

```css
/*
 * FloatingPanel : conteneur générique (Calques/Réglages aujourd'hui, Masques
 * Tranche 4 demain). Positionné en absolute dans .canvas-stage (position:
 * relative, voir Task 8) via transform: translate() — jamais top/left, pour
 * rester fluide pendant le drag (Task 6/7).
 *
 * Chaque panneau garde son propre cadre + ombre, jamais fusionné visuellement
 * avec un voisin même accroché juste à côté (design.md §3 — 8px d'écart
 * minimum, cf. PANEL_GAP dans snapping.ts).
 */

.floating-panel {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--inspector-width-default);
  min-width: var(--inspector-width-min);
  max-width: var(--inspector-width-max);
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--shadow-panel-resting);
  color: var(--text-primary);
  z-index: var(--z-floating-panel);
  overflow: visible; /* Select existant : pas de portail, popup jamais clippé */
}

.floating-panel__titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--section-header-height);
  padding-inline: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  cursor: grab;
  user-select: none;
}

.floating-panel__title {
  font-family: var(--font-ui);
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floating-panel__content {
  padding: var(--space-4);
}
```

- [ ] **Step 3: Vérifier compilation**

Run: `npx tsc --noEmit`
Expected: OK (composant non encore branché dans `App.tsx` — Task 9 le fait).

- [ ] **Step 4: Commit**

```bash
git add src/components/floatingPanel/FloatingPanel.tsx src/components/floatingPanel/FloatingPanel.css
git commit -m "feat(floating-panel): add static FloatingPanel container (title bar + instant collapse)"
```

---

### Task 6: `FloatingPanel` — drag pointer events avec fantôme

**Files:**
- Modify: `src/components/floatingPanel/FloatingPanel.tsx`
- Modify: `src/components/floatingPanel/FloatingPanel.css`

**Interfaces:**
- Consumes: `computeSnappedPosition`/`SnapCandidate` (Task 1), `computeNudgedPosition`/`NudgeDirection` (Task 2).
- Produces: `FloatingPanelProps` gagne
  ```ts
  onPositionChange: (position: { x: number; y: number }) => void;
  size: { width: number; height: number };
  siblingRects: SnapCandidate[]; // les AUTRES panneaux visibles, pour le magnétisme
  canvasSize: { width: number; height: number };
  ```

- [ ] **Step 1: Étendre le composant avec le drag**

Modifier `src/components/floatingPanel/FloatingPanel.tsx` — remplacer le contenu par :

```tsx
import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import { computeSnappedPosition, type SnapCandidate } from "./snapping";
import { computeNudgedPosition, type NudgeDirection } from "./keyboardNudge";

export interface FloatingPanelProps {
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;
  onPositionChange: (position: { x: number; y: number }) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Les AUTRES panneaux visibles (jamais soi-même) — pour le magnétisme. */
  siblingRects: SnapCandidate[];
  canvasSize: { width: number; height: number };
  children: React.ReactNode;
}

interface DragGhostState {
  pointerId: number;
  /** Décalage curseur -> coin haut-gauche du panneau au moment du pointerdown,
   *  pour que le fantôme suive le curseur sans "sauter" au premier mouvement. */
  grabOffset: { x: number; y: number };
  /** Position courante du fantôme (coordonnées du conteneur canvas). */
  ghostPosition: { x: number; y: number };
}

const NUDGE_KEYS = new Set<NudgeDirection>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * Conteneur générique flottant — Calques/Réglages aujourd'hui, Masques
 * (Tranche 4 du chantier calques/masquage) demain. Position et repli sont
 * TOUJOURS remontés à l'appelant (App.tsx) : ce composant ne possède aucun
 * state de position PERSISTANT — seul l'état éphémère du drag en cours
 * (fantôme) est local.
 *
 * Drag par pointer events (setPointerCapture), PAS le DnD HTML5 natif — même
 * décision et même raison que LayerPanel.tsx : dragstart HTML5 ne relaie pas
 * fiablement dragover/drop dans ce WebView2 (preuve CDP sur geste humain réel).
 *
 * Pendant le drag (design.md §4, observé sur Photoshop réel) : le panneau
 * reste visible à sa position d'origine, ESTOMPÉ, jusqu'au relâchement ; un
 * fantôme semi-transparent suit le curseur via transform (pas top/left, pour
 * rester fluide). Au relâchement, le magnétisme (snapping.ts) s'applique UNE
 * fois — jamais pendant le drag.
 *
 * Alternative clavier (finding revue adverse codex-crosscheck, convention
 * d'accessibilité du projet) : la poignée de titre est focusable, les flèches
 * directionnelles nudgent par pas fixe (keyboardNudge.ts), Shift = pas large.
 * Le magnétisme s'applique aussi à la position atteinte au clavier.
 */
export function FloatingPanel({
  title,
  position,
  size,
  collapsed,
  onPositionChange,
  onCollapsedChange,
  siblingRects,
  canvasSize,
  children,
}: FloatingPanelProps) {
  const [ghost, setGhost] = useState<DragGhostState | null>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore un 2e pointeur tant qu'un drag est en cours — même garde que
      // LayerPanel.handleGripPointerDown (finding codex-crosscheck original).
      if (ghost) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setGhost({
        pointerId: e.pointerId,
        grabOffset: { x: e.clientX - position.x, y: e.clientY - position.y },
        ghostPosition: position,
      });
    },
    [ghost, position]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      setGhost((prev) => {
        if (!prev || e.pointerId !== prev.pointerId) return prev;
        return {
          ...prev,
          ghostPosition: {
            x: e.clientX - prev.grabOffset.x,
            y: e.clientY - prev.grabOffset.y,
          },
        };
      });
    },
    []
  );

  const commitGhostPosition = useCallback(
    (raw: { x: number; y: number }) => {
      const snapped = computeSnappedPosition({ ...raw, width: size.width, height: size.height }, siblingRects, canvasSize);
      onPositionChange(snapped);
    },
    [size, siblingRects, canvasSize, onPositionChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setGhost((prev) => {
        if (!prev || e.pointerId !== prev.pointerId) return prev;
        commitGhostPosition(prev.ghostPosition);
        return null;
      });
    },
    [commitGhostPosition]
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    setGhost((prev) => (prev && e.pointerId === prev.pointerId ? null : prev));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!NUDGE_KEYS.has(e.key as NudgeDirection)) return;
      e.preventDefault();
      const nudged = computeNudgedPosition(
        { ...position, width: size.width, height: size.height },
        e.key as NudgeDirection,
        e.shiftKey,
        canvasSize
      );
      commitGhostPosition(nudged);
    },
    [position, size, canvasSize, commitGhostPosition]
  );

  return (
    <>
      <div
        className={`floating-panel ${ghost ? "floating-panel--origin-dimmed" : ""}`.trim()}
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      >
        <div
          ref={titlebarRef}
          className="floating-panel__titlebar"
          tabIndex={0}
          role="button"
          aria-label={`Déplacer le panneau ${title}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
        >
          <span className="floating-panel__title">{title}</span>
          <IconButton
            label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
            size="compact"
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </IconButton>
        </div>
        {!collapsed && <div className="floating-panel__content">{children}</div>}
      </div>
      {ghost && (
        <div
          className="floating-panel floating-panel--ghost"
          style={{
            transform: `translate(${ghost.ghostPosition.x}px, ${ghost.ghostPosition.y}px)`,
            width: size.width,
            height: size.height,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Étendre le CSS pour l'estompage et le fantôme**

Ajouter à `src/components/floatingPanel/FloatingPanel.css` :

```css
/* Pendant le drag : le panneau d'origine reste visible mais estompé (design.md
   §4) — 0.5 littéral et ponctuel, même justification que
   .layer-panel__row--dragging dans components.css (LayerPanel) : aucun token
   "élément en cours de glisser" n'existe, un seul usage ne justifie pas d'en
   créer un pour l'instant. */
.floating-panel--origin-dimmed {
  opacity: 0.5;
}

/* Fantôme semi-transparent qui suit le curseur (design.md §4, observé sur
   Photoshop réel). transform uniquement (jamais top/left) pour rester fluide
   à la fréquence pointermove. pointer-events: none — le fantôme ne doit
   jamais intercepter les événements destinés au panneau d'origine ou au
   canvas en dessous. */
.floating-panel--ghost {
  opacity: 0.6;
  box-shadow: var(--shadow-panel-dragging);
  pointer-events: none;
}

.floating-panel__titlebar:focus-visible {
  outline: var(--focus-width) solid var(--focus-color);
  outline-offset: var(--focus-offset);
}
```

- [ ] **Step 3: Vérifier compilation**

Run: `npx tsc --noEmit`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/floatingPanel/FloatingPanel.tsx src/components/floatingPanel/FloatingPanel.css
git commit -m "feat(floating-panel): add pointer-events drag with ghost, snapping, keyboard nudge"
```

---

### Task 7: Checkpoint visuel humain — `FloatingPanel` isolé (avant migration)

**Files:**
- Modify temporaire: `src/App.tsx` (montage de test d'UN `FloatingPanel` autonome, à retirer avant la fin de la tâche — ou : monter directement via Storybook si un composant équivalent existe déjà, voir Step 1)

**Interfaces:** aucune nouvelle — cette tâche est un GATE de vérification pure avant de migrer `LayerPanel`/`ParamPanel` dans le nouveau conteneur (risque isolé : si le drag/magnétisme/fantôme ne marche pas, la Task 8 n'a pas encore touché la structure `App.tsx` réelle, rollback trivial).

- [ ] **Step 1: Vérifier si Storybook est déjà configuré pour ce composant**

Run: `npm run storybook` (le projet a Storybook — voir CLAUDE.md § Commandes, tokens réels via `src/design/index.css`). Si un fichier `FloatingPanel.stories.tsx` n'existe pas, en créer un minimal :

```tsx
// src/components/floatingPanel/FloatingPanel.stories.tsx
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { FloatingPanel } from "./FloatingPanel";

const meta: Meta<typeof FloatingPanel> = {
  title: "FloatingPanel",
  component: FloatingPanel,
};
export default meta;

export const TwoPanels: StoryObj = {
  render: () => {
    function Demo() {
      const [posA, setPosA] = useState({ x: 40, y: 40 });
      const [posB, setPosB] = useState({ x: 40, y: 260 });
      const [collapsedA, setCollapsedA] = useState(false);
      const [collapsedB, setCollapsedB] = useState(false);
      const size = { width: 288, height: 180 };
      const canvasSize = { width: 1000, height: 700 };
      return (
        <div style={{ position: "relative", width: canvasSize.width, height: canvasSize.height, background: "#151310" }}>
          <FloatingPanel
            title="Calques"
            position={posA}
            size={size}
            collapsed={collapsedA}
            onPositionChange={setPosA}
            onCollapsedChange={setCollapsedA}
            siblingRects={[{ id: "b", rect: { ...posB, ...size } }]}
            canvasSize={canvasSize}
          >
            Contenu Calques (placeholder)
          </FloatingPanel>
          <FloatingPanel
            title="Réglages"
            position={posB}
            size={size}
            collapsed={collapsedB}
            onPositionChange={setPosB}
            onCollapsedChange={setCollapsedB}
            siblingRects={[{ id: "a", rect: { ...posA, ...size } }]}
            canvasSize={canvasSize}
          >
            Contenu Réglages (placeholder)
          </FloatingPanel>
        </div>
      );
    }
    return <Demo />;
  },
};
```

Storybook rend en DOM pur (pas de canvas WebGPU) — Playwright headless EST valide ici si besoin d'automatiser un futur non-régression visuel, mais ce n'est pas requis par ce plan : la vérification de cette tâche reste le checkpoint humain (Step 2), car le drag/magnétisme/fantôme est une interaction pointeur qu'aucun outil automatisé de ce projet n'est chargé de couvrir (design.md §9).

- [ ] **Step 2: Checkpoint visuel humain (obligatoire)**

Antoine ouvre la story `FloatingPanel > TwoPanels` (`npm run storybook`, port 6006) et vérifie :
1. Les deux panneaux sont positionnés correctement, cadre + ombre propres à chacun, jamais fusionnés visuellement même rapprochés.
2. Drag de la poignée de titre d'un panneau : le panneau d'origine s'estompe, un fantôme semi-transparent suit le curseur.
3. Relâcher près de l'autre panneau (horizontalement ET verticalement) : accrochage avec un écart visible de 8px, jamais bord-à-bord à 0.
4. Relâcher près d'un bord de la zone `1000x700` : accrochage flush (0px).
5. Relâcher loin de tout : le panneau reste à la position brute du relâchement.
6. Repli/dépli (chevron) : instantané, aucune animation de hauteur.
7. Focus clavier sur la poignée (Tab) puis flèches : le panneau se déplace par pas ; Shift+flèche = pas plus large ; le magnétisme s'applique aussi ici.

Ne pas cocher cette étape sans confirmation explicite d'Antoine. Si un comportement diverge du design.md, corriger `snapping.ts`/`keyboardNudge.ts`/`FloatingPanel.tsx` avant de continuer — ne pas migrer `LayerPanel`/`ParamPanel` sur une base non validée.

- [ ] **Step 3: Commit (story de vérification conservée comme fixture de dev)**

```bash
git add src/components/floatingPanel/FloatingPanel.stories.tsx
git commit -m "test(floating-panel): add Storybook fixture for human visual checkpoint"
```

---

### Task 8: Layout — canvas plein écran, `.workspace` en conteneur de positionnement

**Files:**
- Modify: `src/App.css`
- Modify: `src/components/Canvas.css`
- Modify: `src/App.tsx` (structure JSX de `<main className="workspace">`)

**Interfaces:**
- Consumes: `computeEffectiveViewportWidth` (Task 3), pour l'usage centrage/fit-to-screen — CE PLAN n'implémente PAS de pan/zoom (hors scope, PRD séparé non implémenté), mais applique déjà la compensation statique à `.canvas-stage` pour que le canvas ne semble pas décentré sous le dock virtuel par défaut.
- Produces: `.workspace` n'est plus un flex-row Canvas+aside ; `.canvas-stage` occupe toute la largeur sous la Toolbar et sert de conteneur `position: relative` pour les `FloatingPanel` (rendus par-dessus, cf. Task 9).

- [ ] **Step 1: Modifier `.workspace` dans `src/App.css`**

```css
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: var(--window-min-width);
  min-height: var(--window-min-height);
  background: var(--surface-window);
}

.workspace {
  position: relative;
  flex: 1;
  overflow: hidden;
}
```

(Suppression de `display: flex` sur `.workspace` — il ne contient plus deux enfants côte à côte, seulement le `<Canvas>` plein écran + les `FloatingPanel` en position absolue par-dessus.)

- [ ] **Step 2: Adapter `.canvas-stage` pour occuper 100% de `.workspace`**

Dans `src/components/Canvas.css`, `.canvas-stage` passe de `flex: 1` (dépendant d'un parent flex) à un remplissage explicite du conteneur `position: relative` :

```css
.canvas-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: var(--canvas-min-width);
  min-height: var(--canvas-min-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-workspace);
  color: var(--text-primary);
  /* Compensation statique du centrage (design.md §8) : décale le point de
     centrage vers la gauche de la largeur par défaut du dock virtuel, pour
     que la photo ne semble pas centrée SOUS les panneaux Calques/Réglages
     à leur position de départ. Calculée une fois, pas réactive à un
     déplacement ultérieur des panneaux par l'utilisateur — voir
     computeEffectiveViewportWidth (src/components/floatingPanel/effectiveViewport.ts)
     et son commentaire pour la valeur exacte et le futur usage pan/zoom. */
  padding-right: calc(var(--inspector-width-default) * 2);
}
```

Note : `padding-right` sur `.canvas-stage` (flex `justify-content: center`) recrée l'effet visuel de "centrage compensé" par un padding asymétrique — approche CSS pure suffisante pour ce plan (pas de recalcul JS réactif, cf. contrainte "statique"). Si la Task 3 (`computeEffectiveViewportWidth`) doit piloter une valeur JS plus tard (ex. pour le futur pan/zoom qui repositionne le canvas via `transform`), ce padding CSS reste la version v1 — le point d'intégration JS est documenté dans `effectiveViewport.ts` mais pas câblé ici (hors scope : aucun code de pan/zoom n'existe encore dans ce repo).

- [ ] **Step 3: Retirer l'ancien layout Canvas+Inspector dans `App.tsx`**

Dans `src/App.tsx`, le bloc `<main className="workspace">` passe de :

```tsx
      <main className="workspace">
        <Canvas ... />
        <Inspector ... />
      </main>
```

à (structure provisoire de cette tâche — Task 9 remplace `<Inspector>` par les deux `<FloatingPanel>`) :

```tsx
      <main className="workspace">
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null, false)}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
          brushSize={brushSize}
          brushHardness={brushHardness}
        />
      </main>
```

(Suppression temporaire du rendu de `<Inspector>` — cette tâche est un jalon intermédiaire vérifiable seul : "le canvas occupe tout l'écran, pas d'erreur console". La Task 9 réintroduit Calques/Réglages via `FloatingPanel` dans la foulée du même plan, mais garder les deux changements séparés permet un rollback ciblé si le layout plein écran seul pose un problème CSS imprévu.)

- [ ] **Step 4: Vérifier compilation**

Run: `npx tsc --noEmit`
Expected: Erreur attendue — `Inspector`/`onOpacityChange` etc. ne sont plus utilisés dans `App.tsx` (imports inutilisés). Retirer l'import `Inspector` temporairement de `App.tsx` pour ce commit intermédiaire :

```ts
// import { Inspector } from "./components/Inspector"; // réintroduit en Task 9 via FloatingPanel
```

Run à nouveau : `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Checkpoint visuel humain (obligatoire)**

`npm run dev:debug` puis `npm run dev:monitor`. Antoine vérifie dans la vraie fenêtre :
1. Le canvas (ou son placeholder gris `.canvas-stage` avant chargement d'image) occupe toute la fenêtre sous la Toolbar — plus de colonne latérale.
2. Aucune erreur console/WebView2.
3. Charger une photo (glisser-déposer) : l'image s'affiche centrée avec le décalage vers la gauche attendu (pas parfaitement centrée dans la fenêtre entière — c'est voulu, cf. §8).

Ne pas cocher sans confirmation d'Antoine.

- [ ] **Step 6: Commit**

```bash
git add src/App.css src/components/Canvas.css src/App.tsx
git commit -m "feat(layout): make canvas fullscreen, workspace becomes floating-panel container"
```

---

### Task 9: Migration — `LayerPanel`/`ParamPanel` en `FloatingPanel`, retrait de `Inspector`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/LayerPanel.tsx` (retrait du titre `<h2>` propre — porté par `FloatingPanel` désormais)
- Modify: `src/components/ParamPanel.tsx` (titre dynamique `Réglages · <nom effet>`)
- Delete: `src/components/Inspector.tsx`
- Delete: `src/components/Inspector.css` (déplacer les classes `.layer-panel__*`/`.param-panel__*` encore utilisées vers `src/components/floatingPanel/FloatingPanel.css` ou un fichier dédié si elles doivent survivre à `Inspector.css` — voir Step 3)
- Test: `test/components/LayerPanel.test.ts` (déjà existant, vérifie qu'aucune régression sur `computeInsertIndex` — inchangé par cette tâche)

**Interfaces:**
- Consumes: `FloatingPanel`/`FloatingPanelProps` (Task 6), `SnapCandidate` (Task 1), `DEFAULT_PANEL_COLUMN_WIDTH` (Task 3).
- Produces: `App.tsx` gagne le state de position/repli des deux panneaux :
  ```ts
  const [layersPanelState, setLayersPanelState] = useState({ position: { x: 0, y: 0 }, collapsed: false });
  const [paramsPanelState, setParamsPanelState] = useState({ position: { x: 0, y: 0 }, collapsed: false });
  ```

- [ ] **Step 1: Position de départ ancrée près de la Toolbar (design.md §2)**

Dans `src/App.tsx`, ajouter après les autres `useState` :

```ts
  // Position de départ des panneaux flottants : ancrés côté droit, même zone
  // que l'ancien Inspector docké (design.md §2) — PAS une colonne contrainte
  // en dur, seulement un point de départ librement déplaçable ensuite.
  const PANEL_SIZE = { width: 288, height: 320 }; // largeur = DEFAULT_PANEL_COLUMN_WIDTH
  const [layersPanel, setLayersPanel] = useState({
    position: { x: window.innerWidth - PANEL_SIZE.width - 16, y: 52 },
    collapsed: false,
  });
  const [paramsPanel, setParamsPanel] = useState({
    position: { x: window.innerWidth - PANEL_SIZE.width - 16, y: 52 + PANEL_SIZE.height + 8 },
    collapsed: false,
  });
```

- [ ] **Step 2: Titre dynamique de `ParamPanel` (`Réglages · <nom de l'effet>`)**

Dans `src/App.tsx`, calculer le titre affiché par le `FloatingPanel` de réglages (le composant `ParamPanel` lui-même garde sa logique de contenu inchangée, seul le TITRE porté par le conteneur change) :

```ts
  const paramsPanelTitle = selectedLayer ? `Réglages · ${getEffect(selectedLayer.effectId).name}` : "Réglages";
```

Ajouter l'import nécessaire en tête de fichier :

```ts
import { getEffect } from "./render/effects/registry";
```

- [ ] **Step 3: Retirer `LayerPanel`'s/`ParamPanel`'s section titles portés par l'ancien `Inspector`**

`Inspector.tsx` rendait `<h2 id="layers-title">Calques</h2>` / `<h2 id="parameters-title">Réglages</h2>` — ces titres sont désormais portés par `FloatingPanel.__title` (Task 5). Vérifier qu'aucun composant `LayerPanel`/`ParamPanel` ne duplique ce titre en interne (lecture de `LayerPanel.tsx`/`ParamPanel.tsx` confirme : aucun `<h2>` interne, le titre était uniquement dans `Inspector.tsx`) — rien à modifier dans ces deux fichiers pour cette raison précise.

Déplacer les classes CSS encore nécessaires de `src/components/Inspector.css` (`.layer-panel__*`, `.param-panel__*` — tout SAUF `.inspector`/`.inspector__*`, qui disparaissent avec le conteneur docké) vers un nouveau fichier `src/components/LayerPanel.css` et `src/components/ParamPanel.css` respectivement (split par composant, cohérent avec la convention 1-fichier-CSS-par-composant déjà en place pour `BrushToolbar.css`/`Canvas.css`) :

`src/components/LayerPanel.css` reçoit les blocs `/* ---------- LayerPanel ---------- */` de l'ancien `Inspector.css` (lignes 46-150 environ : `.layer-panel`, `.layer-panel__list`, `.layer-panel__row*`, `.layer-panel__grip*`, `.layer-panel__row-name*`).

`src/components/ParamPanel.css` reçoit les blocs `/* ---------- ParamPanel ---------- */` (lignes 152-189 environ : `.param-panel`, `.param-panel__empty`, `.param-panel__hint`, `.param-panel__effect-name`, `.param-panel__group`).

Ajouter les imports correspondants en tête de `LayerPanel.tsx`/`ParamPanel.tsx` :

```ts
import "./LayerPanel.css";
```
```ts
import "./ParamPanel.css";
```

(Vérifier la convention réelle d'import CSS du projet — `git grep -n "import \"./.*\.css\"" src/components` — avant d'ajouter ces lignes ; si le projet importe plutôt tout le CSS composants via un point d'entrée central, suivre ce pattern à la place.)

- [ ] **Step 4: Remplacer `<Inspector>` par deux `<FloatingPanel>` dans `App.tsx`**

```tsx
      <main className="workspace">
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null, false)}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
          brushSize={brushSize}
          brushHardness={brushHardness}
        />
        <FloatingPanel
          title="Calques"
          position={layersPanel.position}
          size={PANEL_SIZE}
          collapsed={layersPanel.collapsed}
          onPositionChange={(position) => setLayersPanel((s) => ({ ...s, position }))}
          onCollapsedChange={(collapsed) => setLayersPanel((s) => ({ ...s, collapsed }))}
          siblingRects={[{ id: "params", rect: { ...paramsPanel.position, ...PANEL_SIZE } }]}
          canvasSize={{ width: window.innerWidth, height: window.innerHeight }}
        >
          <LayerPanel
            layers={layers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={handleToggle}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onReorder={handleReorder}
            onOpacityChange={handleOpacityChange}
            onOpacityCommit={handleParamCommit}
            onBlendModeChange={handleBlendModeChange}
          />
        </FloatingPanel>
        <FloatingPanel
          title={paramsPanelTitle}
          position={paramsPanel.position}
          size={PANEL_SIZE}
          collapsed={paramsPanel.collapsed}
          onPositionChange={(position) => setParamsPanel((s) => ({ ...s, position }))}
          onCollapsedChange={(collapsed) => setParamsPanel((s) => ({ ...s, collapsed }))}
          siblingRects={[{ id: "layers", rect: { ...layersPanel.position, ...PANEL_SIZE } }]}
          canvasSize={{ width: window.innerWidth, height: window.innerHeight }}
        >
          <ParamPanel
            layer={selectedLayer}
            onParamChange={handleParamChange}
            onParamCommit={handleParamCommit}
            maskPaintMode={maskPaintMode}
            onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
          />
        </FloatingPanel>
      </main>
```

Ajouter/retirer les imports en tête de `App.tsx` :

```ts
import { FloatingPanel } from "./components/floatingPanel/FloatingPanel";
import { LayerPanel } from "./components/LayerPanel";
import { ParamPanel } from "./components/ParamPanel";
// import { Inspector } from "./components/Inspector"; // supprimé — remplacé par FloatingPanel
```

- [ ] **Step 5: Supprimer `Inspector.tsx`/`Inspector.css`**

```bash
git rm src/components/Inspector.tsx src/components/Inspector.css
```

- [ ] **Step 6: Vérifier compilation + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc OK (aucune référence résiduelle à `Inspector`/`InspectorProps`) ; tous les tests passent, y compris `test/components/LayerPanel.test.ts` (inchangé) et les nouveaux tests `floatingPanel/*`.

- [ ] **Step 7: Vérifier le lint de tokens**

Run: `npm run lint:tokens`
Expected: PASS (le split CSS ne doit introduire aucune valeur en dur — copie littérale des règles existantes).

- [ ] **Step 8: Checkpoint visuel humain (obligatoire, le plus complet du plan)**

`npm run dev:debug` puis `npm run dev:monitor`. Antoine vérifie dans la vraie fenêtre, sur une vraie photo chargée :
1. **Position de départ** : Calques et Réglages apparaissent ancrés côté droit près de la Toolbar, empilés verticalement avec l'écart `PANEL_GAP` — comme l'ancien Inspector docké, visuellement.
2. **Contenu inchangé** : toutes les fonctions Calques (ajouter effet, sélectionner, activer/désactiver, réordonner par drag de la poignée, opacité, mode de fusion, supprimer) et Réglages (sliders d'effet, bouton peindre le masque) fonctionnent EXACTEMENT comme avant — aucune régression métier.
3. **Titre dynamique** : sélectionner un calque Glow → le panneau Réglages affiche "Réglages · Glow" ; changer de calque → le titre suit.
4. **Drag des panneaux** : détacher Calques ou Réglages n'importe où sur le canvas, fantôme + estompage + magnétisme **entre les deux panneaux uniquement** fonctionnent (le magnétisme aux bords du canvas a été retiré après retour Antoine, 2026-07-20 — "le magnétisme devrait surtout fonctionner entre modules" — un panneau relâché près du bord reste à sa position brute, seul `clampToCanvas` l'empêche de sortir de l'écran).
5. **Repli** : replier un panneau → son contenu disparaît instantanément, pas d'animation.
6. **Canvas plein écran** : l'image déborde visiblement derrière/sous les panneaux quand on regarde les bords — pas de bande vide latérale comme avant.
7. **Alternative clavier** : Tab jusqu'à la poignée d'un panneau, flèches pour déplacer, confirme le magnétisme au clavier aussi.
8. Aucune erreur console/WebView2 pendant toute la session de test.

Ne pas cocher sans confirmation explicite et complète d'Antoine — c'est le jalon final de ce plan.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/LayerPanel.tsx src/components/ParamPanel.tsx src/components/LayerPanel.css src/components/ParamPanel.css
git commit -m "feat(ui): migrate Calques/Réglages to FloatingPanel, remove docked Inspector"
```

---

## Notes de fin

- **Terminé (ce plan) = démontrable** : `FloatingPanel` générique fonctionnel (drag, fantôme, magnétisme panneau↔panneau uniquement — retiré du bord canvas après retour Antoine, 2026-07-20 —, repli instantané, alternative clavier), Calques et Réglages migrés dessus sans régression métier, canvas plein écran avec compensation de centrage statique — tout validé par checkpoint visuel humain CDP (Tasks 7, 8, 9) et par les tests purs de `snapping.ts`/`keyboardNudge.ts`/`effectiveViewport.ts` (Tasks 1-3).
- **Différé** (hors de ce plan, voir design.md § Différé) : contenu du panneau Masques (Tranche 4 — `FloatingPanel` est déjà prêt à le recevoir, aucun changement d'infra attendu), redimensionnement des panneaux, persistance de position entre sessions.
- **Séquencement avec le PRD pan/zoom** (`2026-07-18-shaderlab-canvas-pan-zoom-prd.md`, non implémenté) : ce plan pose `DEFAULT_PANEL_COLUMN_WIDTH`/`computeEffectiveViewportWidth` (Task 3) et applique la compensation en CSS pur (Task 8) ; le futur chantier pan/zoom devra consommer cette même fonction pour son calcul de fit-to-screen plutôt que `window.innerWidth` brut (design.md §8) — pas de code pan/zoom écrit ici.

## Ambiguïtés du design.md tranchées pendant la rédaction de ce plan (à vérifier a posteriori)

1. **Tokens d'ombre de panneau** (`--shadow-panel-resting`/`--shadow-panel-dragging`) : le design.md §3 exige "cadre et ombre propres à chaque panneau" mais ne fixe aucune valeur — le repo n'a AUCUNE échelle `--shadow-*` existante (seul `Canvas.css` a un `box-shadow` ponctuel pour le curseur pinceau, pas un token). Tranché : deux nouvelles valeurs ajoutées à `src/design/components.css` (Task 4), pas une valeur isolée dans le composant.
2. **Z-index du panneau flottant** : aucune valeur n'existait entre `--z-canvas-overlay` (10) et `--z-sticky` (20). Tranché : nouveau token `--z-floating-panel: 15` (Task 4).
3. **Valeur exacte de `SNAP_DISTANCE`/`KEYBOARD_NUDGE_STEP`** : le design.md dit explicitement "à calibrer à l'implémentation — commencer à ~12px"/"à calibrer — commencer à 16px". Tranché : valeurs de départ prises littéralement (12px, 16px/64px), exposées comme constantes exportées et testées pour rester facilement ajustables après le checkpoint visuel (Tasks 1-2) sans devoir rouvrir la logique.
4. **`DEFAULT_PANEL_COLUMN_WIDTH`** : le design.md dit "valeur à calibrer à l'implémentation" sans en proposer une. Tranché : réutilisation de `--inspector-width-default` (288px, déjà dans `src/design/components.css`) — le dock virtuel occupe visuellement la même largeur que l'ancien `Inspector` docké qu'il remplace, cohérence directe plutôt qu'une nouvelle valeur inventée.
5. **Mécanisme de compensation de centrage (Task 8)** : le design.md ne précise pas SI la compensation doit être un padding CSS statique ou un calcul JS piloté par `computeEffectiveViewportWidth`. Tranché : padding CSS pur pour ce plan (suffisant, "statique" par construction, zéro code JS réactif à maintenir) — la fonction JS pure (Task 3) reste disponible et testée pour le futur chantier pan/zoom qui, lui, aura besoin d'un calcul réactif à la taille de fenêtre réelle.
6. **Découpage `Inspector.css` en `LayerPanel.css`/`ParamPanel.css` (Task 9)** : le design.md ne mentionne pas ce détail de fichiers (hors de son scope, qui est le COMMENT du conteneur, pas l'organisation interne du CSS existant). Tranché en cohérence avec la convention déjà en place dans le repo (1 fichier CSS par composant : `BrushToolbar.css`, `Canvas.css`) plutôt que de laisser les styles de `LayerPanel`/`ParamPanel` orphelins dans un `Inspector.css` dont le composant hôte disparaît.
7. **Placement du split Task 5 (structure statique) / Task 6 (drag)** : le design.md décrit `FloatingPanel` comme un seul composant fini. Tranché : scindé en deux tâches pour respecter le principe "chaque tâche démontrable seule" du plan — Task 5 vérifie visuellement la structure/le repli avant d'ajouter la complexité du pointer-events drag en Task 6, réduisant la surface à déboguer si le checkpoint humain de Task 7 échoue.
