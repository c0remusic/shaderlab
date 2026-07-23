# Visibilité de l'overlay masque + lisibilité du panneau Masque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'overlay de masque (rouge + contour animé) contrôlable — masquable manuellement, et auto-affiché seulement pendant qu'on travaille réellement dessus — et rendre le panneau Masque plus lisible (icônes de visibilité, indicateur clair de la source active).

**Architecture:** Deux points d'entrée modifiés : `App.tsx` (dérivation de `showOverlay`, déjà consommée par l'effet qui pilote `Renderer.setMaskOverlay`/`OverlayAnimationLoop` — non touché par ce plan) et `MaskPanel.tsx` (présentation). Aucun nouveau composant, aucune modification du moteur de rendu (déjà livré).

**Tech Stack:** React 19 + TS, `lucide-react` (icônes), Base UI (`IconButton`/`Checkbox`/`Disclosure` existants), Vitest.

## Global Constraints

- Aucun composant React n'est testé unitairement dans ce projet (convention existante) — la preuve de chaque tâche touchant `App.tsx`/`MaskPanel.tsx` est `tsc --noEmit` + `npm run test` (non-régression) + le checkpoint visuel humain de la Task 3.
- Toutes les couleurs/espacements référencent des tokens existants (`src/design/*.css`) — jamais de valeur en dur.
- `git commit` toujours avec pathspec explicite (`git commit -m "..." -- <fichiers>`), jamais nu.
- Preuve UI = CDP sur la fenêtre WebView2 réelle (Playwright headless inadapté, canvas WebGPU) — voir `CLAUDE.md` § Moyen de preuve.

---

### Task 1: Panneau Masque — icônes de visibilité, indicateur de source active, bouton "Masquer l'overlay"

