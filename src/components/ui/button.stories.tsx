import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderOpen, Trash2 } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./button";

const meta: Meta<typeof Button> = {
  title: "Components/ui/Button",
  component: Button,
  args: {
    children: "Exporter",
    variant: "default",
    size: "default",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline", "secondary", "ghost", "destructive", "link"],
    },
    size: {
      control: "select",
      options: ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// --- Variants (one named export per cva `variant` value) ---

export const Default: Story = {};

export const Outline: Story = {
  args: { variant: "outline" },
};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

export const Ghost: Story = {
  args: { variant: "ghost" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Supprimer" },
};

export const Link: Story = {
  args: { variant: "link" },
};

// --- Sizes (one named export per cva `size` value) ---

export const XSmall: Story = {
  args: { size: "xs" },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const Large: Story = {
  args: { size: "lg" },
};

export const IconDefault: Story = {
  args: {
    size: "icon",
    "aria-label": "Supprimer le calque",
    children: <Trash2 aria-hidden="true" />,
  },
};

export const IconXSmall: Story = {
  args: {
    size: "icon-xs",
    "aria-label": "Supprimer le calque",
    children: <Trash2 aria-hidden="true" />,
  },
};

export const IconSmall: Story = {
  args: {
    size: "icon-sm",
    "aria-label": "Supprimer le calque",
    children: <Trash2 aria-hidden="true" />,
  },
};

export const IconLarge: Story = {
  args: {
    size: "icon-lg",
    "aria-label": "Supprimer le calque",
    children: <Trash2 aria-hidden="true" />,
  },
};

// --- Content states ---

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <FolderOpen aria-hidden="true" />
        Ouvrir une image
      </>
    ),
  },
};

export const LongLabel: Story = {
  args: {
    children: "Exporter le rendu vers un fichier PNG haute résolution",
    className: "max-w-[200px]",
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

// --- Interaction tests (play) ---

export const ClickCallsHandler: Story = {
  args: {
    children: "Cliquer",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Cliquer" });

    await userEvent.click(button);

    await expect(args.onClick).toHaveBeenCalled();
  },
};

export const DisabledDoesNotCallHandler: Story = {
  args: {
    children: "Cliquer",
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Cliquer" });

    await expect(button).toBeDisabled();

    // Bypass userEvent's pointer-events guard so the click is actually attempted;
    // a native disabled button still never dispatches the handler.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(button);

    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
