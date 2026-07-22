import type { Meta, StoryObj } from "@storybook/react-vite";
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

export const PaintModeActive: Story = {
  args: { maskPaintMode: true },
};

export const NoLayerSelected: Story = {
  args: { layer: null },
};
