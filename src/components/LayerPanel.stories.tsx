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

// Écrêtage (2026-07-27) : la ligne écrêtée est indentée et porte une flèche
// vers son calque de base — celui du DESSOUS dans la pile, donc la ligne
// JUSTE AU-DESSUS dans cette liste (elle affiche le bas de pile en premier).
// La ligne écrêtée est ici SÉLECTIONNÉE : l'indentation ne doit pas manger le
// marquage de sélection (fond de ligne pleine largeur).
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
    await expect(canvas.getByRole("img", { name: "Écrêté sur le calque du dessous" })).toBeTruthy();
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

// Le sélecteur d'effet a quitté les lignes pour l'en-tête (2026-07-27) :
// son test d'interaction vit dans `LayerHeader.stories.tsx`. La liste ne doit
// plus en exposer aucun.
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
    await userEvent.click(duplicateButtons[0]);
    await expect(args.onDuplicate).toHaveBeenCalledWith("layer-1");
  },
};

export const RemoveLayer: Story = {
  args: { onRemove: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const removeButtons = canvas.getAllByRole("button", { name: "Supprimer le calque" });
    await userEvent.click(removeButtons[0]);
    await expect(args.onRemove).toHaveBeenCalledWith("layer-1");
  },
};
