import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { CanvasControl, EffectParam } from "../render/effects/types";
import { CanvasControls } from "./CanvasControls";

interface HarnessProps {
  controls: CanvasControl[];
  params: EffectParam[];
  values: Record<string, number>;
  portrait?: boolean;
  light?: boolean;
  disabled?: boolean;
  onChange: (patch: Record<string, number>) => void;
  onCommit: () => void;
}

function Harness({ controls, params, values, portrait = false, light = false, disabled = false, onChange, onCommit }: HarnessProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = portrait ? { width: 240, height: 360 } : { width: 480, height: 300 };
  return <div style={{ position: "relative", width: size.width, height: size.height, background: "var(--surface-workspace)" }}>
    <canvas ref={canvasRef} width={size.width} height={size.height}
      style={{ display: "block", width: size.width, height: size.height, background: light ? "var(--primitive-neutral-300)" : "var(--primitive-neutral-900)" }} />
    <CanvasControls controls={controls} params={params} values={values} imageSize={size} canvasRef={canvasRef}
      effectName="Effet de démonstration" disabled={disabled} onChange={onChange} onCommit={onCommit} />
  </div>;
}

const params: EffectParam[] = [
  { name: "x", label: "X", min: -0.5, max: 1.5, default: 0.5, step: 0.01 },
  { name: "y", label: "Y", min: -0.5, max: 1.5, default: 0.5, step: 0.01 },
  { name: "radius", label: "Rayon", unit: "percent", min: 0, max: 2, default: 0.4, step: 0.01 },
  { name: "angle", label: "Angle", unit: "degrees", min: 0, max: 360, default: 25, step: 1 },
  { name: "length", label: "Longueur", unit: "pixels", min: 0, max: 1000, default: 180, step: 1 },
];

const meta = { title: "Components/CanvasControls", component: Harness,
  args: { params, values: { x: 0.5, y: 0.5, radius: 0.4, angle: 25, length: 180 }, onChange: fn(), onCommit: fn() },
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PointOnDark: Story = { args: { controls: [{ id: "source", kind: "point", x: "x", y: "y", label: "Source" }] } };
export const DiskOnLight: Story = { args: { light: true, controls: [{ id: "zone", kind: "disk", x: "x", y: "y", radius: "radius", label: "Zone" }] } };
export const AxisPortrait: Story = { args: { portrait: true, controls: [{ id: "path", kind: "axis", angle: "angle", length: "length", label: "Trajectoire" }] } };
export const PointOutsideFrame: Story = { args: { values: { x: 1.15, y: -0.15, radius: 0.4, angle: 25, length: 180 }, controls: [{ id: "outside", kind: "point", x: "x", y: "y", label: "Source hors cadre" }] } };
export const Disabled: Story = { args: { disabled: true, controls: [{ id: "zone", kind: "disk", x: "x", y: "y", radius: "radius", label: "Zone" }] } };
