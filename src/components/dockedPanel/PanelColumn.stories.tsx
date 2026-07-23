import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PanelColumn, type DockedPanelSpec } from "./PanelColumn";
import type { DockLayout } from "../../ui/dockLayout";

const layout: DockLayout = [["layers", "params"], ["mask"]];

const panels: DockedPanelSpec[] = [
  { id: "layers", title: "Calques", collapsed: false, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Liste des calques.</p> },
  { id: "params", title: "Paramètres", collapsed: false, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Réglages de l'effet.</p> },
  { id: "mask", title: "Masque", collapsed: true, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Sources de masque.</p> },
];

const meta: Meta<typeof PanelColumn> = {
  title: "Components/DockedPanel/PanelColumn",
  component: PanelColumn,
  args: {
    panels,
    layout,
    onMove: () => {},
    width: 320,
    onWidthChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PanelColumn>;

export const Default: Story = {};

export const SingleColumn: Story = {
  args: { layout: [["layers", "params", "mask"]] },
};

// --- State variants ---

export const AllCollapsed: Story = {
  args: {
    panels: panels.map((p) => ({ ...p, collapsed: true })),
  },
};

export const AllExpanded: Story = {
  args: {
    panels: panels.map((p) => ({ ...p, collapsed: false })),
  },
};

export const SinglePanel: Story = {
  args: {
    panels: [panels[0]],
    layout: [["layers"]],
  },
};

export const Narrow: Story = {
  args: { width: 220 },
};

// --- Interaction test (play) ---

// PanelColumn délègue le repli de chaque carte à la DockedPanelCard sous-jacente ;
// cliquer le bouton "Replier le panneau" de la première carte dépliée (Calques)
// doit remonter à SON callback onCollapsedChange avec true.
export const CollapsePanelCallsSpec: Story = {
  args: {
    panels: [
      { ...panels[0], onCollapsedChange: fn() },
      { ...panels[1], collapsed: true },
      { ...panels[2] },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Seule "Calques" est dépliée -> un unique bouton "Replier le panneau".
    const collapse = canvas.getByRole("button", { name: "Replier le panneau" });
    await userEvent.click(collapse);

    const layersSpec = args.panels.find((p) => p.id === "layers");
    await expect(layersSpec?.onCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(layersSpec?.onCollapsedChange).toHaveBeenCalledWith(true);
  },
};
