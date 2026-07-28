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
