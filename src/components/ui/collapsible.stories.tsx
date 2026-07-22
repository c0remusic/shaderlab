import type { Meta, StoryObj } from "@storybook/react-vite";
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

export const Default: Story = {};

export const ClosedByDefault: Story = {
  args: { defaultOpen: false },
};

export const Disabled: Story = {
  args: { disabled: true },
};
