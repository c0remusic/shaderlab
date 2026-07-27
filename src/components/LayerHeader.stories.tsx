import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { LayerHeader } from "./LayerPanel";
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
  makeLayer({ id: "layer-2", effectId: "grain", opacity: 0.35, blendMode: "screen" }),
  // Calque PHOTO : le sélecteur d'effet doit rester disponible dessus
  // (appliquer un effet différent selon la photo est un usage voulu).
  makeLayer({
    id: "photo-layer",
    effectId: "passthrough",
    name: "IMG_1234.jpg",
    imageSource: { sourceId: "photo-1" },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  }),
];

const meta: Meta<typeof LayerHeader> = {
  title: "Components/LayerHeader",
  component: LayerHeader,
  args: {
    layers,
    selectedId: "layer-1",
    onOpacityChange: () => {},
    onOpacityCommit: () => {},
    onBlendModeChange: () => {},
    onEffectChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LayerHeader>;

export const Default: Story = {};

// Aucune sélection : l'en-tête reste MONTÉ (sinon la liste sauterait de toute
// sa hauteur à chaque désélection), mais tous ses contrôles sont désactivés.
export const NoSelection: Story = {
  args: { selectedId: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Effet" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Fusion" })).toBeDisabled();
  },
};

export const PhotoLayerKeepsEffectSelector: Story = {
  args: { selectedId: "photo-layer" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Effet" })).not.toBeDisabled();
  },
};

// Le sélecteur d'effet est la seule UI qui change l'effectId d'un calque DÉJÀ
// créé (le Select « Ajouter un effet » du panneau ne fait qu'ajouter). Il
// expose "Aucun effet" (= passthrough), absent du sélecteur d'ajout.
export const ChangeLayerEffect: Story = {
  args: { selectedId: "layer-1", onEffectChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Effet" }));
    // La popup du Select est portalisée hors de canvasElement.
    const option = await within(document.body).findByRole("option", { name: "Aucun effet" });
    await userEvent.click(option);
    await expect(args.onEffectChange).toHaveBeenCalledWith("layer-1", "passthrough");
  },
};
