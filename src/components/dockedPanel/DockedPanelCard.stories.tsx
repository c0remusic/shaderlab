import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DockedPanelCard } from "./DockedPanelCard";

const meta: Meta<typeof DockedPanelCard> = {
  title: "Components/DockedPanel/DockedPanelCard",
  component: DockedPanelCard,
  args: {
    title: "Calques",
    collapsed: false,
    onCollapsedChange: () => {},
    reorderIndex: 0,
    children: <p style={{ margin: 0 }}>Contenu du panneau.</p>,
  },
};

export default meta;
type Story = StoryObj<typeof DockedPanelCard>;

export const Default: Story = {};

export const Collapsed: Story = {
  args: { collapsed: true },
};

export const Dragging: Story = {
  args: { dragging: true },
};

// --- Content / title variants ---

export const LongTitle: Story = {
  args: { title: "Paramètres avancés du calque de correction colorimétrique" },
};

export const RichContent: Story = {
  args: {
    title: "Paramètres",
    children: (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          Intensité <input type="range" defaultValue={60} />
        </label>
        <label style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          Rayon <input type="range" defaultValue={30} />
        </label>
        <button type="button">Réinitialiser</button>
      </div>
    ),
  },
};

export const OverflowContent: Story = {
  args: {
    title: "Journal",
    children: (
      <p style={{ margin: 0 }}>
        {Array.from({ length: 20 }, (_, i) => `Ligne ${i + 1} du contenu long qui teste le débordement vertical.`).join(" ")}
      </p>
    ),
  },
};

// --- Interaction tests (play) ---

// Repli : l'entête montre "Replier le panneau" quand il est déplié ; cliquer
// doit demander le passage à collapsed=true.
export const CollapseTogglesFromExpanded: Story = {
  args: {
    collapsed: false,
    onCollapsedChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Replier le panneau" });

    await userEvent.click(toggle);

    await expect(args.onCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(true);
  },
};

// Dépli : quand collapsed=true, le contenu est démonté et l'entête montre
// "Déplier le panneau" ; cliquer doit demander collapsed=false.
export const ExpandTogglesFromCollapsed: Story = {
  args: {
    collapsed: true,
    onCollapsedChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Contenu démonté tant que replié.
    await expect(canvas.queryByText("Contenu du panneau.")).toBeNull();

    const toggle = canvas.getByRole("button", { name: "Déplier le panneau" });
    await userEvent.click(toggle);

    await expect(args.onCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(false);
  },
};
