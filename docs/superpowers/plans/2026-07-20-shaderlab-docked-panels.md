# Panneaux dockés (DockedPanelCard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le conteneur de panneaux flottants (`FloatingPanel` : drag libre + magnétisme + nudge clavier) par une colonne dockée fixe à droite (`DockedPanelCard`), avec un splitter redimensionnable entre les cartes Calques et Réglages, façon Photoshop web.

**Architecture:** Colonne positionnée UNE fois en CSS (`position: absolute; right: var(--space-6)`), largeur fixe 320px. `react-resizable-panels` (`PanelGroup` vertical) répartit la hauteur totale du workspace entre les deux cartes via un `PanelResizeHandle` ; chaque carte garde son état replié/déplié existant (chevron, instantané). Suppression complète de `snapping.ts`, `keyboardNudge.ts`, `effectiveViewport.ts`, du fantôme de drag, et simplification radicale du calcul de position dans `App.tsx` (plus de position initiale calculée, plus de `ResizeObserver` de correction de hauteur).

**Tech Stack:** React 19 + TS, `react-resizable-panels` (nouvelle dépendance), Tailwind v4 (classes existantes non touchées), tokens CSS projet (`src/design/*.css`), Vitest.

## Global Constraints

- Aucun test de rendu React dans ce repo (convention existante) — seule la logique pure (aucun calcul de position complexe restant, voir Task 1) est testée unitairement.
- Icônes = `lucide-react` uniquement, jamais de glyphe Unicode brut.
- Tout élément interactif = `<button>` natif ou `role="button"` + `tabindex="0"` + gestion clavier — jamais un `<span>`/`<div>` sans sémantique.
- `aria-label` explicite sur chaque bouton icône-seul ; cible cliquable ≥ 44×44px.
- Focus clavier visible via `--focus-color`/`--focus-width` (déjà définis dans `src/design/semantic.css`/`reset.css`) sur tout contrôle interactif nouveau.
- Token `--inspector-width-default` passe de `288px` à `320px` (un seul token, pas de doublon) — vérifier son usage ailleurs dans le codebase avant de le changer (Task 2).
- Marge de 16px = `--space-6` (PAS `--space-4`, qui vaut `8px` dans `primitives.css` — erreur corrigée dans le design doc le 2026-07-20, ne pas la réintroduire).
- Checkpoint visuel humain CDP obligatoire en fin de plan (Task 8) — Playwright headless inadapté sur ce projet (canvas WebGPU réel rend noir en headless), voir `CLAUDE.md` § Moyen de preuve.
- `react-resizable-panels` : version `4.12.2`, licence MIT, compatible React 19 (`peerDependencies: react ^18 || ^19`) — vérifié sur le registre npm le 2026-07-20, ne pas re-deviner une autre version au moment de l'implémentation.

---

## File Structure

