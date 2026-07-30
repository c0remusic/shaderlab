import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PresetPanel } from "./PresetPanel";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
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
    onApply: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PresetPanel>;

export const Default: Story = {};

/** GARDE D'ACCESSIBILITÉ — balayage MESURÉ du champ de nom de preset, dont le
 *  nom accessible vient d'un `aria-label` (pas d'étiquette visible dans la
 *  ligne de sauvegarde). Voir `ui/accessible-name.test-support.ts`. */
export const EveryFieldHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Nom du nouveau preset"]);
  },
};

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

// --- Interaction tests (play) — clic simple = appliquer, double-clic =
// renommer (Task 4, disambiguation clic/dblclick) ---

export const SingleClickAppliesAfterDelay: Story = {
  args: { onApply: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Glow doux"));
    // Le clic est retardé (200ms) — pas d'appel immédiat.
    await expect(args.onApply).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(args.onApply).toHaveBeenCalledTimes(1);
    await expect(args.onApply).toHaveBeenCalledWith("p2");
  },
};

export const DoubleClickCancelsPendingApplyAndStartsRename: Story = {
  args: { onApply: fn(), onRename: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Un double-clic dispatche deux `click` avant le `dblclick` — les deux
    // clics simples doivent être annulés, seul le renommage doit démarrer.
    await userEvent.dblClick(canvas.getByText("Glow doux"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(args.onApply).not.toHaveBeenCalled();
    await expect(canvas.getByLabelText("Renommer le preset")).toHaveValue("Glow doux");
  },
};
