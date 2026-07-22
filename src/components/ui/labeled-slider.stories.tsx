import type { Meta, StoryObj } from "@storybook/react-vite";
import { LabeledSlider } from "./labeled-slider";

const meta: Meta<typeof LabeledSlider> = {
  title: "Components/ui/LabeledSlider",
  component: LabeledSlider,
  args: {
    label: "Intensité",
    value: 1.2,
    min: 0,
    max: 3,
    step: 0.05,
    onChange: () => {},
    onCommit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LabeledSlider>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const CustomDisplayValue: Story = {
  args: { value: 0.7, min: 0, max: 1, displayValue: "70 %" },
};
