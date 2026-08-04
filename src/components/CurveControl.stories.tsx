import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { CurveControl, type CurveControlChannel } from "./CurveControl";
import type { CurvePoint } from "../ui/curveControl";

const identity: CurveControlChannel[] = [
  { id: "master", label: "Maître", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  { id: "red", label: "Rouge", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  { id: "green", label: "Vert", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  { id: "blue", label: "Bleu", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
];

function Harness(props: { initial?: CurveControlChannel[]; disabled?: boolean; onChange?: (id: string, points: CurvePoint[]) => void; onCommit?: () => void }) {
  const [channels, setChannels] = useState(props.initial ?? identity);
  const [active, setActive] = useState("master");
  return <div style={{ width: 320 }}><CurveControl channels={channels} activeChannelId={active} disabled={props.disabled}
    onActiveChannelChange={setActive} onChange={(id, points) => { setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, points } : channel)); props.onChange?.(id, points); }}
    onCommit={() => props.onCommit?.()} /></div>;
}

const meta = { title: "Components/CurveControl", component: Harness } satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Identity: Story = {};
export const SCurve: Story = { args: { initial: identity.map((channel) => channel.id === "master" ? { ...channel, points: [{ x: 0, y: 0 }, { x: .2, y: .05 }, { x: .8, y: .95 }, { x: 1, y: 1 }] } : channel) } };
export const Disabled: Story = { args: { disabled: true } };
export const KeyboardCommit: Story = { args: { onChange: fn(), onCommit: fn() }, play: async ({ args, canvasElement }) => {
  const point = within(canvasElement).getByRole("button", { name: /Maître — point 1/ });
  point.focus(); await userEvent.keyboard("{ArrowUp}");
  await expect(args.onChange).toHaveBeenCalled(); await expect(args.onCommit).toHaveBeenCalledTimes(1);
} };
export const PointerCancelRestores: Story = { args: {
  initial: identity.map((channel) => channel.id === "master" ? { ...channel, points: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }] } : channel),
  onChange: fn(), onCommit: fn(),
}, play: async ({ args, canvasElement }) => {
  const point = within(canvasElement).getByRole("button", { name: /Maître — point 2/ });
  point.setPointerCapture = () => {};
  const graph = point.parentElement!;
  const rect = graph.getBoundingClientRect();
  fireEvent.pointerDown(point, { button: 0, pointerId: 7, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  fireEvent.pointerMove(point, { pointerId: 7, clientX: rect.left + rect.width * .7, clientY: rect.top + rect.height * .3 });
  fireEvent.pointerCancel(point, { pointerId: 7 });
  await expect(args.onChange).toHaveBeenLastCalledWith("master", [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }]);
  await expect(args.onCommit).not.toHaveBeenCalled();
} };
