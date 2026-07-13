# shaderlab Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le design system documenté de shaderlab, migrer l'interface actuelle sans modifier sa logique métier, et fournir une planche de spécimens vérifiable dans le navigateur.

**Architecture:** Les styles suivent quatre niveaux stricts: primitives CSS, tokens sémantiques, tokens de composants, puis composants React. Les primitives UI restent contrôlées et accessibles. Les composants produit ne consomment que des primitives UI et des tokens sémantiques ou de composants. `App.tsx` conserve tout l'état et tous les handlers existants; seul son assemblage visuel change.

**Tech Stack:** React 19, TypeScript strict, CSS natif, Lucide React `1.24.0` (version vérifiée avec `npm view lucide-react version` le 2026-07-13), Vite, Vitest en environnement Node.

## Scope

Inclus:

- thème darkroom-balanced sombre, compact et à géométrie adoucie;
- tokens documentés dans `docs/design-system/`;
- primitives Button, IconButton, Slider, Checkbox, Select, Tooltip, Disclosure, Progress et Dialog;
- icônes Lucide, focus visible, navigation clavier et états disabled/error/loading;
- toolbar, canvas, pile de calques, paramètres, masque et bannière d'erreur actuels;
- inspecteur unique à droite;
- planche de spécimens Vite séparée;
- garde-fous automatisés sur les tokens et styles interdits.

Exclus:

- pellicule multi-photo et tri modifié/non modifié;
- changement du modèle de calques, opacité et modes de fusion;
- nouvelle architecture GPU du masque;
- nouveau workflow Exporter sous et progression réelle;
- Lightroom phase 2;
- thème clair.

## Invariants

- Ne pas modifier les handlers, l'état, les appels GPU ni la logique d'export de `App.tsx`.
- Ne jamais introduire de couleur, rayon, espacement ou durée brute dans un composant produit.
- Les conventions Windows ont priorité sur les adaptations des Apple HIG.
- Les contrôles restent utilisables au clavier avec un focus visible.
- Les tests React DOM ne sont pas introduits: le dépôt utilise Vitest Node. Tester la logique pure et les contrats de fichiers; vérifier le rendu par build et checkpoint humain.
- Ne pas utiliser `@tauri-apps/plugin-dialog`.
- `src/App.css` est un vestige Vite non importé: le supprimer, ne pas le migrer.

---

### Task 1: Installer Lucide et verrouiller le contrat des tokens

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/design/design-contract.test.ts`

**Produces:** une dépendance d'icônes vérifiée et un test qui échoue tant que la nouvelle architecture CSS n'existe pas.

- [ ] **Step 1: Écrire le test rouge**

Créer `test/design/design-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("design system contract", () => {
  it("exposes the required token layers", () => {
    const primitives = read("src/design/primitives.css");
    const semantics = read("src/design/semantic.css");
    const components = read("src/design/components.css");

    expect(primitives).toContain("--primitive-neutral-950");
    expect(semantics).toContain("--surface-workspace");
    expect(semantics).toContain("--focus-color");
    expect(components).toContain("--control-height-sm");
    expect(components).toContain("--inspector-width-default");
  });

  it("does not restore the legacy blue accent", () => {
    const css = [
      read("src/design/primitives.css"),
      read("src/design/semantic.css"),
      read("src/design/components.css"),
    ].join("\n");
    expect(css.toLowerCase()).not.toContain("#5aa9e6");
  });
});
```

- [ ] **Step 2: Vérifier l'échec attendu**

Run: `npm run test -- test/design/design-contract.test.ts`

Expected: FAIL avec `ENOENT` sur `src/design/primitives.css`.

- [ ] **Step 3: Installer la version vérifiée**

Run: `npm install lucide-react@1.24.0`

Expected: `lucide-react` apparaît dans `dependencies`, lockfile mis à jour, aucune vulnérabilité introduite signalée par npm.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json test/design/design-contract.test.ts
git commit -m "test: define design system contract"
```

---

### Task 2: Créer les couches de tokens et le reset global

**Files:**

