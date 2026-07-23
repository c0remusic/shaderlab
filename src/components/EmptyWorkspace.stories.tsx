import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { EmptyWorkspace } from "./EmptyWorkspace";

const meta: Meta<typeof EmptyWorkspace> = {
  title: "Components/EmptyWorkspace",
  component: EmptyWorkspace,
  args: {
    onOpenFile: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof EmptyWorkspace>;

export const Default: Story = {};

// Contexte réel : EmptyWorkspace s'affiche par-dessus le canvas quand aucune
// image n'est chargée. Il occupe toute la surface de son parent — ici on borne
// le conteneur pour montrer le centrage vertical/horizontal dans une vraie scène.
export const InCanvasStage: Story = {
  render: (args) => (
    <div style={{ width: 640, height: 400, position: "relative", border: "1px solid var(--border, #333)" }}>
      <EmptyWorkspace {...args} />
    </div>
  ),
};

export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: 280, height: 360, position: "relative", border: "1px solid var(--border, #333)" }}>
      <EmptyWorkspace {...args} />
    </div>
  ),
};

// --- Interaction test (play) ---

export const OpenFileCallsHandler: Story = {
  args: {
    onOpenFile: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Ouvrir une image" });

    await userEvent.click(button);

    await expect(args.onOpenFile).toHaveBeenCalledTimes(1);
  },
};
