import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
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

// --- Content states ---

export const WithDisabledOption: Story = {
  args: {
    value: "normal",
    options: [
      { value: "normal", label: "Normal" },
      { value: "multiply", label: "Multiplier" },
      { value: "premium", label: "Effet premium (indisponible)", disabled: true },
    ],
  },
};

export const LongLabels: Story = {
  args: {
    value: "a",
    className: "max-w-[220px]",
    options: [
      { value: "a", label: "Superposition avec fusion linéaire douce" },
      { value: "b", label: "Assombrissement couleur progressif" },
    ],
  },
};

// --- Interaction tests (play) ---

export const OpenAndSelect: Story = {
  args: { value: "normal", onChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Base UI Select.Trigger exposes role "combobox".
    const trigger = canvas.getByRole("combobox");

    await userEvent.click(trigger);

    // Opened options render in a PORTAL outside canvasElement — query `screen`.
    const option = await screen.findByRole("option", { name: "Multiplier" });
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith("multiply");
  },
};

export const DisabledDoesNotOpen: Story = {
  args: { disabled: true, onChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox");

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(trigger);

    // No listbox should have opened; nothing selected.
    await expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};
