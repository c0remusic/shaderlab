import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ColorWheelControl, type ColorWheelChange } from "./color-wheel-control";

/**
 * La roue chromatique du Color Grading (ticket 06) : teinte au pourtour,
 * saturation au rayon, un point qu'on tire, la luminance en curseur SIGNÉ dessous.
 * Double-clic sur le disque = retour au défaut (teinte + saturation).
 */
function Harness(props: {
  hue?: number; saturation?: number; luminance?: number;
  disabled?: boolean;
  onChange?: (patch: ColorWheelChange) => void;
  onCommit?: () => void;
}) {
  const [hue, setHue] = useState(props.hue ?? 0);
  const [saturation, setSaturation] = useState(props.saturation ?? 0);
  const [luminance, setLuminance] = useState(props.luminance ?? 0);
  return (
    <div style={{ width: 160 }}>
      <ColorWheelControl
        label="Ombres"
        hue={hue}
        saturation={saturation}
        luminance={luminance}
        hueDefault={0}
        saturationDefault={0}
        luminanceDefault={0}
        luminanceMin={-100}
        luminanceMax={100}
        luminanceStep={1}
        disabled={props.disabled}
        onChange={(patch) => {
          if (patch.hue !== undefined) setHue(patch.hue);
          if (patch.saturation !== undefined) setSaturation(patch.saturation);
          if (patch.luminance !== undefined) setLuminance(patch.luminance);
          props.onChange?.(patch);
        }}
        onCommit={() => props.onCommit?.()}
      />
    </div>
  );
}

const meta = { title: "Components/ui/ColorWheelControl", component: Harness } satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("slider", { name: /Ombres — teinte/ })).toBeInTheDocument();
    await expect(canvas.getByText("Luminance")).toBeInTheDocument();
  },
};

export const Teinte: Story = { args: { hue: 220, saturation: 70, luminance: -30 } };

export const Disabled: Story = { args: { hue: 40, saturation: 60, disabled: true } };

export const ClavierTeinte: Story = {
  args: { hue: 100, saturation: 50, onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const disk = within(canvasElement).getByRole("slider", { name: /Ombres — teinte/ });
    disk.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ hue: 102 }));
    await expect(args.onCommit).toHaveBeenCalled();
  },
};

export const ClavierSaturation: Story = {
  args: { hue: 100, saturation: 50, onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const disk = within(canvasElement).getByRole("slider", { name: /Ombres — teinte/ });
    disk.focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ saturation: 52 }));
  },
};

export const DoubleClicReinitialise: Story = {
  args: { hue: 200, saturation: 80, onChange: fn(), onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const disk = within(canvasElement).getByRole("slider", { name: /Ombres — teinte/ });
    await userEvent.dblClick(disk);
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ hue: 0, saturation: 0 }));
    await expect(args.onCommit).toHaveBeenCalled();
  },
};
