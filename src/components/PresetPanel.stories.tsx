import type { Meta, StoryObj } from "@storybook/react-vite";
import { PresetPanel } from "./PresetPanel";
import type { PresetSummary } from "../presets/presetStore";

const threePresets: PresetSummary[] = [
  { id: "p1", name: "Film grain lourd", updatedAt: "2026-07-20T10:00:00.000Z" },
  { id: "p2", name: "Glow doux", updatedAt: "2026-07-22T14:30:00.000Z" },
  { id: "p3", name: "Chromatic aberration", updatedAt: "2026-07-25T09:15:00.000Z" },
];

const meta: Meta<typeof PresetPanel> = {
  title: "Components/PresetPanel",
  component: PresetPanel,
  args: {
    summaries: threePresets,
    hasLayers: true,
    onSave: () => {},
    onRename: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PresetPanel>;

export const Default: Story = {};

export const EmptyList: Story = {
  args: { summaries: [] },
};

export const NoLayersToSave: Story = {
  args: { hasLayers: false },
};
