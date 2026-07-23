import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Slider } from "./slider";

const meta: Meta<typeof Slider> = {
  title: "Components/ui/Slider",
  component: Slider,
  render: (args) => {
    const [value, setValue] = useState(args.value ?? [40]);
    return <Slider {...args} value={value} onValueChange={(next) => setValue(Array.isArray(next) ? next : [next])} />;
  },
  args: {
    // Bare slider has no visible label — give the range input an accessible
    // name so axe's "label" rule passes (the labeled-slider gets its name via
    // aria-labelledby instead).
    "aria-label": "Valeur",
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

// --- Value states ---

export const MinValue: Story = {
  args: { value: [0] },
};

export const MaxValue: Story = {
  args: { value: [100] },
};

export const Range: Story = {
  args: { value: [25, 75] },
};

export const Stepped: Story = {
  args: { value: [50], step: 10 },
};

// --- Interaction tests (play) ---

export const ArrowKeyChangesValue: Story = {
  args: { value: [40], min: 0, max: 100, onValueChange: fn() },
  render: (args) => {
    const [value, setValue] = useState<number[]>((args.value as number[]) ?? [40]);
    return (
      <Slider
        {...args}
        value={value}
        onValueChange={(next, details) => {
          const arr = Array.isArray(next) ? next : [next];
          setValue(arr);
          args.onValueChange?.(next, details);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Base UI slider thumb is a nested <input type="range"> (role "slider").
    const slider = canvas.getByRole("slider");
    slider.focus();

    await userEvent.keyboard("{ArrowRight}");

    await expect(args.onValueChange).toHaveBeenCalled();
    await expect(slider).toHaveValue("41");
  },
};

export const DisabledDoesNotChange: Story = {
  args: { disabled: true, value: [40], onValueChange: fn() },
  render: (args) => <Slider {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole("slider");

    await expect(slider).toBeDisabled();

    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};
