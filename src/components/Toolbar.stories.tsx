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
    onOpenFile: () => {},
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