- Create: `src/design/primitives.css`
- Create: `src/design/semantic.css`
- Create: `src/design/components.css`
- Create: `src/design/motion.css`
- Create: `src/design/reset.css`
- Create: `src/design/index.css`
- Modify: `src/main.tsx`
- Delete: `src/index.css`
- Delete: `src/App.css`

**Consumes:** valeurs exactes de `docs/design-system/tokens.md`.

- [ ] **Step 1: Implémenter les primitives**

Transcrire toutes les valeurs de la section primitives du document, sans renommer ni recalculer les valeurs. Le début du fichier est exactement:

```css
:root {
  --primitive-neutral-0: #fffdf9;
  --primitive-neutral-50: #f7f2ea;
  --primitive-neutral-100: #f0e8dc;
  --primitive-neutral-200: #d4cabc;
  --primitive-neutral-300: #b3aa9e;
  --primitive-neutral-400: #918980;
  --primitive-neutral-500: #6e6861;
  --primitive-neutral-600: #514c47;
  --primitive-neutral-700: #383431;
  --primitive-neutral-800: #292522;
  --primitive-neutral-850: #25211e;
  --primitive-neutral-900: #1d1b19;
  --primitive-neutral-925: #181614;
  --primitive-neutral-950: #151310;
  --primitive-neutral-1000: #100f0e;
}
```

Continuer dans ce même fichier avec toutes les primitives d'opacité, espace, typographie, géométrie, motion et z-index données dans `tokens.md`.

- [ ] **Step 2: Implémenter les sémantiques et composants**

```css
:root {
  color-scheme: dark;
  --surface-window: var(--primitive-neutral-1000);
  --surface-workspace: var(--primitive-neutral-950);
  --surface-panel: var(--primitive-neutral-900);
  --text-primary: rgba(240, 232, 220, .94);
  --focus-color: var(--primitive-neutral-100);
}
```

Continuer avec chaque token sémantique de `tokens.md`. Dans `components.css`, transcrire chaque token structurel et chaque token de composant de la même source, notamment `--control-height-sm: 28px`, `--toolbar-height: 36px`, `--inspector-width-default: 288px` et `--button-height: var(--control-height-md)`.

- [ ] **Step 3: Implémenter reset et motion**

Le reset doit inclure `box-sizing`, hauteur racine, fond, typo, antialiasing, héritage des contrôles et réduction de mouvement:

```css
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body {
  background: var(--surface-workspace);
  color: var(--text-primary);
  font: var(--font-ui);
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; }
:focus-visible { outline: var(--focus-width) solid var(--focus-color); outline-offset: var(--focus-offset); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 4: Créer l'entrée CSS et la brancher**

`src/design/index.css`:

```css
@import "./primitives.css";
@import "./semantic.css";
@import "./components.css";
@import "./motion.css";
@import "./reset.css";
```

Dans `src/main.tsx`, remplacer `import "./index.css"` par `import "./design/index.css"`.

- [ ] **Step 5: Vérifier**

Run: `npm run test -- test/design/design-contract.test.ts`

Expected: PASS, 2 tests.

Run: `npx tsc --noEmit && npm run build`

Expected: exit 0. Une régression visuelle temporaire est acceptable jusqu'à la Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/design src/main.tsx src/index.css src/App.css
git commit -m "feat: add design token foundation"
```

---

### Task 3: Implémenter Button, IconButton et Tooltip

**Files:**

- Create: `src/ui/Button.tsx`
- Create: `src/ui/IconButton.tsx`
- Create: `src/ui/Tooltip.tsx`
- Create: `src/ui/actions.css`
- Modify: `src/design/index.css`

**Interfaces:**

```ts
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "compact" | "default";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tooltip?: string;
  size?: "compact" | "default";
}

interface TooltipProps {
  content: string;
  children: React.ReactElement;
}
```

- [ ] **Step 1: Créer Button**

Le composant propage les attributs natifs, compose les classes sans dépendance et expose `aria-busy`:

