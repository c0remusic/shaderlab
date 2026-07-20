# Dock Reorder + Theme Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer trois chantiers validés en un seul plan : (1) une échelle d'ombres nommée + son application aux popovers manquants, (2) le ratio padding horizontal/vertical des boutons, (3) le drag-to-reorder des cartes du dock (Calques/Réglages), en réutilisant le pattern de réordonnancement déjà éprouvé de `LayerPanel`.

**Architecture:** Tâches 1-3 = corrections de tokens mécaniques (peu de fichiers, zéro nouvelle logique). Tâches 4-6 = extraction du pattern pointer-events de `LayerPanel.tsx` en utilitaire partagé (`src/ui/dragReorder.ts`), migration de `LayerPanel` dessus (comportement/visuel inchangés), puis extension de `PanelColumn`/`DockedPanelCard`/`App.tsx` pour consommer ce même utilitaire avec un fantôme + chip d'insertion (nouveau, n'existait pas dans `LayerPanel`).

**Tech Stack:** React 19 + TS, `react-resizable-panels` (déjà en place), Vitest, tokens CSS `src/design/*.css`.

## Global Constraints

- Aucun test de rendu React dans ce repo (convention existante) — seule la logique pure (`computeInsertIndex`, `reorderById`, calcul hit-test) se teste unitairement.
- `git commit -m "message" -- <fichiers>` pathspec explicite obligatoire, jamais un commit nu.
- Icônes = `lucide-react` uniquement. Boutons icône-seul = `IconButton` existant (déjà natif + `aria-label` + cible ≥44px).
- **Ombres** : `--shadow-dragging` (remplace `--shadow-panel-dragging`, actuellement inutilisée ailleurs — vérifié `git grep`) = `0 12px 16px rgba(0,0,0,.24), 0 6px 8px rgba(0,0,0,.12), 0 0 6px rgba(0,0,0,.48)` (valeurs Spectrum `drop-shadow-dragged` dark, sourcées). `--shadow-popover` (nouveau) = `0 4px 12px rgba(0,0,0,.24), 0 2px 6px rgba(0,0,0,.12), 0 0 2px rgba(0,0,0,.36)` (Spectrum `drop-shadow-elevated` dark). **`Dialog` (`src/ui/dialog.css:20`, `box-shadow: none`) est une décision délibérée existante — ne JAMAIS lui appliquer ces tokens.**
- **Padding boutons** : `.ui-button--compact` `padding-inline` `--space-3`(6px)→`--space-5`(12px) ; `--button-padding-inline` (consommé par `.ui-button--default`) `--space-4`(8px)→`--space-6`(16px). `IconButton`/`.ui-icon-button` non concernés (icône seule, carré, la règle de ratio ne s'applique qu'aux boutons texte).
- **Drag-to-reorder** : design doc validé `docs/superpowers/specs/2026-07-21-shaderlab-panel-drag-reorder-design.md` — poignée = toute la titlebar (hors chevron, `stopPropagation`), fantôme (clone visuel complet) + chip d'insertion (20×8px, plein, fond `--border-selection`, opacité 0.9, `box-shadow: 0 1px 3px rgba(8,7,6,.35)`, PAS de tiret intérieur — valeurs finales de la v5 du mockup), z-index `--z-popover` (40) pour fantôme et chip, taille de carte suit le SLOT (position) pas l'identité, `id`+`key` React stables par identité de carte sur les `Panel` de `react-resizable-panels`. Aucune alternative clavier au reorder (lacune héritée de `LayerPanel`, acceptée explicitement — voir design doc).
- **`react-resizable-panels` API réelle (v4.12.2)** : `Group`/`Panel`/`Separator` (pas `PanelGroup`/`PanelResizeHandle`), `orientation` pas `direction`, tailles en **string** = pourcentage (`"45"`, pas `45`).
- **Correction de scope apportée pendant l'écriture de ce plan** (incohérence du design doc corrigée ici) : `LayerPanel` garde son indicateur d'insertion ACTUEL (bordure colorée sur la ligne survolée, `layer-panel__row--drop-before/after`) — **pas de migration vers le chip flottant**. Le design doc suggérait une migration visuelle de `LayerPanel` vers le même chip "pour cohérence", mais Antoine n'a jamais demandé de changement visuel à la liste de calques ; seule la LOGIQUE (`computeInsertIndex`, machine à état pointer) est partagée via `src/ui/dragReorder.ts`, la présentation reste propre à chaque composant. Zéro régression visuelle sur `LayerPanel`.

---

## File Structure

**Créés :**
- `src/ui/dragReorder.ts` — logique pure + hook partagés (`computeInsertIndex`, `reorderById`, `usePointerReorder`).
- `test/ui/dragReorder.test.ts` — tests de la logique pure.

**Modifiés :**
- `src/design/components.css` — tokens d'ombre (Task 1), padding boutons (Task 3).
- `src/ui/actions.css` — application des paddings (Task 3), `.ui-tooltip` gagne l'ombre (Task 2).
- `src/ui/overlays.css` — `.ui-select__listbox` gagne l'ombre (Task 2).
- `src/components/ui/dropdown-menu.tsx` — remplace les classes Tailwind `shadow-md`/`shadow-lg` déconnectées des tokens par une classe liée à `--shadow-popover` (Task 2).
- `src/components/LayerPanel.tsx` — migre vers `src/ui/dragReorder.ts` (Task 4), comportement/visuel inchangés.
- `src/components/dockedPanel/PanelColumn.tsx` — refonte de l'interface (`panels: DockedPanelSpec[]` au lieu de props `layers*`/`params*` séparées), ajout du fantôme + chip (Task 5).
- `src/components/dockedPanel/PanelColumn.css` — styles fantôme/chip (Task 5).
- `src/components/dockedPanel/DockedPanelCard.tsx` — ajoute `reorderIndex`/`dragging`/`titlebarProps`, `stopPropagation` sur le chevron (Task 5).
- `src/App.tsx` — nouvel état `panelOrder`, construction du tableau `panels`, câblage `PanelColumn` (Task 6).

---

