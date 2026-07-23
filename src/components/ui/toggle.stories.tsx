import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eraser } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Toggle } from "./toggle";

const meta: Meta<typeof Toggle> = {
  title: "Components/ui/Toggle",
  component: Toggle,
  args: {
    children: "Gomme",
    variant: "default",
    size: "default",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg"],
    },
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

// --- Variants x states ---

export const OutlinePressed: Story = {
  args: { variant: "outline", defaultPressed: true },
};

// --- Sizes ---

export const Small: Story = {
  args: { size: "sm" },
};

export const Large: Story = {
  args: { size: "lg" },
};

// --- Content / states ---

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Eraser aria-hidden="true" />
        Gomme
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledPressed: Story = {
  args: { disabled: true, defaultPressed: true },
};

// --- Interaction tests (play) ---

export const PressTogglesOn: Story = {
  args: { children: "Gomme", onPressedChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Gomme" });

    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);

    await expect(args.onPressedChange).toHaveBeenCalledWith(true, expect.anything());
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  },
};

export const DisabledDoesNotToggle: Story = {
  args: { children: "Gomme", disabled: true, onPressedChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Gomme" });

    await expect(toggle).toBeDisabled();

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(toggle);

    await expect(args.onPressedChange).not.toHaveBeenCalled();
  },
};
