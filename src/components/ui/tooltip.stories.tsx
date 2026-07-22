import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./tooltip";
import { Button } from "./button";

const meta: Meta<typeof Tooltip> = {
  title: "Components/ui/Tooltip",
  component: Tooltip,
  args: {
    content: "Supprimer le calque",
    children: <Button variant="secondary">Survoler-moi</Button>,
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {};

export const BottomSide: Story = {
  args: { side: "bottom" },
};
