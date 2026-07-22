import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyWorkspace } from "./EmptyWorkspace";

const meta: Meta<typeof EmptyWorkspace> = {
  title: "Components/EmptyWorkspace",
  component: EmptyWorkspace,
  args: {
    onOpenFile: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof EmptyWorkspace>;

export const Default: Story = {};
