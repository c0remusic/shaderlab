import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ToolPalette } from "./ToolPalette";

const meta: Meta<typeof ToolPalette> = {
  title: "Components/ToolPalette",
  component: ToolPalette,
  args: { activeTool: "move", onSelectTool: () => {} },
};

export default meta;
type Story = StoryObj<typeof ToolPalette>;

export const Deplacer: Story = { args: { activeTool: "move" } };
export const Pinceau: Story = { args: { activeTool: "brush" } };
export const Forme: Story = { args: { activeTool: "shape" } };

/** L'outil Recadrer (ticket 32) figure dans la palette et s'affiche pressé quand
 *  il est actif. */
export const Recadrer: Story = {
  args: { activeTool: "crop" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bouton = canvas.getByRole("button", { name: "Recadrer" });
    await expect(bouton).toBeInTheDocument();
    await expect(bouton).toHaveAttribute("aria-pressed", "true");
  },
};

/** Sans document ouvert, tous les outils sont désactivés. */
export const Desactive: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Recadrer" })).toBeDisabled();
  },
};
