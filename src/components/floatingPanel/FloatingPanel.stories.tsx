import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FloatingPanel } from "./FloatingPanel";

const meta: Meta<typeof FloatingPanel> = {
  title: "FloatingPanel",
  component: FloatingPanel,
};
export default meta;

export const TwoPanels: StoryObj = {
  render: () => {
    function Demo() {
      const [posA, setPosA] = useState({ x: 40, y: 40 });
      const [posB, setPosB] = useState({ x: 40, y: 260 });
      const [collapsedA, setCollapsedA] = useState(false);
      const [collapsedB, setCollapsedB] = useState(false);
      const size = { width: 288, height: 180 };
      const canvasSize = { width: 1000, height: 700 };
      return (
        <div
          style={{
            position: "relative",
            width: canvasSize.width,
            height: canvasSize.height,
            background: "var(--surface-workspace)",
          }}
        >
          <FloatingPanel
            title="Calques"
            position={posA}
            size={size}
            collapsed={collapsedA}
            onPositionChange={setPosA}
            onCollapsedChange={setCollapsedA}
            siblingRects={[{ id: "b", rect: { ...posB, ...size } }]}
            canvasSize={canvasSize}
          >
            Contenu Calques (placeholder)
          </FloatingPanel>
          <FloatingPanel
            title="Réglages"
            position={posB}
            size={size}
            collapsed={collapsedB}
            onPositionChange={setPosB}
            onCollapsedChange={setCollapsedB}
            siblingRects={[{ id: "a", rect: { ...posA, ...size } }]}
            canvasSize={canvasSize}
          >
            Contenu Réglages (placeholder)
          </FloatingPanel>
        </div>
      );
    }
    return <Demo />;
  },
};
