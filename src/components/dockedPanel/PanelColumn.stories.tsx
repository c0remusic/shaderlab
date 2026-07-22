import type { Meta, StoryObj } from "@storybook/react-vite";
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
