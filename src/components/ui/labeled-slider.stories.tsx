import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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

// --- Value states ---

export const MinValue: Story = {
  args: { value: 0 },
};

export const MaxValue: Story = {
  args: { value: 3 },
};

export const IntegerStep: Story = {
  args: { label: "Taille", value: 24, min: 1, max: 128, step: 1 },
};

export const LongLabel: Story = {
  args: {
    label: "Intensité du flou gaussien appliqué au calque sélectionné",
    className: "max-w-[280px]",
  },
};

// --- Interaction tests (play) ---

export const ArrowKeyChangesValue: Story = {
  args: { value: 1.2, min: 0, max: 3, step: 0.05, onChange: fn() },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <LabeledSlider
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next);
          args.onChange(next);
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

    await expect(args.onChange).toHaveBeenCalled();
    // The value readout (text input) reflects the new stepped value (1.20 -> 1.25).
    const readout = canvas.getByLabelText("Intensité (valeur)");
    await expect(readout).not.toHaveValue("1.20");
  },
};

export const DisabledInputsAreDisabled: Story = {
  args: { disabled: true, onChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole("slider");
    const readout = canvas.getByLabelText("Intensité (valeur)");

    await expect(slider).toBeDisabled();
    await expect(readout).toBeDisabled();

    // Keyboard on a disabled slider must not fire onChange.
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};
