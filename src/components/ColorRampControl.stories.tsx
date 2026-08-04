import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { ColorRampControl, type ColorRampStopValue } from "./ColorRampControl";
import type { ColorRampPositions } from "../ui/colorRamp";

const stops: [ColorRampStopValue, ColorRampStopValue, ColorRampStopValue] = [
  { id: "shadow", label: "Arrêt sombre", hue: 235, saturation: .55, lightness: .14, position: 0, movable: false },
  { id: "mid", label: "Arrêt moyen", hue: 320, saturation: .42, lightness: .5, position: .5, movable: true },
  { id: "high", label: "Arrêt clair", hue: 45, saturation: .6, lightness: .88, position: 1, movable: false },
];

function Harness(props: { initial?: ColorRampPositions; disabled?: boolean; onChange?: (values: ColorRampPositions) => void; onCommit?: () => void; onOpenStop?: () => void }) {
  const [positions, setPositions] = useState(props.initial ?? { midPosition: .5, blackPoint: 0, whitePoint: 1 });
  return <div style={{ width: 320 }}><ColorRampControl label="Rampe de couleur" stops={stops} positions={positions} disabled={props.disabled}
    onChange={(next) => { setPositions(next); props.onChange?.(next); }} onCommit={() => props.onCommit?.()}
    onOpenStop={() => props.onOpenStop?.()} /></div>;
}

const meta = { title: "Components/ColorRampControl", component: Harness } satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const CompressedRange: Story = { args: { initial: { midPosition: .34, blackPoint: .12, whitePoint: .82 } } };
export const Disabled: Story = { args: { disabled: true } };
export const OpensColor: Story = { args: { onOpenStop: fn() }, play: async ({ args, canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: /Arrêt sombre — position/ }));
  await userEvent.click(canvas.getByRole("button", { name: /Choisir la couleur — Arrêt sombre/ }));
  await expect(args.onOpenStop).toHaveBeenCalledTimes(1);
} };
export const KeyboardCommit: Story = { args: { onChange: fn(), onCommit: fn() }, play: async ({ args, canvasElement }) => {
  const handle = within(canvasElement).getByRole("button", { name: /Arrêt moyen — position/ });
  handle.focus(); await userEvent.keyboard("{ArrowRight}");
  await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ midPosition: .51 }));
  await expect(args.onCommit).toHaveBeenCalledTimes(1);
} };
export const PointerCancelRestores: Story = { args: { onChange: fn(), onCommit: fn() }, play: async ({ args, canvasElement }) => {
  const handle = within(canvasElement).getByRole("button", { name: /Point noir/ });
  handle.setPointerCapture = () => {};
  const track = handle.parentElement!;
  const rect = track.getBoundingClientRect();
  fireEvent.pointerDown(handle, { pointerId: 4, clientX: rect.left });
  fireEvent.pointerMove(window, { pointerId: 4, clientX: rect.left + rect.width * .3 });
  fireEvent.pointerCancel(window, { pointerId: 4 });
  await expect(args.onChange).toHaveBeenLastCalledWith({ midPosition: .5, blackPoint: 0, whitePoint: 1 });
  await expect(args.onCommit).not.toHaveBeenCalled();
} };
