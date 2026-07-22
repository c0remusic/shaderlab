import type { Meta, StoryObj } from "@storybook/react-vite";
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
