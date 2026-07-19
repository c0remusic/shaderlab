import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toolbar } from "./Toolbar";

const meta: Meta<typeof Toolbar> = {
  title: "Components/Toolbar",
  component: Toolbar,
  args: {
    canUndo: true,
    canRedo: false,
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
