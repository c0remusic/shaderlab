import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ParamPanel } from "./ParamPanel";
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

const glowLayer = makeLayer({ effectId: "glow", params: { threshold: 0.7, intensity: 1.2 } });

const meta: Meta<typeof ParamPanel> = {
  title: "Components/ParamPanel",
  component: ParamPanel,
  args: {
    layer: glowLayer,
    onParamChange: () => {},
    onParamCommit: () => {},
    onClipChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ParamPanel>;

export const Default: Story = {};

export const NoLayerSelected: Story = {
  args: { layer: null },
};

/** Calque photo (`passthrough`) : état vide EXPLICITE, plus un `Disclosure`
 *  vide (design 2026-07-27 §3.7). */
export const PassthroughLayer: Story = {
  args: { layer: makeLayer({ id: "layer-photo", effectId: "passthrough", params: {} }) },
};

export const WarpLayer: Story = {
  args: { layer: makeLayer({ id: "layer-2", effectId: "warp" }) },
};

export const GrainLayer: Story = {
  args: { layer: makeLayer({ id: "layer-3", effectId: "grain" }) },
};

/** Écrêtage déjà posé : la case d'en-tête est cochée. */
export const ClippedLayer: Story = {
  args: { layer: makeLayer({ id: "layer-4", clipToBelow: true }) },
};

/** Calque PHOTO : la bascule d'écrêtage n'est pas rendue du tout — c'est le
 *  calque d'effet qui porte l'attribut, une photo ne peut pas être écrêtée. */
export const PhotoLayerHasNoClipToggle: Story = {
  args: {
    layer: makeLayer({
      id: "layer-5",
      effectId: "passthrough",
      imageSource: { sourceId: "photo-1" },
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("checkbox", { name: "Écrêter sur la photo du dessous" })).toBeNull();
  },
};

// --- Interaction tests (play) ---

export const ToggleClipFiresChange: Story = {
  args: { layer: glowLayer, onClipChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: "Écrêter sur la photo du dessous" }));
    await expect(args.onClipChange).toHaveBeenCalledWith("layer-1", true);
  },
};

export const ChangeParamFiresChange: Story = {
  args: { layer: glowLayer, onParamChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // "Seuil" is the label of the glow `threshold` param; its numeric input is
    // labeled "Seuil (valeur)". Enter commits parsed value → onParamChange.
    const input = canvas.getByLabelText("Seuil (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");
    await userEvent.keyboard("{Enter}");
    // Enter must commit exactly once. Regression guard: Enter previously
    // called commitTypedValue() AND blur() (whose onBlur re-commits),
    // firing onParamChange twice per Enter.
    await expect(args.onParamChange).toHaveBeenCalledTimes(1);
    await expect(args.onParamChange).toHaveBeenCalledWith("layer-1", { threshold: 0.5 });
  },
};
