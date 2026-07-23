import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { Tooltip } from "./tooltip";
import { Button } from "./button";

const meta: Meta<typeof Tooltip> = {
  title: "Components/ui/Tooltip",
  component: Tooltip,
  args: {
    content: "Supprimer le calque",
    children: <Button variant="secondary">Survoler-moi</Button>,
  },
  argTypes: {
    side: {
      control: "select",
      options: ["top", "bottom", "left", "right", "inline-start", "inline-end"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {};

export const BottomSide: Story = {
  args: { side: "bottom" },
};

// --- Placement / content variants ---

export const LeftSide: Story = {
  args: { side: "left" },
};

export const RightSide: Story = {
  args: { side: "right" },
};

export const NoDelay: Story = {
  args: { delay: 0 },
};

export const LongContent: Story = {
  args: {
    content: "Supprime définitivement le calque sélectionné ainsi que tous ses masques associés",
  },
};

// --- Interaction tests (play) ---

export const HoverShowsTooltip: Story = {
  args: { content: "Supprimer le calque", delay: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Survoler-moi" });

    await userEvent.hover(trigger);

    // Base UI renders the opened tooltip in a PORTAL outside canvasElement,
    // and the popup carries no ARIA role — assert on its text via `screen`.
    // `findBy*` awaits the open transition.
    const tip = await screen.findByText("Supprimer le calque");
    await expect(tip).toBeVisible();
  },
};
