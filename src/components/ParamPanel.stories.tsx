import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParamPanel } from "./ParamPanel";
import { defaultLayerMask } from "../mask/types";
import type { LayerState } from "../layers/types";

const glowLayer: LayerState = {
  id: "layer-1",
  effectId: "glow",
  params: { threshold: 0.7, intensity: 1.2 },
  enabled: true,
  opacity: 1,
  blendMode: "normal",
  mask: defaultLayerMask(),
};

const meta: Meta<typeof ParamPanel> = {
  title: "Components/ParamPanel",
  component: ParamPanel,
  args: {
    layer: glowLayer,
    onParamChange: () => {},
    onParamCommit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ParamPanel>;

export const Default: Story = {};

export const NoLayerSelected: Story = {
  args: { layer: null },
};
