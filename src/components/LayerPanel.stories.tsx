import type { ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { LayerPanel } from "./LayerPanel";
import { defaultLayerMask } from "../mask/types";
import type { LayerState } from "../layers/types";

function makeLayer(overrides: Partial<LayerState>): LayerState {
  return {
    id: "layer-1",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

const layers: LayerState[] = [
  makeLayer({ id: "layer-1", effectId: "glow", opacity: 1 }),
  makeLayer({ id: "layer-2", effectId: "chromaticBleed", opacity: 0.6, enabled: false }),
  makeLayer({ id: "layer-3", effectId: "grain", opacity: 0.35, blendMode: "screen" }),
];

const effectCycle = ["glow", "chromaticBleed", "warp", "grain"];
const manyLayers: LayerState[] = Array.from({ length: 8 }, (_, i) =>
  makeLayer({
    id: `layer-${i + 1}`,
    effectId: effectCycle[i % effectCycle.length],
    opacity: 1 - i * 0.1,
    enabled: i % 3 !== 0,
  })
);

const meta: Meta<typeof LayerPanel> = {
  title: "Components/LayerPanel",
  component: LayerPanel,
  args: {
    layers,
    selectedId: "layer-1",
    hasImage: true,
    onSelect: () => {},
    onToggle: () => {},
    onAdd: () => {},
    onDuplicate: () => {},
    onRemove: () => {},
    onReorder: () => {},
    onToggleLock: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LayerPanel>;

export const Default: Story = {};

export const Empty: Story = {
  args: { layers: [], selectedId: null },
};

export const NoImageLoaded: Story = {
  args: { hasImage: false },
};

export const SecondSelected: Story = {
  args: { selectedId: "layer-2" },
};

export const ManyLayers: Story = {
  args: { layers: manyLayers, selectedId: "layer-3" },
};

// SENS D'AFFICHAGE (ADR-0004, 2026-07-28) : la liste se lit de haut en bas dans
// l'ordre du TRAITEMENT. `layers[0]` est le calque appliqué EN PREMIER sur la
// photo de fond — il s'affiche en PREMIÈRE ligne de calque, juste sous la ligne
// d'arrière-plan qu'il consomme. C'est le seul test qui verrouille ce sens :
// s'il tombe, un dépôt de glisser-déposer atterrira à l'envers.
export const StackOrderIsCausal: Story = {
  args: { backgroundName: "DSC_0042.jpg" },
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll("[data-layer-row-index]"));
    await expect(rows.map((row) => row.getAttribute("data-layer-row-index"))).toEqual(["0", "1", "2"]);
    // layers = [glow, chromaticBleed, grain] ⇒ lignes [Glow, Chromatic bleed, Grain].
    await expect(rows.map((row) => row.querySelector(".layer-panel__row-name")?.textContent)).toEqual([
      "Glow",
      "Chromatic bleed",
      "Grain",
    ]);
    // La ligne d'arrière-plan OUVRE la liste, AU-DESSUS du calque qu'elle
    // alimente (`layers[0]`, ici Glow) : la matière avant les opérations.
    const allRows = Array.from(canvasElement.querySelectorAll(".layer-panel__row"));
    await expect(allRows[0].className).toContain("layer-panel__row--background");
  },
};

// Ligne d'ARRIÈRE-PLAN : le document lui-même, dérivé de son chemin, en TÊTE de
// liste depuis l'ADR-0004. Verrouillé — ni œil, ni poignée, ni actions.
export const WithBackground: Story = {
  args: { backgroundName: "DSC_0042.jpg" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("DSC_0042.jpg")).toBeTruthy();
    await expect(canvas.getByRole("img", { name: "Arrière-plan verrouillé" })).toBeTruthy();
  },
};

// Écrêtage : la ligne écrêtée porte une flèche vers son calque de base — celui
// appliqué AVANT elle, donc, en sens causal (ADR-0004), la ligne JUSTE
// AU-DESSUS dans cette liste. Elle n'est PLUS indentée
// (observation Photoshop web §5ter) : elle est ici SÉLECTIONNÉE pour vérifier
// que le marquage couvre la ligne entière, alignée sur ses voisines.
const clippedLayers: LayerState[] = [
  makeLayer({
    id: "layer-1",
    effectId: "passthrough",
    imageSource: { sourceId: "photo-1" },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    name: "plage.jpg",
  }),
  makeLayer({ id: "layer-2", effectId: "glow", clipToBelow: true }),
  makeLayer({ id: "layer-3", effectId: "grain" }),
];

export const ClippedLayerSelected: Story = {
  args: { layers: clippedLayers, selectedId: "layer-2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("img", { name: "Écrêté sur le calque du dessus" })).toBeTruthy();
  },
};

// Écrêtage SANS BASE : `clipToBelow` est posé sur `layers[0]`, le bas de pile —
// il n'y a rien en dessous. `resolveClipping` rend ce cas `inert` (le calque
// rend linéairement) et la flèche ne doit PAS apparaître : elle désignerait une
// base inexistante. La ligne reste écrêtable/décochable, seul l'affichage suit
// l'état résolu.
const clippedWithoutBase: LayerState[] = [
  makeLayer({ id: "layer-1", effectId: "glow", clipToBelow: true }),
  makeLayer({ id: "layer-2", effectId: "grain" }),
];

export const ClippedWithoutBaseShowsNoArrow: Story = {
  args: { layers: clippedWithoutBase, selectedId: "layer-1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("img", { name: "Écrêté sur le calque du dessus" })).not.toBeInTheDocument();
  },
};

// IMBRICATION (2026-07-28) — DIVERGENCE ASSUMÉE d'avec Photoshop, qui
// n'indente rien (observations §5ter). La RÈGLE est testée unitairement
// (test/components/layerTree.test.ts) ; ces stories ne vérifient que son
// RENDU : quelles lignes portent la classe d'indentation et le filet.
//
// Pile : P (photo) · A (effet libre, une seule photo dessous → enfant de P) ·
// Q (photo) · B (effet libre, DEUX photos dessous → reste à plat).
const twoPhotoLayers: LayerState[] = [
  makeLayer({ id: "photo-P", effectId: "passthrough", name: "plage.jpg", imageSource: { sourceId: "s-P" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
  makeLayer({ id: "layer-A", effectId: "glow" }),
  makeLayer({ id: "photo-Q", effectId: "passthrough", name: "ciel.jpg", imageSource: { sourceId: "s-Q" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
  makeLayer({ id: "layer-B", effectId: "grain" }),
];

export const NestedUnderPhoto: Story = {
  args: { layers: twoPhotoLayers, selectedId: "layer-A", backgroundName: "DSC_0042.jpg" },
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll("[data-layer-row-index]"));
    // Affichage : plage.jpg · Glow (imbriqué sous elle) · ciel.jpg · Grain (à plat).
    await expect(rows.map((r) => r.querySelector(".layer-panel__row-name")?.textContent)).toEqual([
      "plage.jpg",
      "Glow",
      "ciel.jpg",
      "Grain",
    ]);
    await expect(rows.map((r) => r.classList.contains("layer-panel__row--nested"))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    // Un seul filet, sur l'unique ligne enfant — et il est décoratif.
    const rails = canvasElement.querySelectorAll(".layer-panel__rail");
    await expect(rails).toHaveLength(1);
    await expect(rails[0].getAttribute("aria-hidden")).toBe("true");
    // Enfant unique : le filet porte les deux bornes du groupe.
    await expect(rails[0].className).toContain("layer-panel__rail--first");
    await expect(rails[0].className).toContain("layer-panel__rail--last");
    // AUCUN marquage inventé sur la ligne à plat qui touche les deux photos
    // (Grain, dernière ligne : deux photos sont appliquées avant lui).
    await expect(rows[3].className).not.toContain("nested");
  },
};

// L'index de LIGNE reste celui de l'ordre d'affichage plat : c'est lui que le
// glisser-déposer utilise pour son hit-test, et l'imbrication ne doit pas le
// décaler. S'il bouge, un dépôt atterrit au mauvais endroit du modèle.
export const NestingDoesNotShiftRowIndexes: Story = {
  args: { layers: twoPhotoLayers, selectedId: "layer-A" },
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll("[data-layer-row-index]"));
    await expect(rows.map((r) => r.getAttribute("data-layer-row-index"))).toEqual(["0", "1", "2", "3"]);
  },
};

// Parité calque photo (T1) : la ligne d'un calque photo affiche son NOM de
// fichier et sa vignette, plus « Passthrough ». La vignette est une object
// URL résolue par `thumbnailUrl` (possédée par PhotoSourceStore côté App) —
// ici un data URI 1x1 pour rester autonome, aucun raster en props.
const PHOTO_THUMB =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const photoLayers: LayerState[] = [
  makeLayer({
    id: "photo-layer",
    effectId: "passthrough",
    name: "IMG_1234.jpg",
    imageSource: { sourceId: "photo-1" },
    transform: { x: 100, y: 100, scale: 1, rotation: 0 },
  }),
  makeLayer({ id: "layer-2", effectId: "glow" }),
];

export const PhotoLayerNamedWithThumbnail: Story = {
  args: {
    layers: photoLayers,
    selectedId: "photo-layer",
    thumbnailUrl: () => PHOTO_THUMB,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("IMG_1234.jpg")).toBeInTheDocument();
    await expect(canvas.queryByText("Passthrough")).not.toBeInTheDocument();
  },
};

export const PhotoLayerWithoutThumbnail: Story = {
  args: {
    layers: photoLayers,
    selectedId: "photo-layer",
    thumbnailUrl: () => null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // La vignette peut manquer ; le nom, lui, reste toujours affiché.
    await expect(canvas.getByText("IMG_1234.jpg")).toBeInTheDocument();
  },
};

// --- Interaction tests (play) ---

export const ClickLayerSelects: Story = {
  args: { selectedId: "layer-1", onSelect: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Clicking the row name bubbles to the <li> onClick → onSelect(id).
    // Pas d'ambiguïté de texte : depuis 2026-07-27 les lignes ne portent plus
    // aucun sélecteur, seul le nom du calque porte ce libellé.
    await userEvent.click(canvas.getByText("Chromatic bleed"));
    await expect(args.onSelect).toHaveBeenCalledWith("layer-2");
  },
};

export const ToggleVisibility: Story = {
  args: { onToggle: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // layer-2 is disabled → its toggle is uniquely labeled "Afficher le calque".
    await userEvent.click(canvas.getByRole("button", { name: "Afficher le calque" }));
    // `altKey` = false : clic simple, bascule normale (voir eyeClickOutcome).
    await expect(args.onToggle).toHaveBeenCalledWith("layer-2", false);
  },
};

// Isolation (Alt+clic sur l'œil) : état d'AFFICHAGE seulement — `layers` est
// inchangé (layer-2 y reste `enabled: false`), seule la visibilité effective
// affichée par les icônes/libellés change. Le geste étant invisible, le libellé
// du bouton est le porteur de l'affordance de SORTIE.
export const IsolatedLayer: Story = {
  args: { isolatedLayerId: "layer-3", onToggle: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Les trois lignes annoncent la sortie d'isolation, y compris celle du
    // calque isolé : pendant l'isolation, un clic simple ne bascule rien.
    const exits = canvas.getAllByRole("button", { name: "Quitter l'isolation" });
    await expect(exits).toHaveLength(3);
    // La PREMIÈRE ligne est le calque appliqué en PREMIER depuis le sens causal
    // (ADR-0004) : `layers[0]`, donc layer-1.
    await userEvent.click(exits[0]);
    await expect(args.onToggle).toHaveBeenCalledWith("layer-1", false);
  },
};

// Alt+clic sur l'œil d'un calque : le composant ne décide de rien, il
// transmet le modificateur — c'est `eyeClickOutcome` qui tranche (testé
// unitairement, aucun test ne rend de composant React sur ce projet).
export const AltClickRequestsIsolation: Story = {
  args: { onToggle: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // `fireEvent` et non `userEvent` : le modificateur doit être porté par
    // l'événement de clic lui-même (`e.altKey`), ce que l'état clavier de
    // userEvent ne propage pas au clic dans ce runner.
    fireEvent.click(canvas.getByRole("button", { name: "Afficher le calque" }), { altKey: true });
    await expect(args.onToggle).toHaveBeenCalledWith("layer-2", true);
  },
};

// Le sélecteur d'effet a quitté les lignes pour la zone de contrôles
// centralisée (2026-07-27) : son test d'interaction vit dans
// `LayerControls.stories.tsx`. La liste ne doit plus en exposer aucun.
export const NoPerRowControls: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByRole("combobox", { name: "Effet" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("combobox", { name: "Fusion" })).toHaveLength(0);
    await expect(canvas.queryAllByRole("slider", { name: "Opacité" })).toHaveLength(0);
    // L'opacité reste LISIBLE sur chaque ligne (valeur seule, non éditable).
    await expect(canvas.getByText("35 %")).toBeInTheDocument();
  },
};

export const DuplicateLayer: Story = {
  args: { onDuplicate: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const duplicateButtons = canvas.getAllByRole("button", { name: "Dupliquer le calque" });
    // Première ligne = premier calque appliqué = `layers[0]` (sens causal, ADR-0004).
    await userEvent.click(duplicateButtons[0]);
    await expect(args.onDuplicate).toHaveBeenCalledWith("layer-1");
  },
};

// --- Alignement des colonnes (2026-07-29) ---

// LE test qui manquait. Le défaut qu'il attrape : les éléments de la ligne
// étaient posés bout à bout dans un flex avec DEUX enfants conditionnels au
// milieu (flèche d'écrêtage, vignette), donc un effet simple avait 4 éléments
// avant son nom, une photo 5, un effet écrêté 5 — et le nom ne tombait jamais à
// la même abscisse d'une ligne à l'autre. Aucun test ne le voyait : les stories
// existantes vérifient des PRÉSENCES (texte, rôle, classe), jamais une position.
//
// Les QUATRE formes de ligne, empilées dans un seul panneau :
//   1. arrière-plan   (rendu séparé, `backgroundName`)
//   2. photo          (`imageSource` -> vignette)
//   3. photo          (une seconde, pour que l'effet simple reste à plat)
//   4. effet ÉCRÊTÉ   (flèche coudée ; imbriqué sous sa base, cf. layerTree.ts)
//   5. effet simple   (deux photos en dessous -> reste à plat)
const allRowForms: LayerState[] = [
  makeLayer({ id: "photo-P", effectId: "passthrough", name: "plage.jpg", imageSource: { sourceId: "s-P" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
  makeLayer({ id: "photo-Q", effectId: "passthrough", name: "ciel.jpg", imageSource: { sourceId: "s-Q" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
  makeLayer({ id: "effet-clip", effectId: "glow", clipToBelow: true }),
  makeLayer({ id: "effet-simple", effectId: "grain" }),
];

/** Largeur RÉELLE du dock (`--inspector-width-default`, src/design/components.css),
 *  posée sur le conteneur de la story : mesurer l'alignement dans un canvas de
 *  1000 px ne prouverait rien sur la colonne où le panneau vit vraiment, et ne
 *  verrait pas un débordement horizontal. */
const dockWidthDecorator = (Story: () => ReactElement) => (
  <div style={{ width: "var(--inspector-width-default)" }}>
    <Story />
  </div>
);

export const AllRowFormsShareOneGrid: Story = {
  args: {
    layers: allRowForms,
    selectedId: null,
    backgroundName: "DSC_0042.jpg",
    thumbnailUrl: () => PHOTO_THUMB,
  },
  decorators: [dockWidthDecorator],
  play: async ({ canvasElement }) => {
    const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>(".layer-panel__row"));
    // Les cinq lignes sont bien là, dans l'ordre attendu (arrière-plan en tête,
    // ADR-0004) : sans ça, les mesures ci-dessous porteraient sur autre chose.
    await expect(rows).toHaveLength(5);
    await expect(rows[0].className).toContain("layer-panel__row--background");
    await expect(rows.map((r) => r.querySelector(".layer-panel__row-name")?.textContent)).toEqual([
      "DSC_0042.jpg",
      "plage.jpg",
      "ciel.jpg",
      "Glow",
      "Grain",
    ]);
    // Les quatre formes sont réellement représentées — un témoin qui retirerait
    // la vignette ou la flèche ferait tomber CE bloc avant les mesures.
    await expect(canvasElement.querySelectorAll(".layer-panel__thumbnail")).toHaveLength(3); // 2 photos + arrière-plan
    await expect(canvasElement.querySelectorAll(".layer-panel__clip-arrow")).toHaveLength(1);

    // ---- L'INVARIANT DE GRILLE ----
    // Le nom démarre au MÊME décalage à l'intérieur de la grille d'identité,
    // sur les cinq lignes. C'est ce que la grille garantit, et c'est ce que le
    // flex ne garantissait pas. Mesuré relativement à `.layer-panel__row-main`
    // pour rester vrai malgré l'indentation d'imbrication (voir plus bas).
    const offsets = rows.map((row) => {
      const main = row.querySelector<HTMLElement>(".layer-panel__row-main");
      const name = row.querySelector<HTMLElement>(".layer-panel__row-name");
      if (!main || !name) throw new Error("ligne sans grille d'identité ou sans nom");
      return Math.round(name.getBoundingClientRect().left - main.getBoundingClientRect().left);
    });
    await expect(new Set(offsets).size).toBe(1);

    // ---- CE QUE L'UTILISATEUR VOIT ----
    // Abscisse ABSOLUE du nom, identique sur les quatre lignes NON imbriquées
    // (arrière-plan, les deux photos, l'effet simple). C'est le constat
    // d'Antoine — « les icônes semblent positionnées un peu aléatoirement ».
    const absolute = (row: HTMLElement) => {
      const name = row.querySelector<HTMLElement>(".layer-panel__row-name");
      if (!name) throw new Error("ligne sans nom");
      return Math.round(name.getBoundingClientRect().left);
    };
    const flat = [rows[0], rows[1], rows[2], rows[4]];
    await expect(flat.every((r) => !r.className.includes("--nested"))).toBe(true);
    await expect(new Set(flat.map(absolute)).size).toBe(1);

    // La SEULE ligne dont le nom se décale est la ligne IMBRIQUÉE, et son
    // décalage vaut exactement l'indentation d'imbrication — divergence voulue
    // (layerTree.ts), pas une dérive. Sans cette assertion, réintroduire un
    // décalage accidentel sur une ligne écrêtée passerait pour l'indentation.
    // La SEULE ligne dont le nom se décale est la ligne IMBRIQUÉE, et son
    // décalage vient ENTIÈREMENT de l'indentation de la ligne (padding), pas
    // d'un décalage à l'intérieur de la grille — divergence voulue
    // (layerTree.ts), pas une dérive. Mesuré plutôt que lu dans le token :
    // `--layer-nest-indent` est un `calc()`, `getPropertyValue` rend la formule
    // non résolue et `parseFloat` en tirerait un 0 silencieux.
    await expect(rows[3].className).toContain("layer-panel__row--nested");
    const gridLeft = (row: HTMLElement) => {
      const main = row.querySelector<HTMLElement>(".layer-panel__row-main");
      if (!main) throw new Error("ligne sans grille d'identité");
      return Math.round(main.getBoundingClientRect().left);
    };
    const indentPx = gridLeft(rows[3]) - gridLeft(rows[4]);
    await expect(indentPx).toBeGreaterThan(0); // la ligne est bien indentée
    await expect(absolute(rows[3]) - absolute(rows[4])).toBe(indentPx);

    // ---- LE DOCK NE S'ÉLARGIT PAS ----
    // `min-width: 0` + ellipse du nom : aucune ligne ne déborde de la colonne,
    // à la largeur réelle du dock.
    const list = canvasElement.querySelector<HTMLElement>(".layer-panel__list");
    if (!list) throw new Error("liste introuvable");
    await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);

    // ---- ADR-0001 : ligne <= 56 px hors sélection ----
    // Aucune ligne n'est sélectionnée ici (`selectedId: null`).
    for (const row of rows) {
      await expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(56);
    }
  },
};

// --- Verrou (arbitrage n°2 du design du 2026-07-28) ---

export const LockedLayer: Story = {
  args: {
    layers: [makeLayer({ id: "layer-1", effectId: "glow", locked: true }), makeLayer({ id: "layer-2", effectId: "grain" })],
    selectedId: "layer-1",
    backgroundName: "DSC_0042.jpg",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Le calque verrouillé propose de DÉVERROUILLER ; l'autre, de verrouiller.
    await expect(canvas.getAllByRole("button", { name: "Déverrouiller le calque" })).toHaveLength(1);
    await expect(canvas.getAllByRole("button", { name: "Verrouiller le calque" })).toHaveLength(1);
    // DEUX CADENAS, DEUX CHOSES : celui de l'arrière-plan reste un MARQUEUR
    // (`role="img"`, non focusable) tant que le fond n'est pas un `LayerState`
    // — c'est la tranche T1. Celui d'un calque est un `<button>`.
    const backgroundLock = canvas.getByRole("img", { name: "Arrière-plan verrouillé" });
    await expect(backgroundLock.closest("button")).toBeNull();
  },
};

export const ToggleLock: Story = {
  args: { onToggleLock: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const locks = canvas.getAllByRole("button", { name: "Verrouiller le calque" });
    // Première ligne = premier calque appliqué = `layers[0]` (sens causal, ADR-0004).
    await userEvent.click(locks[0]);
    await expect(args.onToggleLock).toHaveBeenCalledWith("layer-1", true);
  },
};

// Le verrou ne sélectionne pas la ligne : même patron que dupliquer/supprimer
// (`stopPropagation`). Sans ça, verrouiller un calque déplacerait la sélection
// et donc tout le contenu de la zone de contrôles.
export const LockDoesNotSelectRow: Story = {
  args: { selectedId: "layer-1", onSelect: fn(), onToggleLock: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const locks = canvas.getAllByRole("button", { name: "Verrouiller le calque" });
    await userEvent.click(locks[1]);
    await expect(args.onToggleLock).toHaveBeenCalledWith("layer-2", true);
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const RemoveLayer: Story = {
  args: { onRemove: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const removeButtons = canvas.getAllByRole("button", { name: "Supprimer le calque" });
    // Première ligne = premier calque appliqué = `layers[0]` (sens causal, ADR-0004).
    await userEvent.click(removeButtons[0]);
    await expect(args.onRemove).toHaveBeenCalledWith("layer-1");
  },
};