### Task 1 : Tokens d'ombre (échelle nommée)

**Files:**
- Modify: `src/design/components.css:47`

**Interfaces:**
- Consumes: rien.
- Produces: `--shadow-dragging`, `--shadow-popover` (tokens CSS), consommés par Task 2 et Task 5.

- [ ] **Step 1: Vérifier qu'aucun autre fichier ne consomme `--shadow-panel-dragging`**

Run: `git grep -n "shadow-panel-dragging"`
Expected: une seule occurrence, `src/design/components.css:47` (sa propre définition) — confirmé lors de l'analyse du 2026-07-21.

- [ ] **Step 2: Remplacer le token**

Dans `src/design/components.css`, remplacer la ligne 47 :

```css
  --shadow-panel-dragging: 0 6px 20px rgba(8, 7, 6, .44);
```

par :

```css
  --shadow-dragging: 0 12px 16px rgba(0, 0, 0, .24), 0 6px 8px rgba(0, 0, 0, .12), 0 0 6px rgba(0, 0, 0, .48);
  --shadow-popover: 0 4px 12px rgba(0, 0, 0, .24), 0 2px 6px rgba(0, 0, 0, .12), 0 0 2px rgba(0, 0, 0, .36);
```

- [ ] **Step 3: Vérifier le lint de tokens**

Run: `npm run lint:tokens`
Expected: aucune nouvelle violation.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add named shadow scale (--shadow-dragging, --shadow-popover)" -- src/design/components.css
```

---

### Task 2 : Appliquer les ombres aux popovers manquants

**Files:**
- Modify: `src/ui/actions.css` (`.ui-tooltip`, ~ligne 214-231)
- Modify: `src/ui/overlays.css` (`.ui-select__listbox`, ~ligne 68-83)
- Modify: `src/components/ui/dropdown-menu.tsx` (lignes ~42 et ~136)

**Interfaces:**
- Consumes: `--shadow-popover` (Task 1).
- Produces: rien de nouveau côté interface — changement de style pur.

- [ ] **Step 1: Ajouter l'ombre au Tooltip**

Dans `src/ui/actions.css`, trouver la règle `.ui-tooltip` (contient `border: 1px solid var(--border-default);`) et ajouter une ligne :

```css
.ui-tooltip {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-tooltip);
  max-width: var(--tooltip-max-width);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  border: 1px solid var(--border-default);
  background: var(--surface-raised);
  box-shadow: var(--shadow-popover);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-tight);
  white-space: nowrap;
  pointer-events: none;
}
```

(seule la ligne `box-shadow: var(--shadow-popover);` est ajoutée, le reste de la règle est inchangé — recopier la règle complète telle quelle avec cet ajout, pas de placeholder).

- [ ] **Step 2: Ajouter l'ombre à la listbox de Select**

Dans `src/ui/overlays.css`, trouver `.ui-select__listbox` et ajouter `box-shadow: var(--shadow-popover);` :

```css
.ui-select__listbox {
  position: fixed;
  z-index: var(--z-popover);
  max-height: 240px;
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  overflow-y: auto;
  border-radius: var(--radius-group);
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  box-shadow: var(--shadow-popover);
  outline: none;
}
```

- [ ] **Step 3: Remplacer les classes Tailwind d'ombre déconnectées dans DropdownMenu**

`src/components/ui/dropdown-menu.tsx` utilise les utilitaires Tailwind par défaut `shadow-md`/`shadow-lg` (non liés aux tokens du projet — vérifié : aucun mapping `--shadow-*` dans `src/design/tailwind-theme.css`). Remplacer par une classe locale liée au token.

D'abord, ajouter en haut de `src/components/ui/dropdown-menu.tsx` (après les imports existants, avant le premier composant) une constante de classe partagée :

```tsx
const POPOVER_SHADOW_CLASS = "shadow-[var(--shadow-popover)]";
```

Puis, à la ligne ~42 (à l'intérieur du template de classes du `MenuPrimitive.Popup` du menu racine), remplacer `shadow-md` par `${POPOVER_SHADOW_CLASS}` dans le template literal `cn(...)` — chercher `shadow-md ring-1` dans le fichier et remplacer `shadow-md` par la valeur littérale `shadow-[var(--shadow-popover)]` directement dans la chaîne (pas besoin d'interpolation de variable JS si c'est plus simple d'éditer la chaîne en dur à cet endroit) :

Avant :
```
"z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 ..."
```

Après (remplacer uniquement `shadow-md` par `shadow-[var(--shadow-popover)]`, garder tout le reste identique) :
```
"z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-[var(--shadow-popover)] ring-1 ring-foreground/10 ..."
```

Faire le même remplacement à la ligne ~136 (`shadow-lg` → `shadow-[var(--shadow-popover)]`, sous-menu) :

Avant :
```
"w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 ..."
```

Après :
```
"w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-[var(--shadow-popover)] ring-1 ring-foreground/10 ..."
```

Retirer la constante `POPOVER_SHADOW_CLASS` ajoutée plus haut si elle n'est finalement pas utilisée (l'édition en dur dans les deux templates suffit — ne pas laisser une constante inutilisée).

- [ ] **Step 4: Vérifier visuellement qu'aucune règle `Dialog` n'a été touchée**

Run: `git grep -n "shadow" src/ui/dialog.css`
Expected: `box-shadow: none;` toujours présent, ligne inchangée par ce plan.

- [ ] **Step 5: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit && npm run lint:tokens`
Expected: 0 erreur, 0 nouvelle violation.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: apply --shadow-popover to Tooltip, Select listbox, DropdownMenu" -- src/ui/actions.css src/ui/overlays.css src/components/ui/dropdown-menu.tsx
```

---

### Task 3 : Ratio padding horizontal/vertical des boutons

**Files:**
- Modify: `src/design/components.css:34` (`--button-padding-inline`)
- Modify: `src/ui/actions.css:71-75` (`.ui-button--compact`)

**Interfaces:**
- Consumes: rien.
- Produces: rien — changement de valeur de token + une règle CSS.

- [ ] **Step 1: Changer le token `--button-padding-inline`**

Dans `src/design/components.css`, ligne 34, remplacer :

```css
  --button-padding-inline: var(--space-4);
