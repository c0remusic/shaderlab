# Migration shadcn/ui — Plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrer `ErrorBanner`, `Toolbar`, `BrushToolbar` (shaderlab) vers des primitives `shadcn/ui`, après avoir posé la fondation Tailwind v4 + `shadcn/ui` mappée sur les tokens `src/design/*.css` existants.

**Architecture:** 4 tranches verticales séquentielles. Tranche 1 = fondation (aucun composant migré, juste l'outillage). Tranches 2-4 = un composant migré chacune, dans l'ordre ErrorBanner → Toolbar → BrushToolbar. Chaque tranche = 1 commit, vérifiée avant la suivante (Storybook + `npm run lint:tokens` + `npm run dev`).

**Tech Stack:** React 19, Vite 6, TypeScript 5, Tailwind v4 (`@tailwindcss/vite`), `shadcn/ui` CLI, Storybook 10.5.2 (déjà en place).

## Global Constraints

- Palette/tokens existants (`src/design/primitives.css`, `semantic.css`) restent la SEULE source de vérité couleur/spacing/radius — le thème Tailwind/shadcn les LIT, ne les redéfinit jamais en dur.
- Aucune régression visuelle ou comportementale à aucune tranche — si Storybook ou l'app montre une différence non voulue, la tranche n'est pas terminée.
- `npm run lint:tokens` doit rester vert (ou toute nouvelle violation expliquée et acceptée explicitement) après chaque tranche.
- Ne jamais toucher `Inspector.tsx`, `LayerPanel.tsx`, `ParamPanel.tsx`, `Canvas.tsx`/`Canvas.css` — hors-scope de ce plan.
- Ne jamais toucher `TECH_DEBT_AUDIT.md`, `src-tauri/Cargo.toml`, `docs/superpowers/plans/2026-07-19-shaderlab-masking-tranche2.md`, `src/layers/`, `src/mask/` — travail d'une autre session en cours sur ce repo.
- Pas de nouveaux tests automatisés exigés (aucune suite n'existe pour ces composants aujourd'hui) — vérification = Storybook + lancement manuel de l'app, cohérent avec `docs/superpowers/specs/2026-07-20-shadcn-migration-design.md` § Test.
- 1 commit par tranche, pathspec explicite (jamais `git add -A`), message `feat(ui): ...`.

---

## Task 1 : Fondation — Tailwind v4 + init shadcn/ui

**Files:**
- Create: `components.json` (généré par la CLI shadcn)
- Create: `src/lib/utils.ts` (généré par la CLI shadcn — helper `cn()`)
- Create: `src/design/tailwind-theme.css` (nouveau — mapping des tokens existants vers les variables shadcn)
- Modify: `vite.config.ts` (ajout du plugin `@tailwindcss/vite`)
- Modify: `.storybook/preview.ts` (import du CSS Tailwind compilé)
- Modify: `package.json` (nouvelles dépendances)
- Modify: `tsconfig.json` (alias `@/*` requis par la CLI shadcn)

**Interfaces:**
- Produces: variable CSS `--background`/`--foreground`/`--primary`/`--destructive`/`--border`/`--radius` (noms shadcn standard) définies dans `src/design/tailwind-theme.css`, lues par le thème Tailwind. Les tâches 2-4 consomment ces noms de variables via les classes utilitaires générées par shadcn — ne pas inventer d'autres noms.

- [ ] **Step 1: Installer Tailwind v4 + plugin Vite**

```bash
cd C:\dev\shaderlab
npm install tailwindcss @tailwindcss/vite
```

Expected: `tailwindcss` et `@tailwindcss/vite` apparaissent dans `devDependencies` de `package.json`.

- [ ] **Step 2: Câbler le plugin dans Vite**

Modifier `vite.config.ts` :

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri to prevent too much magic
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Using polling since fsEvents doesn't work on all platforms
      usePolling: true,
    },
  },

  // To make use of `TAURI_DEBUG` and other env variables
  // https://tauri.app/2/reference/rust-api/tauri/struct.Config#env
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri supports es2021
    target:
      process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
