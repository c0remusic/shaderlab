import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { expect, within } from "storybook/test";
import { CropOverlay } from "./CropOverlay";
import type { CropRatioId, CropRect } from "../ui/cropTool";

const CANVAS = { width: 1000, height: 750 };

/** Harnais : un canvas plein cadre (l'outil montre toute la toile) et l'overlay
 *  posé dessus, avec un rectangle de recadrage fixe. */
function Harness({
  rect = { x: 200, y: 150, width: 500, height: 400 },
  ratio = "free",
}: {
  rect?: CropRect;
  ratio?: CropRatioId;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  return (
    <div style={{ position: "relative", width: 500, height: 375, background: "var(--surface-workspace)" }}>
      <canvas ref={canvasRef} width={CANVAS.width} height={CANVAS.height} style={{ width: "100%", height: "100%" }} />
      <CropOverlay
        rect={rect}
        imageSize={CANVAS}
        ratio={ratio}
        canvasRef={canvasRef}
        onChange={() => {}}
        onValidate={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Components/CropOverlay",
  component: Harness,
};

export default meta;
type Story = StoryObj<typeof Harness>;

/** Ratio libre : le cadre de travail, le voile hors cadre et les huit poignées. */
export const Libre: Story = {
  args: { ratio: "free" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Le cadre est la cible clavier/déplacement (role application).
    await expect(canvas.getByRole("application")).toBeInTheDocument();
    // Huit poignées de recadrage (affordances de souris, `aria-hidden`).
    const poignees = canvasElement.querySelectorAll(".crop-overlay__handle");
    await expect(poignees.length).toBe(8);
  },
};

/** Ratio 3:2 — le même cadre sous une proportion contrainte. */
export const RatioTroisDeux: Story = {
  args: { ratio: "3:2", rect: { x: 100, y: 100, width: 600, height: 400 } },
  play: async ({ canvasElement }) => {
    const poignees = canvasElement.querySelectorAll(".crop-overlay__handle");
    await expect(poignees.length).toBe(8);
  },
};