**Files:**
- Modify: `src/components/MaskPanel.tsx`
- Modify: `src/components/ParamPanel.css`
- Modify: `src/App.tsx:467-496` (état `overlayForceHidden` + câblage des 2 nouveaux props sur l'appel à `MaskPanel`)

**Interfaces:**
- Consumes: `IconButton` (`src/components/ui/icon-button.tsx`, props `label`/`tooltip`/`size`/`variant`/`className`/`onClick`/`children`), icônes `Eye`/`EyeOff` de `lucide-react`.
- Produces: `MaskPanel` props étendues avec `overlayForceHidden: boolean` et `onToggleOverlayForceHidden: () => void` — consommées par Task 2 (qui affine la dérivation de `showOverlay` dans `App.tsx` mais réutilise ces deux props telles quelles).

- [ ] **Step 1: Ajouter les imports d'icônes dans `MaskPanel.tsx`**

Remplacer :

```tsx
import { Trash2 } from "lucide-react";
```

par :

```tsx
import { Trash2, Eye, EyeOff } from "lucide-react";
```

- [ ] **Step 2: Étendre l'interface `Props`**

Dans `src/components/MaskPanel.tsx`, remplacer :

```tsx
interface Props {
  layer: LayerState | null;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
```

par :

```tsx
interface Props {
  layer: LayerState | null;
  maskPaintMode: boolean;
  onToggleMaskPaint: () => void;
  overlayForceHidden: boolean;
  onToggleOverlayForceHidden: () => void;
```

- [ ] **Step 3: Recevoir les 2 nouveaux props dans la signature du composant**

Remplacer :

```tsx
export function MaskPanel({
  layer,
  maskPaintMode,
  onToggleMaskPaint,
  onAddMaskSource,
```

par :

```tsx
export function MaskPanel({
  layer,
  maskPaintMode,
  onToggleMaskPaint,
  overlayForceHidden,
  onToggleOverlayForceHidden,
  onAddMaskSource,
```

- [ ] **Step 4: Ajouter la ligne "Masquer l'overlay" en tête de section**

Remplacer :

```tsx
      <Disclosure title="Masque" defaultOpen>
        <div className="param-panel__group">
          {maskPaintMode ? (
```

par :

```tsx
      <Disclosure title="Masque" defaultOpen>
        <div className="param-panel__group">
          <div className="param-panel__visibility-row">
            <IconButton
              label={overlayForceHidden ? "Afficher l'overlay" : "Masquer l'overlay"}
              tooltip={overlayForceHidden ? "Afficher l'overlay" : "Masquer l'overlay"}
              onClick={onToggleOverlayForceHidden}
              className={overlayForceHidden ? undefined : "param-panel__visibility-icon--on"}
            >
              {overlayForceHidden ? (
                <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
              ) : (
                <Eye className="icon-sm icon-stroke" aria-hidden="true" />
              )}
            </IconButton>
            <span className="param-panel__visibility-label">
              {overlayForceHidden ? "Overlay masqué" : "Overlay visible"}
            </span>
          </div>
          {maskPaintMode ? (
```

- [ ] **Step 5: Remplacer la checkbox "Masque actif" par une icône de visibilité**

Remplacer :

```tsx
          <div className="param-panel__mask-toggles">
            <Checkbox
              label="Masque actif"
              checked={layer.mask.enabled}
              onChange={(enabled) => onMaskEnabledChange(layer.id, enabled)}
            />
            <Checkbox
              label="Inverser"
              checked={layer.mask.invert}
              onChange={(invert) => onMaskInvertChange(layer.id, invert)}
            />
          </div>
```

par :

```tsx
          <div className="param-panel__mask-toggles">
            <div className="param-panel__visibility-row">
              <IconButton
                label={layer.mask.enabled ? "Désactiver le masque" : "Activer le masque"}
                tooltip="Masque actif"
                onClick={() => onMaskEnabledChange(layer.id, !layer.mask.enabled)}
                className={layer.mask.enabled ? "param-panel__visibility-icon--on" : undefined}
              >
                {layer.mask.enabled ? (
                  <Eye className="icon-sm icon-stroke" aria-hidden="true" />
                ) : (
                  <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
                )}
              </IconButton>
              <span className="param-panel__visibility-label">Masque actif</span>
            </div>
            <Checkbox
              label="Inverser"
              checked={layer.mask.invert}
              onChange={(invert) => onMaskInvertChange(layer.id, invert)}
            />
          </div>
```

- [ ] **Step 6: Remplacer la checkbox "Actif" par source + ajouter le badge "EN COURS"**

Remplacer :

```tsx
                  <li
                    key={source.id}
                    className={`param-panel__source-row ${
                      source.id === activeSourceId ? "param-panel__source-row--active" : ""
                    }`.trim()}
                  >
                    <Checkbox
                      label="Actif"
                      checked={source.enabled}
                      onChange={(enabled) => onMaskSourceEnabledChange(layer.id, source.id, enabled)}
                    />
                    <button
                      type="button"
                      className="param-panel__source-name"
                      onClick={() => setSelectedSourceId(source.id)}
                    >
                      {module.name}
                    </button>
                    <Select
```

par :

```tsx
                  <li
                    key={source.id}
                    className={`param-panel__source-row ${
                      source.id === activeSourceId ? "param-panel__source-row--active" : ""
                    }`.trim()}
                  >
                    <IconButton
                      label={source.enabled ? "Désactiver la source" : "Activer la source"}
                      tooltip="Actif"
                      onClick={() => onMaskSourceEnabledChange(layer.id, source.id, !source.enabled)}
                      className={source.enabled ? "param-panel__visibility-icon--on" : undefined}
                    >
                      {source.enabled ? (
                        <Eye className="icon-sm icon-stroke" aria-hidden="true" />
                      ) : (
                        <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />
                      )}
                    </IconButton>
                    <button
                      type="button"
                      className="param-panel__source-name"
                      onClick={() => setSelectedSourceId(source.id)}
                    >
                      {module.name}
                    </button>
                    {source.id === activeSourceId && (
                      <span className="param-panel__source-active-badge">EN COURS</span>
                    )}
                    <Select
```

- [ ] **Step 7: Ajouter le titre "Réglages · <source>" au-dessus des sliders**

Remplacer :

```tsx
          {activeSource && activeSource.params && (
            <div className="param-panel__source-params">
              {Object.entries(activeSource.params).map(([key, value]) => {
```

par :

```tsx
          {activeSource && activeSource.params && (
            <div className="param-panel__source-params">
              <p className="param-panel__source-params-title">
                Réglages · {getMaskSourceModule(activeSource.type).name}
              </p>
              {Object.entries(activeSource.params).map(([key, value]) => {
```

- [ ] **Step 8: Ajouter les styles CSS**

Dans `src/components/ParamPanel.css`, ajouter à la fin du fichier :

```css
.param-panel__visibility-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.param-panel__visibility-label {
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.param-panel__visibility-icon--on {
  color: var(--text-primary);
}

.param-panel__source-row--active .param-panel__source-name {
  font-weight: var(--font-weight-medium);
}

.param-panel__source-active-badge {
  font-family: var(--font-ui);
  font-size: 10px;
  color: var(--text-tertiary);
  letter-spacing: .05em;
  white-space: nowrap;
}

.param-panel__source-params-title {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
```

- [ ] **Step 9: Câbler `overlayForceHidden` dans `App.tsx`**

Trouver l'état existant (juste après `const [maskCollapsed, setMaskCollapsed] = useState(false);`, ligne 66) et ajouter juste après :

```tsx
  const [overlayForceHidden, setOverlayForceHidden] = useState(false);
```

Puis, dans le bloc de dérivation de `showOverlay` (`App.tsx:479-480`), remplacer :

```tsx
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const showOverlay = maskPaintMode || hasActiveMask;
```

par :

```tsx
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const showOverlay = !overlayForceHidden && (maskPaintMode || hasActiveMask);
```

Enfin, dans l'appel à `<MaskPanel ...>` (`App.tsx:557-572`), ajouter les 2 nouveaux props juste après `onToggleMaskPaint` :

```tsx
              onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
              overlayForceHidden={overlayForceHidden}
              onToggleOverlayForceHidden={() => setOverlayForceHidden((v) => !v)}
```

- [ ] **Step 10: Vérification statique**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 11: Lancer la suite complète**

Run: `npm run test`
Expected: tous les tests passent (aucune régression — aucun test ne couvre `MaskPanel`/`App.tsx`, cf. Global Constraints).

- [ ] **Step 12: Commit**

```bash
git add src/components/MaskPanel.tsx src/components/ParamPanel.css src/App.tsx
git commit -m "feat(ui): replace mask visibility checkboxes with icon toggles, add active-source indicator and manual overlay hide" -- src/components/MaskPanel.tsx src/components/ParamPanel.css src/App.tsx
```

---

### Task 2: Auto-affichage de l'overlay lié au focus du panneau Masque + délai de grâce

**Files:**
- Modify: `src/App.tsx:467-496`

**Interfaces:**
- Consumes: `maskCollapsed` (état existant, `App.tsx:66`), `overlayForceHidden`/`hasActiveMask` (Task 1).
- Produces: nouvelle dérivation de `showOverlay` consommée sans changement par l'effet existant `App.tsx:482-496` (`Renderer.setMaskOverlay`/`OverlayAnimationLoop`) — aucune signature externe nouvelle, ce ne sont que des variables locales à `App.tsx`.

- [ ] **Step 1: Remplacer le bloc de dérivation de `showOverlay`**

Remplacer (bloc entier, commentaire inclus) :

```tsx
  // Overlay du masque (rouge + contour animé) : visible dès qu'un calque
  // sélectionné a un masque actif (mode peinture OU au moins une source
  // active) — pas seulement en mode peinture comme avant, pour couvrir
  // l'édition des sources dégradé/luminosité/range couleur qui ne passe
  // jamais par le pinceau. Voir
  // docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md.
  // showOverlay est un booléen stable (pas `layers` en dépendance) pour que
  // l'effet ne se redéclenche pas à chaque frame d'un drag de slider — seul
  // un vrai changement "montrer/cacher" redémarre la boucle rAF.
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const showOverlay = !overlayForceHidden && (maskPaintMode || hasActiveMask);
```

par :

```tsx
  // Overlay du masque (rouge + contour animé) : affiché tant qu'on travaille
  // réellement sur le masque du calque sélectionné (panneau Masque ouvert OU
  // pinceau actif) ET qu'il y a un masque actif à montrer — pas en continu
  // dès qu'un masque existe (bruit visuel pendant qu'on règle un autre
  // aspect du calque). `overlayForceHidden` (Task 1) reste prioritaire :
  // un utilisateur qui veut juger le rendu final sans quitter le panneau
  // doit pouvoir l'éteindre explicitement. Voir
  // docs/superpowers/specs/2026-07-23-shaderlab-mask-overlay-visibility-design.md.
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const wantsOverlay = (!maskCollapsed || maskPaintMode) && hasActiveMask && !!selectedId;

  // Délai de grâce de 750ms avant extinction : quand on ferme le panneau
  // Masque, change de calque, ou que le calque perd son masque actif,
  // `wantsOverlay` passe à `false` immédiatement — mais `graceVisible` ne
  // suit qu'après ce délai, pour laisser voir le résultat se stabiliser
  // plutôt qu'une coupure brutale. Annulé (`clearTimeout`) si `wantsOverlay`
  // redevient `true` avant l'échéance (ex: on rouvre le panneau vite).
  const [graceVisible, setGraceVisible] = useState(wantsOverlay);
  useEffect(() => {
    if (wantsOverlay) {
      setGraceVisible(true);
      return;
    }
    const timer = setTimeout(() => setGraceVisible(false), 750);
    return () => clearTimeout(timer);
  }, [wantsOverlay]);

  const showOverlay = !overlayForceHidden && graceVisible;
```

- [ ] **Step 2: Vérification statique**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lancer la suite complète**

Run: `npm run test`
Expected: tous les tests passent (aucune régression).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): auto-show the mask overlay only while the Masque panel is focused, with a grace period on exit" -- src/App.tsx
```

---

### Task 3: Checkpoint visuel humain (CONDITION DE SORTIE NON NÉGOCIABLE)

**Files:** aucun — vérification uniquement.

**Interfaces:** aucune (tâche de validation, pas de code).

Ce comportement est temporel (délai de grâce, transitions) et visuel (icônes, badge, en-tête) — non vérifiable par un test automatisé. Suit le protocole CDP déjà établi sur ce chantier (fenêtre WebView2 réelle, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, voir `CLAUDE.md` § Moyen de preuve). Sous-agents headless : ne PAS tenter de juger visuellement, ce checkpoint revient à un humain.

- [ ] **Step 1: Lancer l'app en mode debug**

Run: `npm run dev:debug` (tue toute instance `shaderlab.exe` existante — vérifier `Get-Process -Name shaderlab` avant si d'autres lignes de travail sont actives).

- [ ] **Step 2: Vérifier via CDP l'absence d'exception au démarrage**

Se connecter au WebSocket CDP (`ws://localhost:9222/devtools/page/<id>`, liste des cibles sur `http://localhost:9222/json`), écouter `Runtime.exceptionThrown` sur quelques secondes.
Expected: aucune exception.

