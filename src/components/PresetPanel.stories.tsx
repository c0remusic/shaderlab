import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PresetPanel } from "./PresetPanel";
import type { PresetSummary } from "../presets/presetStore";

const threePresets: PresetSummary[] = [
  { id: "p1", name: "Film grain lourd", updatedAt: "2026-07-20T10:00:00.000Z" },
  { id: "p2", name: "Glow doux", updatedAt: "2026-07-22T14:30:00.000Z" },
  { id: "p3", name: "Chromatic aberration", updatedAt: "2026-07-25T09:15:00.000Z" },
];

const meta: Meta<typeof PresetPanel> = {
  title: "Components/PresetPanel",
  component: PresetPanel,
  args: {
    summaries: threePresets,
    hasLayers: true,
    onSave: async () => true,
    onRename: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PresetPanel>;

export const Default: Story = {};

export const EmptyList: Story = {
  args: { summaries: [] },
};

export const NoLayersToSave: Story = {
  args: { hasLayers: false },
};

// --- Interaction tests (play) — renommage par double-clic (5 branches, revue tâche 3) ---

export const DoubleClickStartsRename: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.dblClick(canvas.getByText("Glow doux"));
    // Champ pré-rempli et sélectionné (onFocus -> select()).
    const input = canvas.getByLabelText("Renommer le preset");
    await expect(input).toHaveValue("Glow doux");
    await expect(input).toHaveFocus();
  },
};

export const EnterCommitsRename: Story = {
  args: { onRename: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.dblClick(canvas.getByText("Glow doux"));
    const input = canvas.getByLabelText("Renommer le preset");
    await userEvent.clear(input);
    await userEvent.type(input, "Glow intense");
    await userEvent.keyboard("{Enter}");
    await expect(args.onRename).toHaveBeenCalledTimes(1);
    await expect(args.onRename).toHaveBeenCalledWith("p2", "Glow intense");
    // Le champ démonté -> le nom d'origine n'apparaît plus, le contrôlé rend
    // le nouveau nom seulement une fois le parent réinjecté (hors scope ici :
    // ce composant ne connaît que l'appel, pas le nouvel état).
  },
};

export const BlurCommitsRename: Story = {
  args: { onRename: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.dblClick(canvas.getByText("Film grain lourd"));
    const input = canvas.getByLabelText("Renommer le preset");
    await userEvent.clear(input);
    await userEvent.type(input, "Film grain doux");
    // Perte de focus (sans Entrée) doit aussi committer.
    await userEvent.tab();
    await expect(args.onRename).toHaveBeenCalledTimes(1);
    await expect(args.onRename).toHaveBeenCalledWith("p1", "Film grain doux");
  },
};

export const EscapeCancelsRename: Story = {
  args: { onRename: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.dblClick(canvas.getByText("Chromatic aberration"));
    const input = canvas.getByLabelText("Renommer le preset");
    await userEvent.clear(input);
    await userEvent.type(input, "Nom jeté");
    await userEvent.keyboard("{Escape}");
    // Aucune écriture, le champ d'édition disparaît, le nom d'origine reste affiché.
    await expect(args.onRename).not.toHaveBeenCalled();
    await expect(canvas.getByText("Chromatic aberration")).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Renommer le preset")).not.toBeInTheDocument();
  },
};

export const EmptyOrUnchangedNameWritesNothing: Story = {
  args: { onRename: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Branche "inchangé" : commit sans modifier la valeur.
    await userEvent.dblClick(canvas.getByText("Glow doux"));
    await userEvent.keyboard("{Enter}");
    await expect(args.onRename).not.toHaveBeenCalled();
    // Branche "vide" : commit avec un nom réduit à du blanc.
    await userEvent.dblClick(canvas.getByText("Glow doux"));
    const input = canvas.getByLabelText("Renommer le preset");
    await userEvent.clear(input);
    await userEvent.type(input, "   ");
    await userEvent.keyboard("{Enter}");
    await expect(args.onRename).not.toHaveBeenCalled();
  },
};
