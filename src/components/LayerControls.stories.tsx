import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { LayerControls } from "./LayerPanel";
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

const meta: Meta<typeof LayerControls> = {
  title: "Components/LayerControls",
  component: LayerControls,
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
type Story = StoryObj<typeof LayerControls>;

export const Default: Story = {};

// Aucune sélection : l'en-tête reste MONTÉ (sinon la liste sauterait de toute
// sa hauteur à chaque désélection), mais tous ses contrôles sont désactivés.
export const NoSelection: Story = {
  args: { selectedId: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Effet" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Fusion" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "Opacité" })).toBeDisabled();
  },
};

// L'opacité est le SEUL contrôle de l'en-tête dont l'étiquette a quitté l'écran
// (`labelPlacement="hidden"`, donc `sr-only`). Sans cette story, une régression
// qui le rendrait anonyme — étiquette non liée, `htmlFor` cassé — passerait au
// vert : plus rien d'autre ne vérifie son nom accessible. Elle verrouille aussi
// l'UNITÉ affichée : un pourcentage entier, jamais un 0..1.
export const OpacityFieldIsNamedAndShowsPercent: Story = {
  args: { selectedId: "layer-2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await expect(field).toHaveValue("35");
    await expect(canvas.getByText("%")).toBeVisible();
  },
};

// Contrat de commit du champ (précédent du repo : `ui/labeled-slider.tsx`,
// `PhotoPanel`) — brouillon local, commit au blur, EXACTEMENT une entrée
// d'historique. La saisie porte l'unité (« 60 % ») : le champ doit l'accepter
// telle qu'il l'affiche.
export const OpacityFieldCommitsTypedPercent: Story = {
  args: { selectedId: "layer-2", onOpacityChange: fn(), onOpacityCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await userEvent.click(field);
    await userEvent.keyboard("{Control>}a{/Control}60 %");
    await userEvent.tab();
    await expect(args.onOpacityChange).toHaveBeenCalledTimes(1);
    await expect(args.onOpacityChange).toHaveBeenCalledWith("layer-2", 0.6);
    await expect(args.onOpacityCommit).toHaveBeenCalledTimes(1);
  },
};

// Saisie invalide : retour à la valeur précédente, jamais un NaN poussé dans le
// modèle ni une entrée d'historique.
export const OpacityFieldRejectsInvalidInput: Story = {
  args: { selectedId: "layer-2", onOpacityChange: fn(), onOpacityCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await userEvent.click(field);
    await userEvent.keyboard("{Control>}a{/Control}bloup");
    await userEvent.tab();
    await expect(field).toHaveValue("35");
    await expect(args.onOpacityChange).not.toHaveBeenCalled();
    await expect(args.onOpacityCommit).not.toHaveBeenCalled();
  },
};

// Échap abandonne l'édition en cours sans rien committer.
export const OpacityFieldEscapeAbandons: Story = {
  args: { selectedId: "layer-2", onOpacityChange: fn(), onOpacityCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await userEvent.click(field);
    await userEvent.keyboard("{Control>}a{/Control}99{Escape}");
    await expect(field).toHaveValue("35");
    await expect(args.onOpacityChange).not.toHaveBeenCalled();
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