```tsx
export function Button({ variant = "secondary", size = "default", loading = false, disabled, className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Créer Tooltip et IconButton**

Tooltip s'ouvre au hover et au focus, reste purement descriptif, utilise `role="tooltip"`, un id stable via `useId`, et n'intercepte pas les événements. IconButton exige toujours `label`, rendu en `aria-label`.

- [ ] **Step 3: Styliser tous les états**

Couvrir default, hover, active, focus-visible, disabled et loading. Utiliser uniquement les tokens. La zone cible d'IconButton reste au moins 28 x 28 px dans la densité compacte.

- [ ] **Step 4: Vérifier et commit**

Run: `npx tsc --noEmit && npm run build`

Expected: exit 0.

```bash
git add src/ui src/design/index.css
git commit -m "feat: add accessible action primitives"
```

---

### Task 4: Implémenter Slider, Checkbox et Progress

**Files:**

- Create: `src/ui/Slider.tsx`
- Create: `src/ui/Checkbox.tsx`
- Create: `src/ui/Progress.tsx`
- Create: `src/ui/controls.css`
- Create: `test/design/format-value.test.ts`
- Create: `src/ui/formatValue.ts`
- Modify: `src/design/index.css`

**Interfaces:**

```ts
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

interface ProgressProps {
  label: string;
  value?: number;
  max?: number;
}
```

- [ ] **Step 1: Tester le formatage de valeur**

```ts
import { describe, expect, it } from "vitest";
import { formatControlValue } from "../../src/ui/formatValue";

