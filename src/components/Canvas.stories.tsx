import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Canvas } from "./Canvas";

// Canvas est un forwardRef<HTMLCanvasElement> PRÉSENTATIONNEL : tout le rendu
// WebGPU vit dans App.tsx via le ref, pas ici. Un wrapper local fournit un ref
// réel pour que le story monte sans crash (le canvas reste noir dans l'iframe
// Storybook — aucun device WebGPU garanti). Aucun callback interactif à tester :
// variantes d'état/layout uniquement, pas de play().
function CanvasHarness({ width = 480, height = 320, ...props }: React.ComponentProps<typeof Canvas> & { width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  return (
    <div style={{ width, height }}>
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

// --- Layout / size variants ---

// Grand conteneur : vérifie que le canvas se contient (max-width/height 100%)
// sans déborder du stage.
export const LargeStage: Story = {
  render: (args) => <CanvasHarness {...args} width={800} height={520} />,
};

// Conteneur étroit/portrait : l'overlay EmptyWorkspace doit rester centré.
export const NarrowStage: Story = {
  args: { hasImage: false },
  render: (args) => <CanvasHarness {...args} width={260} height={420} />,
};

// --- Brush cursor geometry variants (mode masque) ---
// Le curseur pinceau custom est dimensionné par brushSize/brushHardness ; ces
// variantes couvrent les bornes du réglage. (Le cercle n'est visible qu'au
// survol réel du canvas — variante d'état, pas d'interaction testée.)

export const SmallSoftBrush: Story = {
  args: { maskPaintMode: true, brushSize: 8, brushHardness: 0.1 },
};

export const LargeHardBrush: Story = {
  args: { maskPaintMode: true, brushSize: 120, brushHardness: 1 },
};
