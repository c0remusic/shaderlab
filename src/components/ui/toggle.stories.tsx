import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle } from "./toggle";

const meta: Meta<typeof Toggle> = {
  title: "Components/ui/Toggle",
  component: Toggle,
  args: {
    children: "Gomme",
  },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

export const Default: Story = {};

export const Pressed: Story = {
  args: { defaultPressed: true },
};

export const Outline: Story = {
  args: { variant: "outline" },
};
