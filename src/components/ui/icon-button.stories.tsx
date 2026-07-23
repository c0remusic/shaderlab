import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eye, EyeOff, Lock, Trash2 } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
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
  argTypes: {
    variant: {
      control: "select",
      options: ["quiet", "danger"],
    },
    size: {
      control: "select",
      options: ["default", "compact"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

// --- Variants ---

export const Default: Story = {};

export const Danger: Story = {
  args: { variant: "danger" },
};

// --- Sizes ---

export const Compact: Story = {
  args: { size: "compact" },
};

export const CompactDanger: Story = {
  args: { size: "compact", variant: "danger" },
};

// --- States ---

export const Disabled: Story = {
  args: { disabled: true },
};

export const CustomTooltip: Story = {
  args: {
    label: "Masquer le calque",
    tooltip: "Basculer la visibilité (V)",
    children: <EyeOff className="icon-sm icon-stroke" aria-hidden="true" />,
  },
};

export const Locked: Story = {
  args: {
    label: "Verrouiller le calque",
    children: <Lock className="icon-sm icon-stroke" aria-hidden="true" />,
  },
};

// --- Interaction tests (play) ---

export const ClickCallsHandler: Story = {
  args: {
    label: "Afficher le calque",
    onClick: fn(),
    children: <Eye className="icon-sm icon-stroke" aria-hidden="true" />,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Icon-only button is queried by its accessible name (aria-label).
    const button = canvas.getByRole("button", { name: "Afficher le calque" });

    await userEvent.click(button);

    await expect(args.onClick).toHaveBeenCalled();
  },
};

export const DisabledDoesNotCallHandler: Story = {
  args: {
    label: "Afficher le calque",
    disabled: true,
    onClick: fn(),
    children: <Eye className="icon-sm icon-stroke" aria-hidden="true" />,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Afficher le calque" });

    await expect(button).toBeDisabled();

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(button);

    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
