import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./select";

const options = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiplier" },
  { value: "screen", label: "Superposition" },
  { value: "add", label: "Addition" },
];

const meta: Meta<typeof Select> = {
  title: "Components/ui/Select",
  component: Select,
  args: {
    label: "Fusion",
    value: "normal",
    options,
    onChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {};

export const NoSelection: Story = {
  args: { value: null, placeholder: "+ Ajouter un effet" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
