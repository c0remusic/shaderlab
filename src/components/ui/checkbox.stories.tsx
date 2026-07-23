import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Checkbox } from "./checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Components/ui/Checkbox",
  component: Checkbox,
  args: {
    label: "Masque actif",
    checked: false,
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

// --- States ---

export const Default: Story = {};

export const Checked: Story = {
  args: { checked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, checked: true },
};

export const LongLabel: Story = {
  args: {
    label: "Appliquer le masque à tous les calques du groupe sélectionné",
    className: "max-w-[240px]",
  },
};

// --- Interaction tests (play) ---

export const TogglesOnClick: Story = {
  args: {
    checked: false,
    onChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole("checkbox", { name: "Masque actif" });

    await expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    const onChange = args.onChange as ReturnType<typeof fn>;
    await expect(onChange).toHaveBeenCalled();
    // base-ui's onCheckedChange forwards (checked, eventDetails); assert the checked value.
    await expect(onChange.mock.calls[0][0]).toBe(true);
  },
};

export const DisabledDoesNotToggle: Story = {
  args: {
    checked: false,
    disabled: true,
    onChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole("checkbox", { name: "Masque actif" });

    // base-ui renders the checkbox as a span with aria-disabled (not a native disabled input).
    await expect(checkbox).toHaveAttribute("aria-disabled", "true");

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(checkbox);

    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// Controlled wrapper: verifies the checked state actually flips in the DOM.
function ControlledCheckbox() {
  const [checked, setChecked] = useState(false);
  return <Checkbox label="Masque actif" checked={checked} onChange={setChecked} />;
}

export const ControlledToggle: Story = {
  render: () => <ControlledCheckbox />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole("checkbox", { name: "Masque actif" });

    await expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    await expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await expect(checkbox).not.toBeChecked();
  },
};