```

par :

```css
  --button-padding-inline: var(--space-6);
```

- [ ] **Step 2: Changer le padding de `.ui-button--compact`**

Dans `src/ui/actions.css`, remplacer :

```css
.ui-button--compact {
  height: var(--control-height-sm);
  padding-inline: var(--space-3);
  font-size: var(--font-size-sm);
}
```

par :

```css
.ui-button--compact {
  height: var(--control-height-sm);
  padding-inline: var(--space-5);
  font-size: var(--font-size-sm);
}
```

- [ ] **Step 3: Vérifier visuellement que `Toolbar`/`BrushToolbar` (déjà migrés vers `ui-button`) ne débordent pas**

Run: `npx tsc --noEmit` (vérification statique — le checkpoint visuel réel est en Task 7).

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(ui): bump button horizontal padding to meet the 2-3x h/v ratio rule" -- src/design/components.css src/ui/actions.css
```

---

### Task 4 : Extraire `src/ui/dragReorder.ts` (logique pure + hook)

**Files:**
- Create: `src/ui/dragReorder.ts`
- Test: `test/ui/dragReorder.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `export type DropPosition = "before" | "after"`
  - `export function computeInsertIndex(fromIndex: number, hoverIndex: number, position: DropPosition): number`
  - `export function reorderById<T>(items: T[], getId: (item: T) => string, id: string, newIndex: number): T[]`
  - `export interface DragReorderState { draggedId: string; pointerId: number; grabOffset: { x: number; y: number }; pointerPosition: { x: number; y: number }; overIndex: number | null; overPosition: DropPosition | null; }`
  - `export function usePointerReorder<T>(items: T[], getId: (item: T) => string, indexAttribute: string, onReorder: (id: string, newIndex: number) => void): { dragState: DragReorderState | null; handlePointerDown: (id: string, pointerId: number, captureTarget: Element, measureElement: Element, clientX: number, clientY: number) => void; handlePointerMove: (e: React.PointerEvent) => void; handlePointerUp: (e: React.PointerEvent) => void; handlePointerCancel: (e: React.PointerEvent) => void; }`
  - Consommé par Task 5 (migration `LayerPanel`) et Task 6 (`PanelColumn`).

- [ ] **Step 1: Écrire les tests de `computeInsertIndex` (recopiés tels quels depuis le comportement déjà validé de `LayerPanel`)**

```ts
import { describe, it, expect } from "vitest";
import { computeInsertIndex, reorderById } from "../../src/ui/dragReorder";

describe("computeInsertIndex", () => {
  it("avant un index après soi -> décale d'un cran vers le bas", () => {
    expect(computeInsertIndex(0, 2, "before")).toBe(1);
  });
  it("après un index après soi -> décale de deux crans vers le bas", () => {
    expect(computeInsertIndex(0, 2, "after")).toBe(2);
  });
  it("avant son voisin immédiat suivant -> no-op (retourne fromIndex)", () => {
    expect(computeInsertIndex(0, 1, "before")).toBe(0);
  });
  it("après son voisin immédiat précédent -> no-op (retourne fromIndex)", () => {
    expect(computeInsertIndex(2, 1, "after")).toBe(2);
  });
  it("déplacement vers le haut, avant une ligne antérieure", () => {
    expect(computeInsertIndex(3, 1, "before")).toBe(1);
  });
});

