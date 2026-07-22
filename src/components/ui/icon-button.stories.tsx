import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash2 } from "lucide-react";
import { IconButton } from "./icon-button";

const meta: Meta<typeof IconButton> = {
  title: "Components/ui/IconButton",
  component: IconButton,
  args: {
    label: "Supprimer le calque",
    size: "default",
    variant: "quiet",
    children: <Trash2 className="icon-sm icon-stroke" aria-hidden="true" />,
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {};

export const Danger: Story = {
  args: { variant: "danger" },
};

export const Compact: Story = {
  args: { size: "compact" },
};