```

- [ ] **Step 3: Créer le point d'entrée Tailwind**

Créer `src/design/tailwind.css` :

```css
@import "tailwindcss";
@import "./tailwind-theme.css";
```

- [ ] **Step 4: Mapper les tokens existants vers les variables shadcn**

Créer `src/design/tailwind-theme.css` — traduit les tokens déjà définis dans
`primitives.css`/`semantic.css` (déjà chargés avant ce fichier via
`src/design/index.css`) vers les noms de variables que shadcn/ui attend :

```css
@theme inline {
  --color-background: var(--surface-window);
  --color-foreground: var(--text-primary);
  --color-card: var(--surface-panel);
  --color-card-foreground: var(--text-primary);
  --color-popover: var(--surface-raised);
  --color-popover-foreground: var(--text-primary);
  --color-primary: var(--action-primary-bg);
  --color-primary-foreground: var(--action-primary-text);
  --color-secondary: var(--action-secondary-bg);
  --color-secondary-foreground: var(--text-primary);
  --color-muted: var(--surface-hover);
  --color-muted-foreground: var(--text-secondary);
  --color-accent: var(--action-secondary-hover);
  --color-accent-foreground: var(--text-primary);
  --color-destructive: var(--status-danger);
  --color-destructive-foreground: var(--status-danger-text);
  --color-border: var(--border-default);
  --color-input: var(--border-default);
  --color-ring: var(--focus-color);

  --radius-sm: var(--radius-control);
  --radius-md: var(--radius-group);
  --radius-lg: var(--radius-panel);
  --radius-xl: var(--radius-dialog);
}
```

Note : ces variables ne redéfinissent AUCUNE valeur — elles pointent toutes
vers un token déjà déclaré dans `primitives.css`/`semantic.css`. Si un futur
composant a besoin d'un rôle shadcn non couvert ici (ex. `--color-warning`),
l'ajouter à ce fichier en pointant vers un token `semantic.css` existant,
jamais une valeur en dur.

- [ ] **Step 5: Importer le CSS Tailwind dans l'app et dans Storybook**

Trouver le point d'entrée CSS actuel de l'app (`src/main.tsx` ou équivalent —
vérifier où `src/design/index.css` est importé aujourd'hui) et ajouter juste
en dessous :

```typescript
import "./design/tailwind.css";
```

Modifier `.storybook/preview.ts` pour importer aussi ce fichier, en plus de
`src/design/index.css` déjà présent :

```typescript
import "../src/design/tailwind.css";
```

(Lire `.storybook/preview.ts` avant d'éditer pour préserver l'import existant
et la config de backgrounds déjà en place — ne pas l'écraser.)

- [ ] **Step 6: Initialiser shadcn/ui**

```bash
npx shadcn@latest init
```

Répondre aux prompts CLI : style par défaut, `src/design/tailwind.css` comme
fichier CSS global, alias d'import `@/components`/`@/lib/utils` (confirmer
que `tsconfig.json` a bien l'alias `@/*` → `./src/*` ; si la CLI ne le propose
pas automatiquement, l'ajouter manuellement dans `tsconfig.json` avant de
relancer). Vérifier que `components.json` et `src/lib/utils.ts` ont été créés.

- [ ] **Step 7: Vérifier — aucune régression visuelle**

```bash
npm run storybook
```

Ouvrir `http://localhost:6006`, comparer visuellement les 3 stories
existantes (`ErrorBanner`, `Toolbar`, `BrushToolbar`) à leur état AVANT cette
tâche (aucun changement attendu — Tailwind est chargé mais rien ne l'utilise
encore). Arrêter le serveur après vérification.

```bash
npm run lint:tokens
```

Expected: même résultat qu'avant cette tâche (2 findings pré-existants,
documentés — pas de nouveau finding introduit par les fichiers créés ici).

- [ ] **Step 8: Commit**

```bash
cd C:\dev\shaderlab
git add package.json package-lock.json vite.config.ts tsconfig.json components.json src/lib/utils.ts src/design/tailwind.css src/design/tailwind-theme.css .storybook/preview.ts
git commit -m "feat(ui): ajoute Tailwind v4 + init shadcn/ui, thème mappé sur les tokens existants" -- package.json package-lock.json vite.config.ts tsconfig.json components.json src/lib/utils.ts src/design/tailwind.css src/design/tailwind-theme.css .storybook/preview.ts
```

---

## Task 2 : ErrorBanner → shadcn `Alert`

**Files:**
- Create: `src/components/ui/alert.tsx` (généré par la CLI shadcn)
- Modify: `src/components/ErrorBanner.tsx`
- Modify: `src/components/ErrorBanner.css` (suppression — remplacé par les classes Tailwind du composant shadcn)

**Interfaces:**
- Consumes: variables de Task 1 (`--color-destructive`, `--color-destructive-foreground`, `--radius-md`).
- Produces: `ErrorBanner({ message, onDismiss })` — signature de props INCHANGÉE (aucun appelant à modifier).

- [ ] **Step 1: Installer la primitive Alert**

```bash
npx shadcn@latest add alert
```

Expected: `src/components/ui/alert.tsx` créé (exporte `Alert`, `AlertTitle`,
`AlertDescription`).

- [ ] **Step 2: Réécrire ErrorBanner avec Alert**

Remplacer `src/components/ErrorBanner.tsx` :

```typescript
import { CircleAlert, X } from "lucide-react";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <Alert variant="destructive" role="alert" className="rounded-none border-x-0 border-t-0">
      <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4 pr-0">
        <span>{message}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fermer"
          onClick={onDismiss}
          className="size-6 shrink-0"
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

Note : `Button` (`src/components/ui/button.tsx`) sera généré à la Task 3 —
si Task 2 est exécutée seule sans Task 3, installer `button` en avance ici :

```bash
npx shadcn@latest add button
```

- [ ] **Step 3: Supprimer l'ancien CSS**

```bash
rm src/components/ErrorBanner.css
```

Vérifier qu'aucun autre fichier n'importe `ErrorBanner.css` :

```bash
grep -rn "ErrorBanner.css" src/
```

Expected: aucun résultat. Retirer l'import correspondant s'il en reste un
dans `ErrorBanner.tsx` (le nouveau fichier ci-dessus n'en a pas).

- [ ] **Step 4: Vérifier — Storybook + lint + app**

```bash
npm run storybook
```

Ouvrir la story `Components/ErrorBanner`, comparer les 2 variants (`Default`,
`LongMessage`) à l'état avant migration : même couleur danger, même icône,
bouton de fermeture toujours cliquable et positionné à droite. Arrêter le
serveur.

```bash
npm run lint:tokens
```

Expected: aucun nouveau finding (les classes Tailwind générées lisent les
tokens via `tailwind-theme.css`, pas de valeur en dur introduite).

```bash
npm run dev
```

Déclencher une erreur réelle dans l'app (ex. charger un fichier shader
invalide) pour confirmer que `ErrorBanner` s'affiche identiquement en
conditions réelles, pas seulement en story. Fermer l'app après vérification.

- [ ] **Step 5: Commit**

```bash
cd C:\dev\shaderlab
git add src/components/ErrorBanner.tsx src/components/ui/alert.tsx src/components/ui/button.tsx package.json package-lock.json
git rm src/components/ErrorBanner.css
git commit -m "feat(ui): migre ErrorBanner vers shadcn Alert" -- src/components/ErrorBanner.tsx src/components/ErrorBanner.css src/components/ui/alert.tsx src/components/ui/button.tsx package.json package-lock.json
```

(Si `button.tsx` a déjà été committé par la Task 3 au moment de cette tâche,
retirer sa mention de la commande `add`/`commit` ci-dessus.)

---

## Task 3 : Toolbar → shadcn `Button` + `DropdownMenu`

**Files:**
- Create: `src/components/ui/button.tsx` (si pas déjà créé par Task 2)
- Create: `src/components/ui/dropdown-menu.tsx` (généré par la CLI shadcn)
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/Toolbar.css` (suppression — remplacé par classes Tailwind, sauf `.toolbar` racine conservé pour la hauteur/fond si besoin)

**Interfaces:**
- Consumes: `Button` (`src/components/ui/button.tsx`, props shadcn standard : `variant`, `size`, `onClick`, `disabled`, `children`).
- Produces: `Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport, onOpenFile })` — signature de props INCHANGÉE.

**Constat technique (correction du design initial)** : le design de brainstorming évoquait `Button`+`ToggleGroup` pour `Toolbar`, mais le composant réel (`Toolbar.tsx` actuel) n'a PAS de toggle — il contient un menu déroulant "Fichier" (`Menu` existant) et 2 boutons icône (undo/redo). Mapping correct : `Button` (icon variant, ghost) pour undo/redo, `DropdownMenu` shadcn pour remplacer `Menu`. Aucun `ToggleGroup` nécessaire ici — ce composant en aurait eu besoin s'il avait un état actif/inactif à bascule, ce qui n'est pas le cas.

- [ ] **Step 1: Installer les primitives**

```bash
npx shadcn@latest add button dropdown-menu
```

Expected: `src/components/ui/button.tsx` (si absent) et
`src/components/ui/dropdown-menu.tsx` créés.

- [ ] **Step 2: Réécrire Toolbar**

Remplacer `src/components/Toolbar.tsx` :

```typescript
import { Download, FolderOpen, Redo2, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onOpenFile: () => void;
}

export function Toolbar({ canUndo, canRedo, onUndo, onRedo, onExport, onOpenFile }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Barre d'outils"
      className="flex items-center gap-4 min-h-[var(--toolbar-height)] px-4 py-3 bg-card border-b border-border"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Fichier</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onOpenFile}>
            <FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />
            Ouvrir
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport}>
            <Download size={16} strokeWidth={1.5} aria-hidden="true" />
            Exporter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Annuler"
        title="Annuler (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 size={16} strokeWidth={1.5} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Rétablir"
        title="Rétablir (Ctrl+Y)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={16} strokeWidth={1.5} aria-hidden="true" />
      </Button>
      <div className="flex-1" />
    </div>
  );
}
```

Note : `min-h-[var(--toolbar-height)]` référence directement le token CSS
existant (`--toolbar-height`, défini dans `src/design/components.css`) via la
syntaxe Tailwind arbitraire — cohérent avec la règle "pas de valeur en dur",
puisque ce n'est pas une valeur nouvelle mais une référence au token déjà là.

- [ ] **Step 3: Supprimer l'ancien CSS**

```bash
rm src/components/Toolbar.css
grep -rn "Toolbar.css" src/
```

Expected: aucun résultat après suppression.

- [ ] **Step 4: Vérifier — Storybook + lint + app**

```bash
npm run storybook
```

Ouvrir `Components/Toolbar`, comparer les 3 variants (`Default`,
`NothingToUndoOrRedo`, `CanRedo`) à l'état avant migration : undo/redo
grisés/actifs identiquement, menu "Fichier" toujours cliquable et affiche
Ouvrir/Exporter. Tester le clavier (Tab + Entrée sur le menu) — le
`DropdownMenu` shadcn doit rester accessible au clavier (c'est un des
comportements que Radix, la base de shadcn, garantit — à vérifier quand même
manuellement). Arrêter le serveur.

```bash
npm run lint:tokens
npm run dev
```

Vérifier dans l'app réelle que le menu Fichier ouvre/ferme correctement et
que les raccourcis Ctrl+Z/Ctrl+Y continuent de fonctionner (logique
inchangée, seule la présentation change). Fermer l'app.

- [ ] **Step 5: Commit**

```bash
cd C:\dev\shaderlab
git add src/components/Toolbar.tsx src/components/ui/button.tsx src/components/ui/dropdown-menu.tsx package.json package-lock.json
git rm src/components/Toolbar.css
git commit -m "feat(ui): migre Toolbar vers shadcn Button + DropdownMenu" -- src/components/Toolbar.tsx src/components/Toolbar.css src/components/ui/button.tsx src/components/ui/dropdown-menu.tsx package.json package-lock.json
```

---

## Task 4 : BrushToolbar → shadcn `Slider` + `Toggle` + `Button`

**Files:**
- Create: `src/components/ui/slider.tsx` (généré par la CLI shadcn)
- Create: `src/components/ui/toggle.tsx` (généré par la CLI shadcn)
- Modify: `src/components/BrushToolbar.tsx`
- Modify: `src/components/BrushToolbar.css` (conserver `.brush-toolbar`/`.brush-toolbar__control`/`.brush-toolbar__spacer` — mise en page propre au composant, pas des styles de primitive ; supprimer `.brush-toolbar__tool` si remplacé par des classes Tailwind)

**Interfaces:**
- Consumes: `Button` (Task 3), `Slider` et `Toggle` (nouveaux, cette tâche).
- Produces: `BrushToolbar({ brushSize, onBrushSizeChange, brushHardness, onBrushHardnessChange, erase, onEraseChange, onStop })` — signature de props INCHANGÉE.

**Constat technique** : le bouton "Gomme" actuel change de `variant` selon
`erase` (primary si actif, secondary sinon) — c'est exactement le pattern
qu'un composant `Toggle` shadcn modélise nativement (`pressed`/`onPressedChange`)
plutôt qu'un `Button` avec variant conditionnel. Le bouton "Terminer" reste un
`Button` classique (pas d'état toggle).

- [ ] **Step 1: Installer les primitives**

```bash
npx shadcn@latest add slider toggle
```

Expected: `src/components/ui/slider.tsx` et `src/components/ui/toggle.tsx`
créés.

- [ ] **Step 2: Réécrire BrushToolbar**

Remplacer `src/components/BrushToolbar.tsx` :

```typescript
import { Brush, Eraser } from "lucide-react";
import { Slider } from "./ui/slider";
import { Toggle } from "./ui/toggle";
import { Button } from "./ui/button";

interface Props {
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (v: number) => void;
  erase: boolean;
  onEraseChange: (v: boolean) => void;
  /** Sort du mode peinture (bouton « Terminer »). */
  onStop: () => void;
}

