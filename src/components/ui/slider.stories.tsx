import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "./slider";

const meta: Meta<typeof Slider> = {
  title: "Components/ui/Slider",
  component: Slider,
  render: (args) => {
    const [value, setValue] = useState(args.value ?? [40]);
    return <Slider {...args} value={value} onValueChange={(next) => setValue(Array.isArray(next) ? next : [next])} />;
  },
  args: {
    min: 0,
    max: 100,
    value: [40],
  },
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
};
