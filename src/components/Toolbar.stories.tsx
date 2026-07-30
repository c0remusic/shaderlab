import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { Toolbar } from "./Toolbar";

const meta: Meta<typeof Toolbar> = {
  title: "Components/Toolbar",
  component: Toolbar,
  args: {
    canUndo: true,
    canRedo: false,
    hasImage: true,
    onUndo: () => {},
    onRedo: () => {},
    onExport: () => {},
    onExportAs: () => {},
    onOpenFile: () => {},
    onOpenFileWithFormat: () => {},
    onOpenFileWithFreeSize: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof Toolbar>;

export const Default: Story = {};

export const NothingToUndoOrRedo: Story = {
  args: { canUndo: false, canRedo: false },
};

export const CanRedo: Story = {
  args: { canUndo: true, canRedo: true },
};

export const NoImage: Story = {
  args: { hasImage: false },
};

// --- Interaction tests (play) ---

export const ClickUndoCallsHandler: Story = {
  args: { canUndo: true, onUndo: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Annuler" }));
    await expect(args.onUndo).toHaveBeenCalled();
  },
};

export const DisabledUndoDoesNotCall: Story = {
  args: { canUndo: false, onUndo: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Annuler" });
    await expect(button).toBeDisabled();

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(button);
    await expect(args.onUndo).not.toHaveBeenCalled();
  },
};

export const FileMenuExportsWhenImage: Story = {
  args: { hasImage: true, onExport: fn(), onOpenFile: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Menu content portals out of canvasElement → query via `screen`.
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    const exportItem = await screen.findByRole("menuitem", { name: "Exporter" });
    await userEvent.click(exportItem);
    await expect(args.onExport).toHaveBeenCalled();
  },
};

export const FileMenuExportDisabledWhenNoImage: Story = {
  args: { hasImage: false, onExport: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    const exportItem = await screen.findByRole("menuitem", { name: "Exporter" });

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(exportItem);
    await expect(args.onExport).not.toHaveBeenCalled();
  },
};

export const FileMenuExportAsWhenImage: Story = {
  args: { hasImage: true, onExportAs: fn(), onOpenFile: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    const exportAsItem = await screen.findByRole("menuitem", { name: "Exporter sous..." });
    await userEvent.click(exportAsItem);
    await expect(args.onExportAs).toHaveBeenCalled();
  },
};

// Tranche T2 : « Ouvrir » nu ne demande RIEN — c'est le chemin par défaut, et
// il doit rester à un seul clic. Ce test est la garde contre un futur dialogue
// interposé sur ce chemin-là.
export const FileMenuOpenAsksNothing: Story = {
  args: { onOpenFile: fn(), onOpenFileWithFormat: fn(), onOpenFileWithFreeSize: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ouvrir" }));
    await expect(args.onOpenFile).toHaveBeenCalledTimes(1);
    // Aucun format n'a été demandé : le défaut « comme la photo » est porté par
    // l'absence d'argument, pas par une valeur choisie dans l'interface.
    await expect(args.onOpenFileWithFormat).not.toHaveBeenCalled();
    await expect(args.onOpenFileWithFreeSize).not.toHaveBeenCalled();
  },
};

export const FileMenuOpenWithSquareCanvas: Story = {
  args: { onOpenFile: fn(), onOpenFileWithFormat: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ouvrir dans un format de toile" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Carré" }));
    await expect(args.onOpenFileWithFormat).toHaveBeenCalledWith("carre");
    await expect(args.onOpenFile).not.toHaveBeenCalled();
  },
};

export const FileMenuOpenWithFreeSize: Story = {
  args: { onOpenFileWithFreeSize: fn(), onOpenFileWithFormat: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ouvrir dans un format de toile" }));
    // Le libellé de A3 PORTE son dpi : un format papier sans résolution ne veut
    // rien dire (voir `NAMED_CANVAS_FORMAT_LABELS`).
    await expect(await screen.findByRole("menuitem", { name: "A3 (300 dpi)" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Taille libre..." }));
    await expect(args.onOpenFileWithFreeSize).toHaveBeenCalledTimes(1);
    await expect(args.onOpenFileWithFormat).not.toHaveBeenCalled();
  },
};

// Depuis la dépose du round-trip Lightroom (ADR-0002), « Exporter sous... » n'a
// plus qu'une seule raison d'être désactivé : aucun document ouvert. Cette
// story remplace `FileMenuExportAsDisabledDuringRoundTrip`, qui couvrait la
// seconde raison, disparue avec le mécanisme.
export const FileMenuExportAsDisabledWhenNoImage: Story = {
  args: { hasImage: false, onExportAs: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Menu Fichier" }));
    const exportAsItem = await screen.findByRole("menuitem", { name: "Exporter sous..." });
    await expect(exportAsItem).toHaveAttribute("aria-disabled", "true");

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(exportAsItem);
    await expect(args.onExportAs).not.toHaveBeenCalled();
  },
};
