import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Disclosure } from "./collapsible";

const meta: Meta<typeof Disclosure> = {
  title: "Components/ui/Disclosure",
  component: Disclosure,
  args: {
    title: "Affiner le bord",
    defaultOpen: true,
    children: <p style={{ margin: 0 }}>Contenu repliable.</p>,
  },
};

export default meta;
type Story = StoryObj<typeof Disclosure>;

// --- States ---

export const Default: Story = {};

export const ClosedByDefault: Story = {
  args: { defaultOpen: false },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledOpen: Story = {
  args: { disabled: true, defaultOpen: true },
};

export const LongContent: Story = {
  args: {
    defaultOpen: true,
    children: (
      <div style={{ display: "grid", gap: 8, maxWidth: 280 }}>
        <p style={{ margin: 0 }}>Rayon de contour, lissage et adoucissement du masque.</p>
        <p style={{ margin: 0 }}>
          Chaque réglage est appliqué en temps réel sur l'aperçu. Les valeurs élevées augmentent
          la charge GPU lors du rendu final.
        </p>
      </div>
    ),
  },
};

// --- Interaction tests (play) ---

export const ExpandsOnClick: Story = {
  args: {
    defaultOpen: false,
    onOpenChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Affiner le bord" });

    // base-ui unmounts the panel content while collapsed (keepMounted defaults to false).
    await expect(canvas.queryByText("Contenu repliable.")).toBeNull();

    await userEvent.click(trigger);

    await expect(args.onOpenChange).toHaveBeenCalledWith(true);
    await expect(await canvas.findByText("Contenu repliable.")).toBeVisible();
  },
};

export const CollapsesOnClick: Story = {
  args: {
    defaultOpen: true,
    onOpenChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Affiner le bord" });

    await expect(canvas.getByText("Contenu repliable.")).toBeVisible();

    await userEvent.click(trigger);

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const DisabledDoesNotExpand: Story = {
  args: {
    defaultOpen: false,
    disabled: true,
    onOpenChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Affiner le bord" });

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(trigger);

    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};
