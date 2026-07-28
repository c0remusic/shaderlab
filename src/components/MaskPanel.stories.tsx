import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { MaskPanel } from "./MaskPanel";
import { defaultLayerMask, createParametricSource } from "../mask/types";
import type { LayerState } from "../layers/types";

const gradientSource = createParametricSource("source-1", "gradient", {
  angle: 0,
  startX: 0.3,
  startY: 0.5,
  endX: 0.7,
  endY: 0.5,
  feather: 0.1,
  invert: 0,
});

const luminositySource = createParametricSource("source-2", "luminosity", {
  shadowsMin: 0,
  shadowsMax: 0.3,
  highlightsMin: 0.7,
  highlightsMax: 1,
  feather: 0.05,
});

const colorRangeSource = createParametricSource("source-3", "colorRange", {
  tolerance: 0.2,
  hardness: 0.5,
  samples: [],
});

const layerWithMask: LayerState = {
  id: "layer-1",
  effectId: "glow",
  params: {},
  enabled: true,
  opacity: 1,
  blendMode: "normal",
  mask: { ...defaultLayerMask(), sources: [gradientSource] },
};

const meta: Meta<typeof MaskPanel> = {
  title: "Components/MaskPanel",
  component: MaskPanel,
  args: {
    layer: layerWithMask,
    maskPaintMode: false,
    onToggleMaskPaint: () => {},
    onAddMaskSource: () => {},
    onRemoveMaskSource: () => {},
    onMaskSourceParamsChange: () => {},
    onMaskSourceParamsCommit: () => {},
    onMaskSourceCombineModeChange: () => {},
    onMaskSourceEnabledChange: () => {},
    onMaskInvertChange: () => {},
    onMaskEnabledChange: () => {},
    onRefineEdgeChange: () => {},
    onRefineEdgeCommit: () => {},
    onAddColorSample: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof MaskPanel>;

export const Default: Story = {};

export const NoSources: Story = {
  args: {
    layer: { ...layerWithMask, mask: defaultLayerMask() },
  },
};

export const MultipleSources: Story = {
  args: {
    layer: {
      ...layerWithMask,
      mask: { ...defaultLayerMask(), sources: [gradientSource, luminositySource, colorRangeSource] },
    },
  },
};

export const MaskDisabled: Story = {
  args: {
    layer: {
      ...layerWithMask,
      mask: { ...defaultLayerMask(), sources: [gradientSource], enabled: false },
    },
  },
};

export const Inverted: Story = {
  args: {
    layer: {
      ...layerWithMask,
      mask: { ...defaultLayerMask(), sources: [gradientSource], invert: true },
    },
  },
};

export const PaintModeActive: Story = {
  args: { maskPaintMode: true },
};

export const NoLayerSelected: Story = {
  args: { layer: null },
};

// --- Interaction tests (play) ---

export const TogglePaintMode: Story = {
  args: { maskPaintMode: false, onToggleMaskPaint: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Peindre le masque" }));
    await expect(args.onToggleMaskPaint).toHaveBeenCalled();
  },
};

export const ToggleMaskActive: Story = {
  args: { onMaskEnabledChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // "Masque actif" is an aria-pressed IconButton (not a checkbox since
    // c0d18b5) — its accessible name is the aria-label, which reflects the
    // action, not the state. Mask starts enabled → clicking fires (id, false).
    await userEvent.click(canvas.getByRole("button", { name: "Désactiver le masque" }));
    await expect(args.onMaskEnabledChange).toHaveBeenCalledWith("layer-1", false);
  },
};

export const AddSourceFromMenu: Story = {
  args: { onAddMaskSource: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Ajouter une source" }));
    // Menu items portal out of canvasElement → query via `screen`.
    const gradientItem = await screen.findByRole("menuitem", { name: "Dégradé" });
    await userEvent.click(gradientItem);
    await expect(args.onAddMaskSource).toHaveBeenCalledWith("layer-1", "gradient");
  },
};

export const RemoveSource: Story = {
  args: { onRemoveMaskSource: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Supprimer la source" }));
    await expect(args.onRemoveMaskSource).toHaveBeenCalledWith("layer-1", "source-1");
  },
};