/**
 * Barre d'options du pinceau (style barre d'outils Photoshop) — affichée
 * uniquement en mode masque. Regroupe les réglages du pinceau (taille, dureté,
 * gomme) dans une surface horizontale visible, au lieu de les enfouir dans
 * l'inspecteur.
 */
export function BrushToolbar({
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  erase,
  onEraseChange,
  onStop,
}: Props) {
  return (
    <div className="brush-toolbar" role="toolbar" aria-label="Options du pinceau">
      <span className="brush-toolbar__tool">
        <Brush size={16} strokeWidth={1.5} aria-hidden="true" />
        Pinceau
      </span>
      <div className="brush-toolbar__control">
        <Slider
          aria-label="Taille"
          value={[brushSize]}
          min={2}
          max={200}
          onValueChange={([v]) => onBrushSizeChange(v)}
        />
      </div>
      <div className="brush-toolbar__control">
        <Slider
          aria-label="Dureté"
          value={[brushHardness]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => onBrushHardnessChange(v)}
        />
      </div>
      <Toggle pressed={erase} onPressedChange={onEraseChange} aria-label="Gomme">
        <Eraser size={16} strokeWidth={1.5} aria-hidden="true" />
        Gomme
      </Toggle>
      <div className="brush-toolbar__spacer" />
      <Button variant="secondary" onClick={onStop}>
        Terminer
      </Button>
    </div>
  );
}
```

Note : contrairement à l'ancien `Slider` maison (prop `label` affichant le
texte), le `Slider` shadcn/Radix n'affiche pas de label intégré — vérifier à
l'étape 4 si "Taille"/"Dureté" doivent réapparaître comme `<label>` visible à
côté du slider (régression visuelle potentielle sinon, pas juste
accessibilité). Si oui, ajouter :

```typescript
<div className="brush-toolbar__control">
  <span className="text-xs text-muted-foreground">Taille</span>
  <Slider aria-label="Taille" value={[brushSize]} min={2} max={200}
    onValueChange={([v]) => onBrushSizeChange(v)} />
