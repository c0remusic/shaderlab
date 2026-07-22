import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Canvas } from "./Canvas";

// Canvas est un forwardRef<HTMLCanvasElement> : un composant wrapper local
// fournit un ref réel pour que le story monte sans crash (même si le canvas
// reste noir dans l'iframe Storybook — aucun device WebGPU garanti).
function CanvasHarness(props: React.ComponentProps<typeof Canvas>) {
  const ref = useRef<HTMLCanvasElement>(null);
  return (
    <div style={{ width: 480, height: 320 }}>
      <Canvas {...props} ref={ref} />
    </div>
  );
}

const meta: Meta<typeof Canvas> = {
  title: "Components/Canvas",
  component: Canvas,
  render: (args) => <CanvasHarness {...args} />,
  args: {
    onFileDropped: () => {},
    hasImage: true,
    onOpenFile: () => {},
    maskPaintMode: false,
    onMaskStroke: () => {},
    onStrokeEnd: () => {},
    brushSize: 40,
    brushHardness: 0.6,
  },
};

export default meta;
type Story = StoryObj<typeof Canvas>;

export const Default: Story = {};

export const EmptyNoImage: Story = {
  args: { hasImage: false },
};

export const MaskPaintMode: Story = {
  args: { hasImage: true, maskPaintMode: true },
};