describe("reorderById", () => {
  const items = ["a", "b", "c", "d"];
  const getId = (x: string) => x;

  it("déplace un élément vers une position ultérieure", () => {
    expect(reorderById(items, getId, "a", 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("déplace un élément vers une position antérieure", () => {
    expect(reorderById(items, getId, "d", 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("id introuvable -> retourne le tableau inchangé (référence égale non garantie, mais mêmes éléments)", () => {
    expect(reorderById(items, getId, "z", 1)).toEqual(items);
  });
});
```

- [ ] **Step 2: Run pour vérifier l'échec (module n'existe pas encore)**

Run: `npm run test -- dragReorder`
Expected: FAIL — `Cannot find module '../../src/ui/dragReorder'`

- [ ] **Step 3: Écrire `src/ui/dragReorder.ts`**

```ts
import { useCallback, useState } from "react";

/**
 * Réordonnancement générique par pointer events, PAS le DnD HTML5 natif —
 * extrait de LayerPanel.tsx (2026-07-21). dragover/drop ne sont JAMAIS
 * relayés par WebView2 au contenu web (preuve CDP sur un geste humain réel,
 * bug d'intégration confirmé, pas une erreur de câblage React) — les pointer
 * events fonctionnent déjà pour le pinceau et le pan/zoom de ce projet.
 */
export type DropPosition = "before" | "after";

export interface DragReorderState {
  draggedId: string;
  pointerId: number;
  /** Décalage curseur -> coin haut-gauche de l'élément déplacé au pointerdown
   *  (pour qu'un fantôme éventuel suive le curseur sans "sauter" au premier
   *  mouvement) — non consommé par LayerPanel (pas de fantôme), consommé par
   *  PanelColumn. */
  grabOffset: { x: number; y: number };
  /** Position courante du curseur (coordonnées écran) — mise à jour à chaque
   *  pointermove, pour un fantôme éventuel. */
  pointerPosition: { x: number; y: number };
  overIndex: number | null;
  overPosition: DropPosition | null;
}

/**
 * Traduit "poser AVANT/APRÈS la ligne `hoverIndex`" (ce que l'utilisateur
 * voit et choisit) en `newIndex` pour un tableau dont la sémantique de
 * réordonnancement est "retire `fromIndex`, puis insère à `newIndex` DANS LE
 * TABLEAU DÉJÀ AMPUTÉ" — pas la même chose qu'un index dans le tableau
 * d'origine. Sans cette traduction, "avant B" peut visuellement finir
 * "après B" selon le sens du geste.
 */
export function computeInsertIndex(fromIndex: number, hoverIndex: number, position: DropPosition): number {
  const hoverIndexAfterRemoval = hoverIndex - (fromIndex < hoverIndex ? 1 : 0);
  return position === "before" ? hoverIndexAfterRemoval : hoverIndexAfterRemoval + 1;
}

/**
 * Déplace l'élément identifié par `id` à la position `newIndex` (sémantique
 * "retire puis insère dans le tableau amputé", cf. computeInsertIndex).
 * Si `id` est introuvable, retourne le tableau d'origine inchangé.
 */
export function reorderById<T>(items: T[], getId: (item: T) => string, id: string, newIndex: number): T[] {
  const fromIndex = items.findIndex((item) => getId(item) === id);
  if (fromIndex === -1) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}

/**
 * Hook générique de réordonnancement par glisser-déposer (pointer events).
 * `indexAttribute` est le nom de l'attribut `data-*` (sans les crochets)
 * posé sur chaque élément réordonnable, utilisé pour le hit-test manuel via
 * `elementFromPoint` (aucun événement natif de survol/drop n'est exploité).
 */
export function usePointerReorder<T>(
  items: T[],
  getId: (item: T) => string,
  indexAttribute: string,
  onReorder: (id: string, newIndex: number) => void
) {
  const [dragState, setDragState] = useState<DragReorderState | null>(null);

  const handlePointerDown = useCallback(
    (id: string, pointerId: number, captureTarget: Element, measureElement: Element, clientX: number, clientY: number) => {
      // Ignore un 2e pointeur tant qu'un drag est déjà en cours — sinon il
      // écraserait dragState et le drag du 1er pointeur serait silencieusement
      // perdu.
      setDragState((prev) => {
        if (prev) return prev;
        captureTarget.setPointerCapture(pointerId);
        const rect = measureElement.getBoundingClientRect();
        return {
          draggedId: id,
          pointerId,
          grabOffset: { x: clientX - rect.left, y: clientY - rect.top },
          pointerPosition: { x: clientX, y: clientY },
          overIndex: null,
          overPosition: null,
        };
      });
    },
    []
  );

  // Continue de recevoir les événements même quand le pointeur sort de son
  // rectangle grâce à setPointerCapture ci-dessus — elementFromPoint fait le
  // hit-test manuel sur l'élément survolé. La moitié haute/basse décide
  // avant/après.
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      setDragState((prev) => {
        if (!prev || e.pointerId !== prev.pointerId) return prev;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const rowEl = el?.closest<HTMLElement>(`[${indexAttribute}]`);
        const pointerPosition = { x: e.clientX, y: e.clientY };
        if (!rowEl) {
          return prev.overIndex === null && prev.pointerPosition.x === pointerPosition.x && prev.pointerPosition.y === pointerPosition.y
            ? prev
            : { ...prev, overIndex: null, overPosition: null, pointerPosition };
        }
        const overIndex = Number(rowEl.getAttribute(indexAttribute));
        const rect = rowEl.getBoundingClientRect();
        const overPosition: DropPosition = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        return { ...prev, overIndex, overPosition, pointerPosition };
      });
    },
    [indexAttribute]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setDragState((prev) => {
        if (!prev || e.pointerId !== prev.pointerId) return prev;
        if (prev.overIndex !== null && prev.overPosition !== null) {
          const fromIndex = items.findIndex((item) => getId(item) === prev.draggedId);
          if (fromIndex !== -1 && fromIndex !== prev.overIndex) {
            const newIndex = computeInsertIndex(fromIndex, prev.overIndex, prev.overPosition);
            // Déposer "avant" son voisin immédiat suivant (ou "après" son
            // voisin immédiat précédent) ne change rien à l'ordre final —
            // computeInsertIndex peut renvoyer fromIndex dans ce cas.
            if (newIndex !== fromIndex) onReorder(prev.draggedId, newIndex);
          }
        }
        return null;
      });
    },
    [items, getId, onReorder]
  );

  // pointercancel (perte de capture, interruption tactile...) N'EST PAS un
  // dépôt valide — annule le drag sans réordonner, contrairement à pointerup.
  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    setDragState((prev) => (prev && e.pointerId === prev.pointerId ? null : prev));
  }, []);

  return { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel };
}
```

- [ ] **Step 4: Run pour vérifier que les tests passent**

Run: `npm run test -- dragReorder`
Expected: PASS (8/8 tests : 5 `computeInsertIndex` + 3 `reorderById`)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): extract pointer-based drag-reorder into shared src/ui/dragReorder.ts" -- src/ui/dragReorder.ts test/ui/dragReorder.test.ts
```

---

### Task 5 : Migrer `LayerPanel` vers `dragReorder.ts` (comportement/visuel inchangés)

**Files:**
- Modify: `src/components/LayerPanel.tsx`

**Interfaces:**
- Consumes: `computeInsertIndex`, `usePointerReorder`, `DropPosition` de `src/ui/dragReorder.ts` (Task 4).
- Produces: rien de nouveau — `LayerPanel` garde exactement le même comportement observable (visuel, props, callbacks).

- [ ] **Step 1: Retirer `computeInsertIndex` et la logique de state locale, migrer vers le hook**

Dans `src/components/LayerPanel.tsx`, remplacer les imports (ligne 1) :

```tsx
import { memo, useCallback, useState } from "react";
```

par :

```tsx
import { memo } from "react";
import { usePointerReorder, type DropPosition } from "../ui/dragReorder";
```

Retirer la définition locale `type DropPosition = "before" | "after";` (ligne 24 actuelle — désormais importée).

Retirer entièrement le bloc `interface DragState { ... }` et la fonction `export function computeInsertIndex(...)` (lignes 150-169 actuelles) — ces deux éléments vivent maintenant dans `src/ui/dragReorder.ts`. `computeInsertIndex` n'a plus besoin d'être ré-exporté depuis `LayerPanel.tsx` : vérifier qu'aucun autre fichier ne l'importe depuis ce chemin avant de le retirer (`git grep -n "from \"../components/LayerPanel\"" test/` ou équivalent — si le test existant l'importe de là, le migrer vers `src/ui/dragReorder` à ce Step, voir Step 2 ci-dessous).

- [ ] **Step 2: Vérifier et migrer le test existant de `computeInsertIndex`**

Run: `git grep -rn "computeInsertIndex" test/`

S'il existe un test qui importe `computeInsertIndex` depuis `../../src/components/LayerPanel`, changer son import pour `../../src/ui/dragReorder` (le comportement testé est identique, seule la localisation du module change). Si ce test fait doublon strict avec les tests déjà écrits en Task 4 Step 1, le supprimer plutôt que le dupliquer (DRY) — mais vérifier d'abord qu'aucun cas particulier propre à `LayerPanel` n'y est testé avant de le retirer.

- [ ] **Step 3: Remplacer le corps de `LayerPanel` pour utiliser le hook**

`handleGripPointerDown` change de signature : l'ancien code recevait `(id, pointerId, target)` depuis `onPointerDown={(e) => { e.stopPropagation(); onGripPointerDown(layer.id, e.pointerId, e.currentTarget); }}` (`LayerRow`, ligne ~84). Le hook `usePointerReorder.handlePointerDown` (Task 4) attend `(id, pointerId, captureTarget, measureElement, clientX, clientY)`. `LayerPanel` n'a pas besoin du fantôme (`grabOffset`/`pointerPosition` non consommés visuellement ici) mais doit quand même fournir `clientX`/`clientY` pour respecter la signature partagée du hook — `LayerRow` doit donc transmettre l'événement complet, pas juste `target`.

D'abord, dans `LayerRow` (le composant mémoïsé), la prop `onGripPointerDown` change de signature — remplacer :

```tsx
interface LayerRowProps {
  // ...
  onGripPointerDown: (id: string, pointerId: number, target: Element) => void;
  // ...
}
```

par :

```tsx
interface LayerRowProps {
  // ...
  onGripPointerDown: (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => void;
  // ...
}
```

Et son usage dans le JSX de `LayerRow` :

```tsx
<span
  className="layer-panel__grip-handle"
  onPointerDown={(e) => {
    e.stopPropagation();
    onGripPointerDown(layer.id, e.pointerId, e.currentTarget, e.clientX, e.clientY);
  }}
  onClick={(e) => e.stopPropagation()}
>
```

Puis, dans `LayerPanel`, le wrapper devient :

```tsx
export function LayerPanel({
  layers,
  selectedId,
  onSelect,
  onToggle,
  onAdd,
  onRemove,
  onReorder,
  onOpacityChange,
  onOpacityCommit,
  onBlendModeChange,
}: Props) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(
    layers,
    (layer) => layer.id,
    "data-layer-row-index",
    onReorder
  );

  const handleGripPointerDown = (id: string, pointerId: number, target: Element, clientX: number, clientY: number) => {
    // measureElement = target : LayerPanel n'utilise pas grabOffset/pointerPosition
    // (pas de fantôme), measurer la poignée elle-même suffit.
    handlePointerDown(id, pointerId, target, target, clientX, clientY);
  };

  return (
    <div className="layer-panel">
      <Select
        label="Ajouter un effet"
        value={null}
        placeholder="+ Ajouter un effet"
        options={addEffectOptions}
        onChange={onAdd}
      />
      <ul
        className="layer-panel__list"
        onPointerMove={dragState ? handlePointerMove : undefined}
        onPointerUp={dragState ? handlePointerUp : undefined}
        onPointerCancel={dragState ? handlePointerCancel : undefined}
      >
        {layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            selected={layer.id === selectedId}
            isDragging={dragState?.draggedId === layer.id}
            dropPosition={
              dragState !== null && dragState.overIndex === index && dragState.draggedId !== layer.id
                ? dragState.overPosition
                : null
            }
            onSelect={onSelect}
            onToggle={onToggle}
            onRemove={onRemove}
            onGripPointerDown={handleGripPointerDown}
            onOpacityChange={onOpacityChange}
            onOpacityCommit={onOpacityCommit}
            onBlendModeChange={onBlendModeChange}
          />
        ))}
      </ul>
    </div>
  );
}
```

Le reste du fichier (`LayerRow`, `addEffectOptions`, `blendModeOptions`, `Props`, `LayerRowProps` sauf le changement de signature ci-dessus) reste identique.

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Lancer la suite de tests**

Run: `npm run test`
Expected: tous les tests passent (y compris ceux migrés au Step 2).

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: migrate LayerPanel to shared usePointerReorder hook (no behavior change)" -- src/components/LayerPanel.tsx test/
```

---

### Task 6 : Drag-to-reorder dans `PanelColumn` (fantôme + chip)

**Files:**
- Modify: `src/components/dockedPanel/DockedPanelCard.tsx`
- Modify: `src/components/dockedPanel/PanelColumn.tsx`
- Modify: `src/components/dockedPanel/PanelColumn.css`

**Interfaces:**
- Consumes: `usePointerReorder`, `reorderById` de `src/ui/dragReorder.ts` (Task 4).
- Produces: `export interface DockedPanelSpec { id: string; title: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; content: React.ReactNode }` et `export interface PanelColumnProps { panels: DockedPanelSpec[]; onReorder: (id: string, newIndex: number) => void }` — remplace l'ancienne interface `PanelColumnProps` (props `layers*`/`params*` séparées) — consommé par Task 7 (`App.tsx`).

- [ ] **Step 1: Étendre `DockedPanelCard` pour porter les handlers de drag et l'attribut de hit-test**

Remplacer entièrement `src/components/dockedPanel/DockedPanelCard.tsx` par :

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import "./DockedPanelCard.css";

export interface DockedPanelCardProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  className?: string;
  /** Index de la carte dans la colonne — posé en `data-reorder-index` pour
   *  le hit-test du drag (voir src/ui/dragReorder.ts). */
  reorderIndex: number;
  /** Vrai pendant que CETTE carte est celle en cours de déplacement —
   *  pilote l'estompage (voir DockedPanelCard.css). */
  dragging?: boolean;
  /** Handlers de drag à poser sur la titlebar (poignée = toute la barre) —
   *  fournis par PanelColumn, qui possède le hook usePointerReorder. */
  titlebarProps?: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * Carte de panneau dockée, fixe (pas de drag LIBRE, pas de magnétisme) —
 * remplace `FloatingPanel`. Position/taille sont pilotées par le parent
 * (`PanelColumn`, via `react-resizable-panels`) ; l'ORDRE des cartes, lui,
 * est réordonnable par glisser-déposer de la titlebar (2026-07-21) — voir
 * `docs/superpowers/specs/2026-07-21-shaderlab-panel-drag-reorder-design.md`.
 */
export function DockedPanelCard({
  title,
  collapsed,
  onCollapsedChange,
  children,
  className = "",
  reorderIndex,
  dragging = false,
  titlebarProps,
}: DockedPanelCardProps) {
  return (
    <div
      className={`docked-panel-card ${dragging ? "docked-panel-card--dragging" : ""} ${className}`.trim()}
      data-reorder-index={reorderIndex}
    >
      <div className="docked-panel-card__titlebar" {...titlebarProps}>
        <span className="docked-panel-card__title">{title}</span>
        <IconButton
          label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
          size="compact"
          // stopPropagation : la titlebar entière est maintenant la poignée
          // de drag (onPointerDown vient de titlebarProps) — sans ça, un
          // clic sur le chevron démarrerait aussi un drag (même finding que
          // l'ancien FloatingPanel.tsx pour ce même bouton).
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCollapsedChange(!collapsed);
          }}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </IconButton>
      </div>
      {!collapsed && <div className="docked-panel-card__content">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Ajouter le style `--dragging` (estompage) à `DockedPanelCard.css`**

Ajouter à la fin de `src/components/dockedPanel/DockedPanelCard.css` :

```css
/* Pendant le drag : la carte d'origine reste visible mais estompée (même
   principe que .layer-panel__row--dragging et l'ancien
   .floating-panel--origin-dimmed) — 0.5 littéral et ponctuel, aucun token
   "élément en cours de glisser" n'existe, un seul usage ne justifie pas
   d'en créer un. */
.docked-panel-card--dragging {
  opacity: 0.5;
}
```

- [ ] **Step 3: Réécrire `PanelColumn.tsx` avec le hook, le fantôme et le chip**

Remplacer entièrement `src/components/dockedPanel/PanelColumn.tsx` par :

```tsx
import { Fragment } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { DockedPanelCard } from "./DockedPanelCard";
import { usePointerReorder } from "../../ui/dragReorder";
import "./PanelColumn.css";

export interface DockedPanelSpec {
  id: string;
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  content: React.ReactNode;
}

export interface PanelColumnProps {
  /** Déjà dans l'ordre d'affichage voulu — App.tsx trie selon `panelOrder`. */
  panels: DockedPanelSpec[];
  onReorder: (id: string, newIndex: number) => void;
}

// Taille par SLOT (position), pas par identité de carte — décision actée au
// design (2026-07-21) : après un reorder, la carte en position 0 hérite de
// 45%, celle en position 1 de 55%. Limité à 2 slots aujourd'hui (Calques/
// Réglages) ; un 3e panneau (Masques, Tranche 4 du chantier calques/masquage,
// pas encore implémenté) devra revisiter cette répartition — YAGNI délibéré,
// pas un oubli.
const SLOT_SIZES = [
  { defaultSize: "45", minSize: "20", maxSize: "80" },
  { defaultSize: "55", minSize: "20", maxSize: "80" },
];

/**
 * Colonne dockée fixe à droite (Calques + Réglages), position posée UNE fois
 * en CSS (PanelColumn.css). `react-resizable-panels` répartit la hauteur
 * totale disponible entre les cartes (splitter, Task 4 du plan
 * docked-panels) ; l'ORDRE des cartes est réordonnable par glisser-déposer
 * de leur titlebar (2026-07-21, usePointerReorder partagé avec LayerPanel).
 *
 * `id` React stable PAR IDENTITÉ DE CARTE (pas par position) sur chaque
 * `Panel`, pour que la persistance de layout interne du package
 * (`react-resizable-panels.d.ts` s'appuie sur un `id` de `Panel`) reste
 * cohérente. La `key` React, elle, inclut le SLOT (`${panel.id}-${index}`,
 * pas juste `panel.id`) — volontairement DIFFÉRENTE de `id` : le comportement
 * de `defaultSize` sur un `Panel` déjà monté qui change de position n'est
 * PAS vérifié sur pièce (la plupart des librairies de ce type ignorent un
 * `defaultSize` modifié après le montage initial, ne gardant que la taille
 * committée en interne). Plutôt que parier sur un comportement non confirmé,
 * la `key` par slot force React à DÉMONTER/REMONTER le `Panel` à chaque
 * changement de slot — `defaultSize` est alors garanti appliqué frais,
 * cohérent avec la décision "la taille suit le slot, pas la carte".
 */
export function PanelColumn({ panels, onReorder }: PanelColumnProps) {
  const { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } = usePointerReorder(
    panels,
    (panel) => panel.id,
    "data-reorder-index",
    onReorder
  );

  const draggedPanel = dragState ? panels.find((p) => p.id === dragState.draggedId) : null;

  // Position du chip d'insertion : mesure le DOM de la carte survolée
  // (dragState.overIndex) — présentation pure, hors du hook partagé.
  let chipTop: number | null = null;
  if (dragState && dragState.overIndex !== null && dragState.overPosition !== null) {
    const overEl = document.querySelector<HTMLElement>(`[data-reorder-index="${dragState.overIndex}"]`);
    const columnEl = document.querySelector<HTMLElement>(".panel-column");
    if (overEl && columnEl) {
      const rect = overEl.getBoundingClientRect();
      const columnRect = columnEl.getBoundingClientRect();
      chipTop = (dragState.overPosition === "before" ? rect.top : rect.bottom) - columnRect.top;
    }
  }

  return (
    <div
      className="panel-column"
      onPointerMove={dragState ? handlePointerMove : undefined}
      onPointerUp={dragState ? handlePointerUp : undefined}
      onPointerCancel={dragState ? handlePointerCancel : undefined}
    >
      <Group orientation="vertical" className="panel-column__group">
        {panels.map((panel, index) => {
          const slot = SLOT_SIZES[index] ?? SLOT_SIZES[SLOT_SIZES.length - 1];
          return (
            // key inclut l'index de slot (pas juste panel.id) — voir le
            // commentaire de fonction ci-dessus sur pourquoi key != id ici.
            <Fragment key={`${panel.id}-${index}`}>
              {index > 0 && <Separator className="panel-column__handle" aria-label="Redimensionner les panneaux" />}
              <Panel
                id={panel.id}
                defaultSize={slot.defaultSize}
                minSize={slot.minSize}
                maxSize={slot.maxSize}
                className="panel-column__pane"
              >
                <DockedPanelCard
                  title={panel.title}
                  collapsed={panel.collapsed}
                  onCollapsedChange={panel.onCollapsedChange}
                  reorderIndex={index}
                  dragging={dragState?.draggedId === panel.id}
                  titlebarProps={{
                    onPointerDown: (e) => {
                      const cardEl = e.currentTarget.closest<HTMLElement>(".docked-panel-card");
                      if (cardEl) handlePointerDown(panel.id, e.pointerId, e.currentTarget, cardEl, e.clientX, e.clientY);
                    },
                  }}
                >
                  {panel.content}
                </DockedPanelCard>
              </Panel>
            </Fragment>
          );
        })}
      </Group>

      {dragState && chipTop !== null && (
        <div className="panel-column__insert-chip panel-column__insert-chip--visible" style={{ top: chipTop }} aria-hidden="true" />
      )}

      {dragState && draggedPanel && (
        <div
          className="panel-column__ghost"
          style={{
            transform: `translate(${dragState.pointerPosition.x - dragState.grabOffset.x}px, ${dragState.pointerPosition.y - dragState.grabOffset.y}px)`,
          }}
          aria-hidden="true"
        >
          <div className="docked-panel-card">
            <div className="docked-panel-card__titlebar">
              <span className="docked-panel-card__title">{draggedPanel.title}</span>
            </div>
            {/* Miroir fidèle titre + contenu (pas seulement l'en-tête) — un
                premier essai qui ne clonait que la titlebar a été jugé
                insuffisant lors du mockup de brainstorming (v1), corrigé en
                v2 (voir design doc § Mockup). */}
            {!draggedPanel.collapsed && (
              <div className="docked-panel-card__content">{draggedPanel.content}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ajouter les styles du fantôme et du chip à `PanelColumn.css`**

Ajouter à la fin de `src/components/dockedPanel/PanelColumn.css` :

```css
/* Chip d'insertion (2026-07-21, remplace une barre pleine largeur — esprit
   Photoshop web) : petit ovale plein, pas de tiret intérieur, centré sur la
   couture entre deux cartes. Valeurs validées sur mockup interactif (v5). */
.panel-column__insert-chip {
  position: absolute;
  left: 50%;
  height: 8px;
  width: 20px;
  background: var(--border-selection);
  border-radius: 999px;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.85);
  transition: top 80ms var(--ease-standard), opacity 100ms var(--ease-standard), transform 100ms var(--ease-standard);
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(8, 7, 6, .35);
  z-index: var(--z-popover);
}

.panel-column__insert-chip--visible {
  opacity: 0.9;
  transform: translate(-50%, -50%) scale(1);
}

/* Fantôme : miroir visuel de la carte en cours de déplacement, suit le
   curseur via transform (jamais top/left, pour rester fluide à la fréquence
   pointermove) — même technique que l'ancien FloatingPanel (composant
   supprimé, technique réécrite ici, pas restaurée). */
.panel-column__ghost {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--inspector-width-default);
  opacity: 0.85;
  pointer-events: none;
  box-shadow: var(--shadow-dragging);
  z-index: var(--z-popover);
}
```

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: 0 erreur (des erreurs sont attendues à ce stade sur `App.tsx`, qui consomme encore l'ancienne interface `PanelColumnProps` — corrigées en Task 7 ; si `tsc` échoue UNIQUEMENT sur `App.tsx`, c'est attendu et normal à ce stade, ne pas chercher à le corriger ici).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add drag-to-reorder (ghost + insert chip) to PanelColumn" -- src/components/dockedPanel/DockedPanelCard.tsx src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css
```

---

### Task 7 : Câbler `App.tsx` sur la nouvelle interface `PanelColumn`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `PanelColumnProps`/`DockedPanelSpec` (Task 6), `reorderById` (Task 4).
- Produces: nouvel état `panelOrder: string[]` dans `App.tsx`.

- [ ] **Step 1: Ajouter l'état d'ordre et l'import de `reorderById`**

Dans `src/App.tsx`, ajouter à l'import existant de `react` rien de nouveau, mais ajouter une nouvelle ligne d'import après celle de `PanelColumn` :

```tsx
import { reorderById } from "./ui/dragReorder";
```

Remplacer (lignes 59-60 actuelles) :

```tsx
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
```

par :

```tsx
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  // Ordre d'affichage des cartes du dock — disposition d'interface, pas une
  // donnée de calque : pas d'entrée d'historique (undo/redo) sur ce state,
  // même principe que layersCollapsed/paramsCollapsed ci-dessus.
  const [panelOrder, setPanelOrder] = useState<string[]>(["layers", "params"]);
  const handlePanelReorder = useCallback((id: string, newIndex: number) => {
    setPanelOrder((prev) => reorderById(prev, (panelId) => panelId, id, newIndex));
  }, []);
```

- [ ] **Step 2: Remplacer le rendu `PanelColumn`**

Remplacer (le bloc JSX `<PanelColumn ...>` actuel, lignes 476-516) par :

```tsx
        <PanelColumn
          panels={panelOrder.map((id) =>
            id === "layers"
              ? {
                  id: "layers",
                  title: "Calques",
                  collapsed: layersCollapsed,
                  onCollapsedChange: setLayersCollapsed,
                  content: (
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
                  ),
                }
              : {
                  id: "params",
                  title: paramsPanelTitle,
                  collapsed: paramsCollapsed,
                  onCollapsedChange: setParamsCollapsed,
                  content: (
                    <ParamPanel
                      layer={selectedLayer}
                      onParamChange={handleParamChange}
                      onParamCommit={handleParamCommit}
                      maskPaintMode={maskPaintMode}
                      onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
                      onAddMaskSource={handleAddMaskSource}
                      onRemoveMaskSource={handleRemoveMaskSource}
                      onMaskSourceParamsChange={handleMaskSourceParamsChange}
                      onMaskSourceParamsCommit={handleParamCommit}
                      onMaskSourceCombineModeChange={handleMaskSourceCombineModeChange}
                      onMaskInvertChange={handleMaskInvertChange}
                      onMaskEnabledChange={handleMaskEnabledChange}
                      onRefineEdgeChange={handleRefineEdgeChange}
                      onRefineEdgeCommit={handleParamCommit}
                      onAddColorSample={handleAddColorSample}
                    />
                  ),
                }
          )}
          onReorder={handlePanelReorder}
        />
```

- [ ] **Step 3: Vérifier la compilation, les tests et le build**

Run: `npx tsc --noEmit && npm run test && npm run build`
Expected: 0 erreur, tous les tests verts, build Vite réussi.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: wire panelOrder state and drag-to-reorder callback in App.tsx" -- src/App.tsx
```

---

### Task 8 : Checkpoint visuel humain (couvre les 3 chantiers)

**Files:**
- Aucun — vérification uniquement.

**Interfaces:**
- Consumes: build complet des Tasks 1-7.
- Produces: confirmation visuelle humaine (obligatoire, Playwright headless inadapté sur ce projet — canvas WebGPU réel).

- [ ] **Step 1: Lancer l'app en mode debug**

Run: `npm run dev:debug` puis `npm run dev:monitor` (confirmer démarrage sans erreur).

- [ ] **Step 2: Checkpoint visuel humain — points à confirmer avec Antoine**

**Ombres/boutons (Tasks 1-3) :**
1. Tooltip (survol d'un bouton) : ombre douce visible autour de la bulle.
2. Menu déroulant (Select "Fusion"/"Ajouter un effet", DropdownMenu du menu Fichier) : ombre visible, cohérente entre les deux.
3. Dialog (si un existe dans le flux courant) : toujours SANS ombre (vérifier que rien n'a changé ici).
4. Boutons de la Toolbar : espacement horizontal visiblement plus généreux qu'avant, sans avoir l'air disproportionné.

**Drag-to-reorder (Tasks 4-7) :**
5. Glisser la titlebar "Calques" vers le bas : un fantôme (titre + contenu) suit le curseur, un petit chip ovale apparaît à la couture avec Réglages.
6. Relâcher : les cartes échangent leur ordre ; la carte maintenant en position 1 a la taille du slot 1 (55%), pas celle qu'elle avait avant le reorder.
7. Cliquer le chevron replier/déplier d'une carte pendant qu'aucun drag n'est en cours : ne déclenche PAS de drag (pas de fantôme qui apparaît).
8. Le splitter de redimensionnement entre les deux cartes fonctionne toujours normalement après un reorder.
9. `LayerPanel` (liste de calques) : réordonnancement des calques par glisser-déposer toujours identique à avant (indicateur de bordure, pas de fantôme) — zéro régression visuelle.

- [ ] **Step 3: Si un point échoue, corriger et relancer ce Step 2 avant de continuer**

Ne pas commit tant que les 9 points ne sont pas confirmés par Antoine.

- [ ] **Step 4: Commit final de clôture**

```bash
git commit -m "docs: confirm visual checkpoint for dock reorder + theme polish" --allow-empty
```

(commit vide intentionnel — uniquement pour marquer la confirmation dans l'historique si aucun fichier n'a été modifié à ce stade ; si des corrections ont eu lieu au Step 3, les committer normalement avec pathspec à la place de ce commit vide).

---

## Self-Review (effectuée par l'auteur du plan)

**Couverture des 3 chantiers :**
- Échelle d'ombres nommée + application : Tasks 1-2.
- Ratio padding boutons : Task 3.
- Drag-to-reorder (design doc du 2026-07-21) : Tasks 4-7. Chaque décision du design doc a une tâche : extraction pattern (Task 4), migration LayerPanel sans régression visuelle (Task 5), fantôme+chip+`id`/`key` stables+taille-par-slot (Task 6), câblage App.tsx (Task 7).
- A11y clavier du reorder : explicitement PAS traité (lacune héritée acceptée, documentée dans les Global Constraints — cohérent avec le design doc).
- Checkpoint visuel humain : Task 8, couvre les 9 points issus des 3 chantiers.

**Incohérence trouvée et corrigée pendant l'écriture de ce plan** (pas dans le design doc initial) : le design doc suggérait de migrer aussi `LayerPanel` vers le chip flottant "pour cohérence visuelle" — corrigé ici en gardant `LayerPanel` visuellement inchangé (Antoine n'a demandé ce changement que pour le dock), seule la logique pointer/computeInsertIndex est partagée. Noté explicitement dans les Global Constraints pour qu'un futur lecteur du design doc ne soit pas surpris par cet écart assumé.

**Aucun placeholder détecté** (relecture des 8 tâches) — chaque step contient du code complet ou une commande exacte avec sortie attendue.

**Cohérence de types** : `DockedPanelSpec`/`PanelColumnProps` (Task 6) réutilisés à l'identique en Task 7 (`id`/`title`/`collapsed`/`onCollapsedChange`/`content`) ; `usePointerReorder`/`reorderById`/`computeInsertIndex` (Task 4) consommés avec les mêmes signatures en Task 5 (`LayerPanel`) et Task 6 (`PanelColumn`) ; `onReorder: (id: string, newIndex: number) => void` cohérent partout (LayerPanel, PanelColumn, App.tsx `handleReorder`/`handlePanelReorder`).