describe("formatControlValue", () => {
  it("keeps compact integers", () => expect(formatControlValue(42, 1)).toBe("42"));
  it("uses the precision implied by step", () => expect(formatControlValue(0.5, 0.05)).toBe("0.50"));
  it("uses three decimals for millisteps", () => expect(formatControlValue(0.125, 0.001)).toBe("0.125"));
});
```

Run: `npm run test -- test/design/format-value.test.ts`

Expected: FAIL, module absent.

- [ ] **Step 2: Implémenter le formatage**

```ts
export function formatControlValue(value: number, step: number): string {
  if (Number.isInteger(step)) return Math.round(value).toString();
  const decimals = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(decimals);
}
```

- [ ] **Step 3: Implémenter les contrôles**

Slider utilise un `<input type="range">` natif pour la sémantique clavier, avec label associé via `useId`. Checkbox utilise un input natif visuellement stylé. Progress rend `role="progressbar"` et omet `aria-valuenow` en mode indéterminé.

- [ ] **Step 4: Vérifier et commit**

Run: `npm run test -- test/design/format-value.test.ts && npx tsc --noEmit && npm run build`

Expected: tous exit 0.

```bash
git add src/ui src/design/index.css test/design/format-value.test.ts
git commit -m "feat: add calibrated control primitives"
```

---

### Task 5: Implémenter Select et Disclosure accessibles

**Files:**

- Create: `src/ui/Select.tsx`
- Create: `src/ui/Disclosure.tsx`
- Create: `src/ui/overlays.css`
- Create: `src/ui/selectNavigation.ts`
- Create: `test/design/select-navigation.test.ts`
- Modify: `src/design/index.css`

**Interfaces:**

```ts
export interface SelectOption { value: string; label: string; disabled?: boolean; }
interface SelectProps {
  label: string;
  value: string | null;
  placeholder?: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

interface DisclosureProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}
```

- [ ] **Step 1: Écrire les tests de navigation pure**

Tester ArrowDown, ArrowUp, Home, End, options disabled et boucle aux extrémités dans `select-navigation.test.ts`.

```ts
expect(nextEnabledIndex(options, 0, 1)).toBe(2);
expect(nextEnabledIndex(options, 2, -1)).toBe(0);
```

Run: `npm run test -- test/design/select-navigation.test.ts`

Expected: FAIL, module absent.

- [ ] **Step 2: Implémenter `nextEnabledIndex`**

La fonction est pure, boucle au début/à la fin et retourne `-1` si aucune option n'est active.

- [ ] **Step 3: Implémenter Select**

Utiliser le pattern button + listbox:

- bouton avec `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`;
- liste avec `role="listbox"` et options avec `role="option"`;
- Escape ferme et rend le focus au bouton;
- Enter/Espace sélectionnent;
- flèches, Home et End suivent le helper testé;
- clic extérieur ferme;
- aucun portal en v1, le conteneur d'inspecteur porte `overflow: visible` autour du contrôle.

- [ ] **Step 4: Implémenter Disclosure**

Le bouton porte `aria-expanded`, une icône `ChevronRight` tourne via un token de motion, et le contenu possède un id relié par `aria-controls`.

- [ ] **Step 5: Vérifier et commit**

Run: `npm run test -- test/design/select-navigation.test.ts && npx tsc --noEmit && npm run build`

Expected: tous exit 0.

```bash
git add src/ui src/design/index.css test/design/select-navigation.test.ts
git commit -m "feat: add inspector disclosure and select"
```

---

### Task 6: Implémenter Dialog comme contrat réutilisable

**Files:**

- Create: `src/ui/Dialog.tsx`
- Create: `src/ui/dialog.css`
- Modify: `src/design/index.css`

**Interface:**

```ts
interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
}
```

- [ ] **Step 1: Implémenter avec `<dialog>` natif**

Synchroniser `open` avec `showModal()`/`close()` dans un effet. Gérer `cancel`, restaurer le focus à l'élément précédemment actif, fournir `aria-labelledby` et `aria-describedby`, et rendre un IconButton de fermeture.

- [ ] **Step 2: Styliser**

Backdrop sombre, rayon dialog 10px, largeur bornée, actions à droite, aucun flou décoratif. Tous les tokens proviennent du design system.

- [ ] **Step 3: Vérifier et commit**

Run: `npx tsc --noEmit && npm run build`

Expected: exit 0.

```bash
git add src/ui src/design/index.css
git commit -m "feat: add desktop dialog primitive"
```

Note: cette tâche ne remplace pas l'export actuel. Elle prépare le contrat pour le plan Exporter sous.

---

### Task 7: Créer l'inspecteur droit unique

**Files:**

- Create: `src/components/Inspector.tsx`
- Create: `src/components/Inspector.css`
- Modify: `src/components/LayerPanel.tsx`
- Modify: `src/components/ParamPanel.tsx`

**Interfaces:** `InspectorProps` regroupe exactement les props actuelles de `LayerPanel` et `ParamPanel`; aucun callback nouveau et aucune mutation métier.

- [ ] **Step 1: Rendre LayerPanel présentational**

- supprimer sa largeur, son fond et sa bordure de panneau;
- remplacer le `<select>` natif par `Select`;
- remplacer oeil, tiret et croix texte par `Eye`, `EyeOff`, `GripVertical`, `Trash2`;
- rendre les actions avec IconButton et labels français;
- conserver intégralement le drag/drop et ses callbacks;
- utiliser le nom de l'effet depuis le registry, pas l'id brut.

- [ ] **Step 2: Rendre ParamPanel présentational**

- remplacer chaque range par `Slider`;
- remplacer la checkbox Gomme par `Checkbox`;
- remplacer le bouton masque par `Button`;
- grouper `Effet` et `Masque` dans deux `Disclosure` ouverts par défaut;
- conserver exactement les valeurs, bornes, steps et callbacks existants.

- [ ] **Step 3: Composer Inspector**

```tsx
export function Inspector(props: InspectorProps) {
  return (
    <aside className="inspector" aria-label="Inspecteur">
      <section className="inspector__layers" aria-labelledby="layers-title">
        <h2 id="layers-title">Calques</h2>
        <LayerPanel {...layerProps(props)} />
      </section>
      <section className="inspector__parameters" aria-labelledby="parameters-title">
        <h2 id="parameters-title">Réglages</h2>
        <ParamPanel {...parameterProps(props)} />
      </section>
    </aside>
  );
}
```

Éviter réellement `layerProps`/`parameterProps` si ces helpers n'améliorent pas le typage: passer les props explicitement est acceptable. Ne pas introduire d'abstraction spéculative.

- [ ] **Step 4: Vérifier et commit**

Run: `npm run test && npx tsc --noEmit && npm run build`

Expected: tests et build verts.

```bash
git add src/components/Inspector.tsx src/components/Inspector.css src/components/LayerPanel.tsx src/components/ParamPanel.tsx
git commit -m "refactor: compose editing controls in right inspector"
```

---

### Task 8: Migrer Toolbar, Canvas, ErrorBanner et App

**Files:**

- Create: `src/components/Toolbar.css`
- Create: `src/components/Canvas.css`
- Create: `src/components/ErrorBanner.css`
- Create: `src/App.css`
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/Canvas.tsx`
- Modify: `src/components/ErrorBanner.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Migrer Toolbar**

- `FolderOpen` + label `Ouvrir`;
- IconButton `Undo2` et `Redo2`, tooltips avec raccourcis;
- espace flexible;
- `Download` + label `Exporter`, variant primary neutre;
- aucun accent bleu ou emoji;
- props inchangées.

- [ ] **Step 2: Migrer Canvas**

Remplacer uniquement les styles inline par classes. Conserver `forwardRef`, conversion de coordonnées, drag/drop et cycle du stroke sans aucune modification fonctionnelle. Ajouter un `aria-label="Zone de travail image"` au canvas.

- [ ] **Step 3: Migrer ErrorBanner**

Utiliser `role="alert"`, `CircleAlert`, IconButton `X`, tokens danger, props inchangées.

- [ ] **Step 4: Assembler App**

Remplacer le layout inline par:

```tsx
<div className="app-shell">
  <Toolbar {...toolbarProps} />
  {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
  <main className="workspace">
    <Canvas {...canvasProps} ref={canvasRef} />
    <Inspector {...inspectorProps} />
  </main>
</div>
```

Passer les props explicitement dans le vrai code. Le canvas est le seul élément flexible; l'inspecteur utilise `--inspector-width`. Aucun panneau gauche ne subsiste.

- [ ] **Step 5: Vérifier la logique**

Run: `npm run test && npx tsc --noEmit && npm run build && cd src-tauri && cargo check`

Expected: tous exit 0. Si `cargo check` échoue parce que `dist/` manque, `npm run build` doit l'avoir créée; ne pas contourner avec une config Tauri.

- [ ] **Step 6: Checkpoint humain obligatoire**

Run: `npm run dev:debug`

L'utilisateur vérifie:

- ouverture d'image et rendu GPU inchangés;
- ajout, sélection, activation, suppression et réordre des calques;
- modification de chaque slider;
- peinture/gomme masque;
- undo/redo;
- export actuel;
- navigation Tab/Shift+Tab, activation Space/Enter, fermeture Select avec Escape;
- focus visible et aucun contrôle coupé à 1280 x 720;
- inspecteur uniquement à droite, canvas dominant.

Stopper et corriger toute régression avant commit.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.css src/components
git commit -m "feat: migrate workspace to shaderlab design system"
```

---

### Task 9: Ajouter la planche de spécimens

**Files:**

- Create: `design-system.html`
- Create: `src/design-system-main.tsx`
- Create: `src/design/Specimen.tsx`
- Create: `src/design/specimen.css`
- Modify: `vite.config.ts`

**Produces:** une page dev indépendante disponible à `/design-system.html`, sans code conditionnel dans l'app Tauri.

- [ ] **Step 1: Ajouter l'entrée HTML**

```html
<!doctype html>
<html lang="fr">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>shaderlab design system</title></head>
  <body><div id="root"></div><script type="module" src="/src/design-system-main.tsx"></script></body>
</html>
```

- [ ] **Step 2: Configurer les deux entrées Vite**

Utiliser `build.rollupOptions.input` avec `index.html` et `design-system.html`, résolus via l'API Node officielle. Ne modifier aucun réglage Tauri existant.

- [ ] **Step 3: Construire Specimen**

Présenter:

- palette et rôles sémantiques;
- typo UI et mono;
- Button et IconButton dans tous les variants/états;
- Slider min/milieu/max et disabled;
- Checkbox;
- Select ouvert/fermé vérifiable;
- Disclosure;
- Progress déterminé/indéterminé;
- Dialog déclenchable;
- extraits toolbar, calque sélectionné et section inspecteur;
- panneau de test de focus clavier.

La page utilise les vrais composants, jamais des imitations HTML.

- [ ] **Step 4: Vérifier**

Run: `npm run build`

Expected: `dist/index.html` et `dist/design-system.html` existent.

Run: `npm run dev -- --host 127.0.0.1`

Checkpoint humain sur `http://127.0.0.1:1420/design-system.html`: cohérence, lisibilité, densité, focus, états et géométrie adoucie.

- [ ] **Step 5: Commit**

```bash
git add design-system.html src/design-system-main.tsx src/design vite.config.ts
git commit -m "feat: add design system specimen board"
```

---

### Task 10: Durcir les garde-fous et faire la revue finale

**Files:**

- Modify: `test/design/design-contract.test.ts`
- Modify: `docs/design-system/governance.md` seulement si l'implémentation révèle un écart validé

- [ ] **Step 1: Étendre le test de contrat**

Lire tous les `.tsx` de `src/components` et refuser:

- `style={{`;
- couleurs hex/rgb/hsl;
- anciens tokens `--bg-`, `--text-`, `--accent` non namespacés;
- emoji utilisés comme icônes connues;
- import de `src/index.css` ou de l'ancien scaffold.

Exemple:

```ts
for (const file of componentFiles) {
  const source = readFileSync(file, "utf8");
  expect(source, file).not.toMatch(/style=\{\{/);
  expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
}
```

Autoriser explicitement les styles dynamiques indispensables dans les primitives, par exemple une custom property de progression, mais pas dans les composants produit.

- [ ] **Step 2: Lancer la vérification complète**

Run:

```bash
npm run test
npx tsc --noEmit
npm run build
cd src-tauri && cargo check
```

Expected: tous exit 0, aucun warning nouveau pertinent.

- [ ] **Step 3: Revue manuelle contre les documents**

Comparer le résultat ligne par ligne avec:

- `docs/design-system/foundations.md`;
- `docs/design-system/tokens.md`;
- `docs/design-system/components.md`;
- `docs/design-system/patterns.md`;
- `docs/design-system/content.md`;
- `docs/design-system/governance.md`.

Vérifier en particulier WCAG AA, focus, textes français, HIG desktop adaptée Windows, densité compacte, absence d'accent chromatique de marque, et aucune logique métier modifiée.

- [ ] **Step 4: Revue de diff**

Run: `git diff --check && git status --short && git diff --stat HEAD~1`

Expected: aucun whitespace error, aucun fichier métier GPU/export/layers modifié hors assemblage UI prévu, `AGENTS.md` non suivi reste intact.

- [ ] **Step 5: Commit final si nécessaire**

```bash
git add test/design/design-contract.test.ts docs/design-system/governance.md
git commit -m "test: enforce design system boundaries"
```

## Definition of Done

- Les quatre couches CSS existent et correspondent aux valeurs documentées.
- Aucun composant produit ne contient de styles inline ou de valeur visuelle brute.
- Tous les contrôles actuels fonctionnent comme avant.
- La disposition n'a plus de panneau gauche; calques et paramètres sont dans l'inspecteur droit.
- Lucide remplace les glyphes et emoji d'action.
- Les contrôles essentiels sont utilisables au clavier et ont un focus visible.
- La planche `/design-system.html` couvre les états documentés.
- Tests, typecheck, build frontend et `cargo check` passent.
- Le checkpoint visuel humain est validé.
- Aucun élément hors scope fonctionnel n'a été implémenté par anticipation.

## Plan Review Notes

- Couverture: fondations, tokens, composants, patterns, contenu et gouvernance ont chacun une tâche ou un critère de validation.
- Types: les interfaces reprennent les callbacks existants; aucune nouvelle donnée métier n'est requise.
- Risque principal: un Select custom est plus complexe qu'un `<select>` natif. Sa navigation est isolée et testée, puis validée au clavier.
- Risque de régression: le layout et les composants sont migrés après création des primitives; le checkpoint humain porte sur tous les flux existants.
- Découpage futur: pellicule, export progressif, modes de fusion et masque avancé restent explicitement séparés.