**Créés :**
- `src/components/dockedPanel/DockedPanelCard.tsx` — carte individuelle (titre, chevron replier/déplier, contenu). Remplace `FloatingPanel.tsx`.
- `src/components/dockedPanel/DockedPanelCard.css` — styles de la carte (pas d'ombre, titre sentence-case, focus visible).
- `src/components/dockedPanel/PanelColumn.tsx` — conteneur `PanelGroup` vertical (react-resizable-panels), positionné fixe à droite, héberge les deux `DockedPanelCard`.
- `src/components/dockedPanel/PanelColumn.css` — position/largeur fixes de la colonne, styles du `PanelResizeHandle`.
- `test/components/dockedPanel/PanelColumn.test.tsx` — N'existe PAS : pas de test de rendu React dans ce repo (convention). Voir Task 1 pour ce qui reste testable en pur.

**Modifiés :**
- `src/App.tsx` — retire tout le calcul de position/état de drag des panneaux (lignes ~92-207 actuelles), remplace le rendu par `PanelColumn` + deux `DockedPanelCard`.
- `src/design/primitives.css` — aucun changement de valeur brute requis (le token `--space-6` existe déjà).
- `src/design/components.css` — `--inspector-width-default: 288px` → `320px` ; suppression de `--shadow-panel-resting` si plus utilisée ailleurs (vérifié Task 2).
- `package.json` — ajout `react-resizable-panels: ^4.12.2`.

**Supprimés :**
- `src/components/floatingPanel/FloatingPanel.tsx`
- `src/components/floatingPanel/FloatingPanel.css`
- `src/components/floatingPanel/FloatingPanel.stories.tsx`
- `src/components/floatingPanel/snapping.ts`
- `src/components/floatingPanel/keyboardNudge.ts`
- `src/components/floatingPanel/effectiveViewport.ts`
- `test/components/floatingPanel/snapping.test.ts`
- `test/components/floatingPanel/keyboardNudge.test.ts`
- `test/components/floatingPanel/effectiveViewport.test.ts`
- Dossiers `src/components/floatingPanel/` et `test/components/floatingPanel/` retirés une fois vides.

---

### Task 1 : Dépendance + vérification du terrain (tokens, usages existants)

**Files:**
- Modify: `package.json`
- Read only (vérification) : `src/design/components.css`, grep global sur `--inspector-width-default` et `--shadow-panel-resting`

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: dépendance `react-resizable-panels` installée et importable ; liste vérifiée des usages de `--inspector-width-default`/`--shadow-panel-resting` en dehors de `floatingPanel/` (aucun trouvé lors de l'analyse du 2026-07-20 — à reconfirmer).

- [ ] **Step 1: Ajouter la dépendance**

Dans `package.json`, section `dependencies` (ordre alphabétique existant) :

```json
    "react-resizable-panels": "^4.12.2",
```

Insérer entre `"react": "^19.0.0",` et `"react-dom": "^19.0.0",` (ordre alphabétique : react-resizable-panels vient après react-dom en toutes lettres — vérifier l'ordre alphabétique réel du fichier avant d'insérer, ne pas casser le tri existant).

- [ ] **Step 2: Installer**

Run: `npm install`
Expected: `react-resizable-panels@4.12.2` ajouté à `package-lock.json`, aucune erreur de peer dependency.

- [ ] **Step 3: Vérifier qu'aucun autre composant ne dépend de `--inspector-width-default` ou `--shadow-panel-resting` en dehors de `floatingPanel/`**

Run: `git grep -n "inspector-width-default\|shadow-panel-resting"`
Expected: seules les occurrences dans `src/components/floatingPanel/*`, `src/design/components.css`, et les docs. Si un autre composant apparaît (ex. un futur usage), le noter et NE PAS supprimer `--shadow-panel-resting` à la Task 2 tant que cet usage n'est pas traité séparément — sinon supprimer.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-resizable-panels dependency"
```

---

### Task 2 : Tokens — largeur du dock et suppression de l'ombre

**Files:**
- Modify: `src/design/components.css:14-16` (`--inspector-width-min/default/max`), `src/design/components.css:47` (`--shadow-panel-resting`)

**Interfaces:**
- Consumes: résultat du grep Task 1 Step 3.
- Produces: `--inspector-width-default: 320px` (nouvelle valeur canonique de largeur de dock, consommée par Task 3/4/6) ; `--shadow-panel-resting` retirée si non utilisée ailleurs.

- [ ] **Step 1: Modifier la largeur par défaut**

Dans `src/design/components.css`, remplacer :

```css
  --inspector-width-min: 240px;
  --inspector-width-default: 288px;
  --inspector-width-max: 400px;
```

par :

```css
  --inspector-width-min: 240px;
  --inspector-width-default: 320px;
  --inspector-width-max: 400px;
```

- [ ] **Step 2: Retirer `--shadow-panel-resting` (si Task 1 Step 3 confirme qu'elle n'est utilisée que par `FloatingPanel.css`, supprimé en Task 6)**

Dans `src/design/components.css`, retirer la ligne :

```css
  --shadow-panel-resting: 0 2px 8px rgba(8, 7, 6, .32);
```

Garder `--shadow-panel-dragging` — non concerné par ce changement (pas de fantôme de drag dans le nouveau composant, mais la valeur peut rester si un futur composant en a besoin ; ne pas la supprimer sans preuve qu'elle est inutilisée ailleurs).

- [ ] **Step 3: Vérifier qu'aucun test/lint ne casse**

Run: `npm run lint:tokens`
Expected: aucune nouvelle violation (le script détecte les valeurs en dur qui contournent un token — ce changement ne fait que modifier la VALEUR d'un token existant, pas introduire de valeur en dur).

- [ ] **Step 4: Commit**

```bash
git add src/design/components.css
git commit -m "feat: bump inspector width token to 320px, drop unused panel shadow token"
```

---

### Task 3 : `DockedPanelCard` — composant de carte (sans position/drag)

**Files:**
- Create: `src/components/dockedPanel/DockedPanelCard.tsx`
- Create: `src/components/dockedPanel/DockedPanelCard.css`

**Interfaces:**
- Consumes: `IconButton` (`src/ui/IconButton.tsx`, props `{label, size, onClick, onPointerDown?, children}` — déjà utilisé ainsi dans l'ancien `FloatingPanel.tsx`), `ChevronDown`/`ChevronRight` de `lucide-react`.
- Produces: `export interface DockedPanelCardProps { title: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; children: React.ReactNode; className?: string }` et `export function DockedPanelCard(props: DockedPanelCardProps): JSX.Element` — consommé par Task 4 (`PanelColumn`) et Task 7 (`App.tsx`).

- [ ] **Step 1: Écrire le composant**

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
}

/**
 * Carte de panneau dockée, fixe (pas de drag, pas de magnétisme) — remplace
 * `FloatingPanel`. Position/taille sont pilotées par le parent (`PanelColumn`,
 * via `react-resizable-panels`) : ce composant ne connaît que son titre, son
 * état replié/déplié, et son contenu.
 */
export function DockedPanelCard({
  title,
  collapsed,
  onCollapsedChange,
  children,
  className = "",
}: DockedPanelCardProps) {
  return (
    <div className={`docked-panel-card ${className}`.trim()}>
      <div className="docked-panel-card__titlebar">
        <span className="docked-panel-card__title">{title}</span>
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
      {!collapsed && <div className="docked-panel-card__content">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Écrire les styles (sentence-case, pas d'ombre, focus visible)**

```css
/*
 * DockedPanelCard : carte fixe (Calques/Réglages) — remplace FloatingPanel.
 * Pas de drag, pas d'ombre portée (design plat, photoshop.adobe.com observé
 * en vrai) : la position/taille est gérée par le parent PanelColumn.
 */

.docked-panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  color: var(--text-primary);
}

.docked-panel-card__titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: var(--section-header-height);
  padding-inline: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.docked-panel-card__title {
  font-family: var(--font-ui);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docked-panel-card__content {
  padding: var(--space-4);
  min-height: 0;
  overflow-y: auto;
}
```

Note : `--focus-color`/`--focus-width` s'appliquent déjà globalement via `src/design/reset.css:10` (`:focus-visible { outline: ... }`) — le bouton chevron (`IconButton`) en hérite nativement, pas besoin de règle spécifique ici (contrairement à `FloatingPanel__titlebar` qui avait sa propre règle `:focus-visible` parce que la POIGNÉE DE DRAG elle-même était focusable ; ce cas n'existe plus, seul le bouton l'est).

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur sur les deux nouveaux fichiers (le composant n'est pas encore importé ailleurs, donc pas d'erreur de câblage à ce stade).

- [ ] **Step 4: Commit**

```bash
git add src/components/dockedPanel/DockedPanelCard.tsx src/components/dockedPanel/DockedPanelCard.css
git commit -m "feat: add DockedPanelCard component"
```

---

### Task 4 : `PanelColumn` — colonne dockée + splitter (react-resizable-panels)

**Files:**
- Create: `src/components/dockedPanel/PanelColumn.tsx`
- Create: `src/components/dockedPanel/PanelColumn.css`

**Interfaces:**
- Consumes: `Panel`, `PanelGroup`, `PanelResizeHandle` de `react-resizable-panels` (API publique du package : `PanelGroup direction="vertical"`, `Panel defaultSize minSize maxSize` en pourcentage du groupe, `PanelResizeHandle` élément de poignée) ; `DockedPanelCardProps["children"]` type de Task 3.
- Produces: `export interface PanelColumnProps { layersTitle: string; layersCollapsed: boolean; onLayersCollapsedChange: (c: boolean) => void; layersContent: React.ReactNode; paramsTitle: string; paramsCollapsed: boolean; onParamsCollapsedChange: (c: boolean) => void; paramsContent: React.ReactNode }` et `export function PanelColumn(props: PanelColumnProps): JSX.Element` — consommé par Task 7 (`App.tsx`).

- [ ] **Step 1: Écrire le composant**

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { DockedPanelCard } from "./DockedPanelCard";
import "./PanelColumn.css";

export interface PanelColumnProps {
  layersTitle: string;
  layersCollapsed: boolean;
  onLayersCollapsedChange: (collapsed: boolean) => void;
  layersContent: React.ReactNode;
  paramsTitle: string;
  paramsCollapsed: boolean;
  onParamsCollapsedChange: (collapsed: boolean) => void;
  paramsContent: React.ReactNode;
}

/**
 * Colonne dockée fixe à droite (Calques + Réglages), position posée UNE fois
 * en CSS (PanelColumn.css) — remplace le calcul de position JS de l'ancien
 * FloatingPanel/App.tsx. `react-resizable-panels` répartit la hauteur totale
 * disponible entre les deux cartes ; défaut 45/55, bornes 20%/80% pour
 * qu'aucune carte ne puisse être réduite à rien par le splitter (le repli
 * chevron reste le seul moyen de masquer le CONTENU d'une carte).
 */
export function PanelColumn({
  layersTitle,
  layersCollapsed,
  onLayersCollapsedChange,
  layersContent,
  paramsTitle,
  paramsCollapsed,
  onParamsCollapsedChange,
  paramsContent,
}: PanelColumnProps) {
  return (
    <div className="panel-column">
      <PanelGroup direction="vertical" className="panel-column__group">
        <Panel defaultSize={45} minSize={20} maxSize={80} className="panel-column__pane">
          <DockedPanelCard
            title={layersTitle}
            collapsed={layersCollapsed}
            onCollapsedChange={onLayersCollapsedChange}
          >
            {layersContent}
          </DockedPanelCard>
        </Panel>
        <PanelResizeHandle className="panel-column__handle" aria-label="Redimensionner Calques et Réglages" />
        <Panel defaultSize={55} minSize={20} maxSize={80} className="panel-column__pane">
          <DockedPanelCard
            title={paramsTitle}
            collapsed={paramsCollapsed}
            onCollapsedChange={onParamsCollapsedChange}
          >
            {paramsContent}
          </DockedPanelCard>
        </Panel>
      </PanelGroup>
    </div>
  );
}
```

- [ ] **Step 2: Écrire les styles (position fixe, largeur, poignée)**

```css
/*
 * PanelColumn : positionne la colonne Calques/Réglages UNE fois en CSS,
 * jamais recalculée en JS (remplace le state drag/magnétisme de App.tsx).
 * Ancrée dans .canvas-stage (position: relative, src/components/Canvas.css).
 */

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

.panel-column__group {
  height: 100%;
}

.panel-column__pane {
  min-height: 0;
}

/* Poignée de splitter : barre fine, pas de style au repos, feedback au
   survol/drag via le token de bordure existant (pas de nouveau token
   couleur pour un seul usage — même principe que le reste du projet). */
.panel-column__handle {
  height: var(--space-2);
  margin-block: calc(var(--space-2) * -1);
  cursor: row-resize;
  position: relative;
}

.panel-column__handle::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  top: 50%;
  height: 1px;
  background: var(--border-subtle);
  transform: translateY(-50%);
}

.panel-column__handle:hover::after,
.panel-column__handle[data-resize-handle-active]::after {
  background: var(--border-selection);
}

.panel-column__handle:focus-visible {
  outline: var(--focus-width) solid var(--focus-color);
  outline-offset: var(--focus-offset);
}
```

Note accessibilité : `PanelResizeHandle` de `react-resizable-panels` rend un élément focusable au clavier nativement (flèches Haut/Bas pour redimensionner une fois focus dessus) — vérifier ce comportement au Step 3 plutôt que de le supposer.

- [ ] **Step 3: Vérifier le comportement clavier de `PanelResizeHandle` sur pièce**

Run: `npx tsc --noEmit` (vérifie que l'import et les props compilent)

Avant de considérer l'accessibilité clavier acquise, consulter la doc officielle du package (`react-resizable-panels` sur npm/GitHub, section accessibilité) pour confirmer si `PanelResizeHandle` gère nativement les flèches clavier ou si un `tabIndex`/gestionnaire `onKeyDown` explicite est nécessaire — ne pas supposer, vérifier au moment de l'implémentation réelle (contrainte CLAUDE.md : ne jamais deviner un comportement d'API).

- [ ] **Step 4: Commit**

```bash
git add src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css
git commit -m "feat: add PanelColumn with resizable splitter"
```

---

### Task 5 : Canvas — confirmer la compensation de centrage (déjà correcte, pas de régression)

**Files:**
- Modify: aucun changement de valeur attendu — vérification seulement.
- Read: `src/components/Canvas.css:25`

**Interfaces:**
- Consumes: `--inspector-width-default` (Task 2, désormais 320px).
- Produces: confirmation que `padding-right: var(--inspector-width-default)` (déjà en place, calcul exact sans facteur `*2`) reste correct avec la nouvelle valeur de token — aucune modification de code nécessaire, `Canvas.css` référence déjà le token, pas une constante dupliquée.

- [ ] **Step 1: Relire `Canvas.css` et confirmer qu'aucune valeur n'est dupliquée en dur**

Run: `git grep -n "288\|inspector-width" src/components/Canvas.css`
Expected: seule la ligne `padding-right: var(--inspector-width-default);` apparaît — aucune valeur `288` en dur. Si une valeur en dur existe, la remplacer par le token dans ce step (mais l'analyse du 2026-07-20 ne montre aucune duplication : `Canvas.css` référence déjà le token, la valeur de 320px se propage automatiquement).

- [ ] **Step 2: Aucun commit nécessaire si Step 1 ne trouve rien à changer**

Si Step 1 confirme l'absence de duplication, passer directement à Task 6 (rien à committer pour cette tâche).

---

### Task 6 : Suppression des fichiers `floatingPanel/`

**Files:**
- Delete: `src/components/floatingPanel/FloatingPanel.tsx`
- Delete: `src/components/floatingPanel/FloatingPanel.css`
- Delete: `src/components/floatingPanel/FloatingPanel.stories.tsx`
- Delete: `src/components/floatingPanel/snapping.ts`
- Delete: `src/components/floatingPanel/keyboardNudge.ts`
- Delete: `src/components/floatingPanel/effectiveViewport.ts`
- Delete: `test/components/floatingPanel/snapping.test.ts`
- Delete: `test/components/floatingPanel/keyboardNudge.test.ts`
- Delete: `test/components/floatingPanel/effectiveViewport.test.ts`

**Interfaces:**
- Consumes: rien (Task 7 doit être faite APRÈS celle-ci pour que `App.tsx` ne référence plus ces fichiers avant leur suppression — voir ordre alternatif ci-dessous).
- Produces: dossier `floatingPanel/` retiré du repo.

**⚠️ Ordre d'exécution** : `App.tsx` importe encore `FloatingPanel`/`snapping`/`effectiveViewport` (voir Task 7). Exécuter cette tâche APRÈS Task 7 (une fois `App.tsx` migré vers `PanelColumn`), pas avant — sinon `npx tsc --noEmit` échoue entre les deux tâches. Le plan les liste dans cet ordre pour la lisibilité (composants neufs d'abord, ancien retiré ensuite) mais l'exécuteur doit committer Task 7 avant de lancer les suppressions ci-dessous.

- [ ] **Step 1: Supprimer les fichiers de composant**

```bash
git rm src/components/floatingPanel/FloatingPanel.tsx
git rm src/components/floatingPanel/FloatingPanel.css
git rm src/components/floatingPanel/FloatingPanel.stories.tsx
git rm src/components/floatingPanel/snapping.ts
git rm src/components/floatingPanel/keyboardNudge.ts
git rm src/components/floatingPanel/effectiveViewport.ts
```

- [ ] **Step 2: Supprimer les tests associés**

```bash
git rm test/components/floatingPanel/snapping.test.ts
git rm test/components/floatingPanel/keyboardNudge.test.ts
git rm test/components/floatingPanel/effectiveViewport.test.ts
```

- [ ] **Step 3: Vérifier qu'aucune référence ne subsiste**

Run: `git grep -rn "floatingPanel\|FloatingPanel\|computeSnappedPosition\|computeNudgedPosition\|computeEffectiveViewportWidth" -- '*.ts' '*.tsx'`
Expected: zéro résultat (en dehors des docs déjà existants sous `docs/`, non concernés par ce grep restreint aux `.ts`/`.tsx`).

- [ ] **Step 4: Lancer la suite de tests complète**

Run: `npm run test`
Expected: tous les tests passent, aucune référence orpheline aux fichiers supprimés (Vitest échouerait sur un import cassé).

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove FloatingPanel, snapping, nudge, and effectiveViewport (superseded by DockedPanelCard/PanelColumn)"
```

---

### Task 7 : Câblage `App.tsx` — retirer le state de position, monter `PanelColumn`

**Files:**
- Modify: `src/App.tsx:1-29` (imports), `:92-207` (state/calculs de position), `:613-679` (rendu `FloatingPanel` × 2)

**Interfaces:**
- Consumes: `PanelColumn` (Task 4, props `PanelColumnProps`), `DockedPanelCard` (indirectement, via `PanelColumn`).
- Produces: `App.tsx` sans aucun état de position (`layersPanel.position`/`paramsPanel.position` retirés — seul `collapsed` par panneau subsiste), sans `ResizeObserver` de correction de hauteur, sans `computeSnappedPosition`/constantes `effectiveViewport`.

- [ ] **Step 1: Retirer les imports obsolètes et ajouter le nouvel import**

Dans `src/App.tsx`, remplacer (lignes 17-23) :

```tsx
import { FloatingPanel } from "./components/floatingPanel/FloatingPanel";
import {
  DEFAULT_PANEL_COLUMN_WIDTH,
  COLLAPSED_PANEL_HEIGHT,
  PANEL_START_MARGIN,
} from "./components/floatingPanel/effectiveViewport";
import { computeSnappedPosition, PANEL_GAP } from "./components/floatingPanel/snapping";
```

par :

```tsx
import { PanelColumn } from "./components/dockedPanel/PanelColumn";
```

- [ ] **Step 2: Retirer tout le bloc de calcul de position (lignes ~92-207 actuelles)**

Supprimer entièrement, du commentaire `// Position de départ des panneaux flottants...` (ligne 92) jusqu'à la fin du second `useEffect` de correction de hauteur (ligne 207 actuelle, juste avant le commentaire `// layersRef = source de vérité COMPLÈTE...`). Ce bloc inclut : `workspaceSize`/`hasMeasuredWorkspaceRef`/`ResizeObserver` sur `.workspace` (ATTENTION — ce `ResizeObserver` sert aussi potentiellement à autre chose, vérifier avant suppression, voir Step 2bis ci-dessous), `PANEL_SIZE`, `layersRawPosition`/`layersInitialPosition`, `paramsFitsExpanded`/`paramsHeight`/`paramsRawPosition`/`paramsInitialPosition`, les deux `useState` `layersPanel`/`paramsPanel` (à réduire, voir Step 3), `layersPanelHeight`/`paramsPanelHeight`, le `useEffect` `initialFitCheckedRef`, `layersPanelElRef`/`layersHeightCorrectedRef`/le `useEffect` de mesure de hauteur réelle.

**Step 2bis — vérification avant suppression** : `workspaceSize`/le premier `ResizeObserver` sur `workspaceRef` ne servaient QU'au calcul de position des panneaux (confirmé par lecture du fichier le 2026-07-20 : aucun autre consommateur de `workspaceSize` dans `App.tsx`). Confirmer avec `git grep -n "workspaceSize\|workspaceRef" src/App.tsx` avant de les retirer — si un autre usage est trouvé (peu probable), le conserver et n'enlever que les parties dédiées au positionnement des panneaux.

- [ ] **Step 3: Réduire le state à `collapsed` seul (plus de position/height calculée)**

Ajouter (à la place du bloc retiré) :

```tsx
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
```

- [ ] **Step 4: Remplacer le rendu des deux `FloatingPanel` par un `PanelColumn` unique**

Remplacer (lignes 623-678 actuelles) :

```tsx
        <FloatingPanel
          title="Calques"
          position={layersPanel.position}
          size={PANEL_SIZE}
          collapsed={layersPanel.collapsed}
          panelRef={layersPanelElRef}
          onPositionChange={(position) => setLayersPanel((s) => ({ ...s, position }))}
          onCollapsedChange={(collapsed) => setLayersPanel((s) => ({ ...s, collapsed }))}
          siblingRects={[
            { id: "params", rect: { ...paramsPanel.position, width: PANEL_SIZE.width, height: paramsPanelHeight } },
          ]}
          canvasSize={workspaceSize}
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
          siblingRects={[
            { id: "layers", rect: { ...layersPanel.position, width: PANEL_SIZE.width, height: layersPanelHeight } },
          ]}
          canvasSize={workspaceSize}
        >
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
        </FloatingPanel>
```

par :

```tsx
        <PanelColumn
          layersTitle="Calques"
          layersCollapsed={layersCollapsed}
          onLayersCollapsedChange={setLayersCollapsed}
          layersContent={
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
          }
          paramsTitle={paramsPanelTitle}
          paramsCollapsed={paramsCollapsed}
          onParamsCollapsedChange={setParamsCollapsed}
          paramsContent={
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
          }
        />
```

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: zéro erreur. Si des erreurs mentionnent `workspaceSize`/`layersPanel`/`paramsPanel`/`PANEL_SIZE` non définis, un usage résiduel du bloc supprimé a été manqué au Step 2 — le localiser et le retirer.

- [ ] **Step 6: Exécuter Task 6 maintenant (suppression des fichiers `floatingPanel/`)**

Suivre Task 6 Steps 1-5 à ce point précis (après ce Step 5, avant le commit ci-dessous) — c'est l'ordre réel d'exécution malgré la numérotation des tâches (voir avertissement en tête de Task 6).

- [ ] **Step 7: Lancer la suite de tests + build**

Run: `npm run test && npx tsc --noEmit && npm run build`
Expected: tests verts, aucune erreur de type, build Vite réussi.

- [ ] **Step 8: Commit**

```bash
git add -- src/App.tsx src/components/floatingPanel src/components/dockedPanel package.json package-lock.json test/components/floatingPanel
git commit -m "feat: replace FloatingPanel with docked PanelColumn (Calques/Réglages)"
```

---

### Task 8 : Checkpoint visuel humain + nettoyage final

**Files:**
- Aucun fichier modifié — vérification uniquement.

**Interfaces:**
- Consumes: build complet des Tasks 1-7.
- Produces: confirmation visuelle humaine (obligatoire, Playwright headless inadapté sur ce projet — canvas WebGPU réel).

- [ ] **Step 1: Lancer l'app en mode debug**

Run: `npm run dev:debug`
Puis : `npm run dev:monitor` pour confirmer le démarrage sans erreur Rust/Vite/WebView2.

- [ ] **Step 2: Checkpoint visuel humain (CDP ou fenêtre réelle) — 6 points à confirmer avec Antoine**

1. Colonne Calques/Réglages visible à droite, largeur ~320px, sans ombre portée.
2. Titre des cartes en sentence-case (ex. "Calques", pas "CALQUES"), sans tracking élargi.
3. Splitter entre les deux cartes : curseur `row-resize` au survol, drag redimensionne bien les deux cartes en sens inverse, bornes 20%/80% respectées (aucune carte ne peut être réduite à zéro).
4. Repli/dépli (chevron) toujours instantané, comportement inchangé.
5. Canvas correctement centré (pas de décalage double comme le bug du 2026-07-20).
6. Focus clavier visible en tabulant sur : chevron Calques, chevron Réglages, poignée de splitter.

- [ ] **Step 3: Si un point échoue, corriger et relancer ce Step 2 avant de continuer**

Ne pas commit tant que les 6 points ne sont pas confirmés par Antoine.

- [ ] **Step 4: Mettre à jour `CLAUDE.md` et `docs/INDEX.json`**

Une fois le checkpoint confirmé : dans `CLAUDE.md`, remplacer la mention "en cours de REMPLACEMENT" (section bandeau de tête) par une mention de tranche terminée, et ajouter une entrée `plans` dans `docs/INDEX.json` pour ce plan (même format que les entrées existantes — statut, date, résumé factuel du résultat réel, pas des intentions).

- [ ] **Step 5: Commit final**

```bash
git add CLAUDE.md docs/INDEX.json
git commit -m "docs: mark docked panels rework as complete, checkpoint confirmed"
```

---

## Self-Review (effectuée par l'auteur du plan)

**Couverture spec (design doc `2026-07-20-shaderlab-docked-panels-design.md`) :**
- Conteneur remplacé (`FloatingPanel` → `DockedPanelCard`) : Task 3.
- Splitter redimensionnable : Task 4.
- Suppression `snapping.ts`/`keyboardNudge.ts`/fantôme/`effectiveViewport.ts` : Task 6-7.
- Position CSS unique, largeur 320px : Task 2, Task 4 Step 2.
- Compensation canvas exacte (déjà en place) : Task 5.
- Style visuel (pas d'ombre, sentence-case) : Task 3 Step 2, Task 2 Step 2.
- Exigences a11y (boutons natifs, aria-label, ≥44px, lucide-react, focus visible, `--border-selection`) : Task 3 (IconButton déjà natif+aria-label+44px par construction existante du composant), Task 4 (poignée splitter, à vérifier clavier réel), `--border-selection` déjà utilisé ailleurs (hors scope direct, non touché).
- Ce qui ne change pas (repli instantané, LayerPanel/ParamPanel inchangés, pattern historique) : non touché par ce plan, confirmé par Task 7 qui ne fait que déplacer le JSX, pas sa logique interne.
- Tests unitaires de logique pure : plus de logique de position complexe à tester après suppression de `snapping`/`keyboardNudge`/`effectiveViewport` — aucun nouveau module de calcul n'est introduit (react-resizable-panels gère sa propre logique, hors du périmètre de test du projet).
- Checkpoint visuel humain CDP : Task 8.

**Gap identifié et comblé pendant l'écriture du plan (pas dans le design doc initial) :** le design doc décrivait un mode "min-content, pas de flex:1 forcé" incompatible avec le modèle de `react-resizable-panels` (qui remplit 100% du groupe) — tranché avec Antoine avant d'écrire ce plan (colonne remplit toute la hauteur dispo, defaultSize 45/55, minSize/maxSize 20/80). Design doc mis à jour en conséquence le 2026-07-20 avant ce plan.

**Aucun placeholder détecté** (relecture des 8 tâches) — chaque step contient du code complet ou une commande exacte avec sortie attendue.

**Cohérence de types** : `DockedPanelCardProps`/`PanelColumnProps` définis en Task 3/4 réutilisés à l'identique en Task 7 (noms de props vérifiés : `layersTitle`/`layersCollapsed`/`onLayersCollapsedChange`/`layersContent`/`paramsTitle`/`paramsCollapsed`/`onParamsCollapsedChange`/`paramsContent` — cohérents entre la déclaration Task 4 et l'usage Task 7).