- [ ] **Step 3: Checkpoint humain — comportement de visibilité**

Demander confirmation visuelle humaine sur :
1. Charger une image, sélectionner un calque, ajouter une source de masque (ex: plage de couleur) — l'overlay (rouge + contour animé) doit s'afficher tant que le panneau Masque reste ouvert.
2. Fermer le panneau Masque (collapse) — l'overlay doit rester visible ~0.75s puis disparaître.
3. Rouvrir le panneau avant la fin du délai — l'overlay ne doit jamais avoir disparu (annulation du timer).
4. Cliquer l'icône "Masquer l'overlay" en tête du panneau — l'overlay doit disparaître immédiatement, même panneau ouvert. Re-cliquer — il doit réapparaître.
5. Avec 2 sources ajoutées sur le même masque (ex: pinceau + plage de couleur), vérifier que la ligne active affiche bien le badge "EN COURS", le nom en gras, et que les sliders affichés sous "Réglages · <nom>" changent bien quand on clique l'autre source.
6. Vérifier que les icônes œil (Masque actif, par source) togglent visuellement (icône barrée) quand on les clique, et que "Inverser"/"Accroché aux contours (edge-aware)" sont restées en checkbox classique.

Expected: les 6 points confirmés visuellement par l'utilisateur. Si un point échoue → STOP, revenir en investigation (`superpowers:systematic-debugging`), pas de fix à l'aveugle.

- [ ] **Step 4: Mettre à jour le ledger**

Ajouter dans `.superpowers/sdd/progress.md` (fichier scratch gitignoré, pas de commit associé) : statut de chaque tâche de ce plan, résultat du checkpoint visuel.
