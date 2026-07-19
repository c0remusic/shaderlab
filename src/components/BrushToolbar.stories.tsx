import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrushToolbar } from "./BrushToolbar";

const meta: Meta<typeof BrushToolbar> = {
  title: "Components/BrushToolbar",
  component: BrushToolbar,
  args: {
    brushSize: 40,
    onBrushSizeChange: () => {},
    brushHardness: 0.6,
    onBrushHardnessChange: () => {},
    erase: false,
    onEraseChange: () => {},
    onStop: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof BrushToolbar>;

export const Default: Story = {};

export const EraseMode: Story = {
  args: { erase: true },
};