</div>
```
(même correction pour "Dureté")

- [ ] **Step 3: Nettoyer le CSS**

Modifier `src/components/BrushToolbar.css` — retirer `.brush-toolbar__tool`
UNIQUEMENT si remplacé par des classes Tailwind à l'étape 2 ; sinon le
conserver tel quel. Garder `.brush-toolbar`, `.brush-toolbar__control`,
`.brush-toolbar__spacer` (mise en page propre au composant, indépendante de
shadcn).

- [ ] **Step 4: Vérifier — Storybook + lint + app**

```bash
npm run storybook
```

Ouvrir `Components/BrushToolbar`, comparer `Default` et `EraseMode` à l'état
avant migration : les 2 sliders réagissent au drag/clavier (flèches), le
bouton Gomme bascule visuellement d'état (pressed/non-pressed), "Terminer"
inchangé. Vérifier spécifiquement si les labels "Taille"/"Dureté" sont
toujours visibles (cf. note Step 2). Arrêter le serveur.

```bash
npm run lint:tokens
npm run dev
```

Activer le mode masque dans l'app réelle, peindre avec le pinceau, ajuster
taille/dureté via les sliders, basculer la gomme — confirmer que le
comportement de peinture (pas seulement l'apparence) reste identique. Fermer
l'app.

- [ ] **Step 5: Commit**

```bash
cd C:\dev\shaderlab
git add src/components/BrushToolbar.tsx src/components/BrushToolbar.css src/components/ui/slider.tsx src/components/ui/toggle.tsx package.json package-lock.json
git commit -m "feat(ui): migre BrushToolbar vers shadcn Slider + Toggle + Button" -- src/components/BrushToolbar.tsx src/components/BrushToolbar.css src/components/ui/slider.tsx src/components/ui/toggle.tsx package.json package-lock.json
```

---

## Self-Review (fait à l'écriture de ce plan)

- **Couverture spec** : les 4 tranches du design (`2026-07-20-shadcn-migration-design.md`) sont toutes couvertes une tâche = une tranche. Hors-scope (`Inspector`/`LayerPanel`/`ParamPanel`/`Canvas`) explicitement non touché, conforme au design.
- **Placeholders** : aucun "TBD"/"TODO" — les deux points d'incertitude réelle (label visible du Slider Task 4, ordre `button.tsx` si Task 2/3 exécutées hors ordre) sont explicités avec la marche à suivre concrète, pas laissés en blanc.
- **Cohérence de types** : `ErrorBanner`/`Toolbar`/`BrushToolbar` gardent leurs signatures de props exactes d'une tâche à l'autre (vérifié contre le code source actuel, pas supposé) — aucun appelant externe (où ces composants sont montés) n'a besoin de changer.
- **Constats corrigés vs. design initial** : Toolbar n'a pas de `ToggleGroup` (mapping `DropdownMenu` correct à la place) ; BrushToolbar a un vrai candidat `Toggle` (le bouton Gomme) que le design n'avait pas anticipé précisément — les deux corrections sont documentées inline dans les tâches concernées, pas silencieuses.

---

**Plan complet et sauvegardé dans `docs/superpowers/plans/2026-07-20-shadcn-migration.md`.**

Deux options d'exécution :

1. **Subagent-Driven (recommandé)** — je dispatche un sous-agent frais par tâche, review entre chaque tâche, itération rapide.
2. **Exécution inline** — j'exécute les tâches dans cette session via `executing-plans`, par lot avec points de contrôle.

Laquelle ?
