import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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
    onRemove: () => {},
    onReorder: () => {},
    onOpacityChange: () => {},
    onOpacityCommit: () => {},
    onBlendModeChange: () => {},
    onEffectChange: () => {},
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

// --- Interaction tests (play) ---

export const ClickLayerSelects: Story = {
  args: { selectedId: "layer-1", onSelect: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Clicking the row name bubbles to the <li> onClick → onSelect(id).
    // Pas d'ambiguïté de texte : le sélecteur d'effet n'existe que sur la
    // ligne SÉLECTIONNÉE (layer-1, « Glow »), pas sur celle-ci.
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
    await expect(args.onToggle).toHaveBeenCalledWith("layer-2");
  },
};

// Le sélecteur d'effet : c'est la seule UI qui change l'effectId d'un calque
// DÉJÀ créé (le Select du haut ne fait qu'ajouter). Il expose "Aucun effet"
// (= passthrough), absent du sélecteur d'ajout. Il n'existe QUE sur le calque
// sélectionné (design §3.6) — d'où le `toHaveLength(1)` sur 3 calques.
export const ChangeLayerEffect: Story = {
  args: { selectedId: "layer-1", onEffectChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const triggers = canvas.getAllByRole("combobox", { name: "Effet" });
    await expect(triggers).toHaveLength(1);
    await userEvent.click(triggers[0]);
    // La popup du Select est portalisée hors de canvasElement.
    const option = await within(document.body).findByRole("option", { name: "Aucun effet" });
    await userEvent.click(option);
    await expect(args.onEffectChange).toHaveBeenCalledWith("layer-1", "passthrough");
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
