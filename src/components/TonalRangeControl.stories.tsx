import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TonalRangeControl } from "./TonalRangeControl";

const values = { shadowsMin: 0, shadowsMax: 0.33, highlightsMin: 0.66, highlightsMax: 1, tolerance: 0.1 };
const meta: Meta<typeof TonalRangeControl> = { title: "Components/TonalRangeControl", component: TonalRangeControl, args: { values, onChange: () => {}, onCommit: () => {} }, decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>] };
export default meta;
type Story = StoryObj<typeof TonalRangeControl>;
export const Default: Story = {};
export const EffectCompact: Story = { args: { kind: "effect" } };
export const KeyboardHandle: Story = { args: { onChange: fn(), onCommit: fn() }, play: async ({ args, canvasElement }) => {
  const canvas = within(canvasElement); const handle = canvas.getByRole("button", { name: /Début des ombres/ });
  handle.focus(); await userEvent.keyboard("{ArrowRight}");
  await expect(args.onChange).toHaveBeenCalledWith({ shadowsMin: 0.01 });
  await expect(args.onCommit).toHaveBeenCalledTimes(1);
} };
export const Disabled: Story = { args: { disabled: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  for (const handle of canvas.getAllByRole("button")) await expect(handle).toBeDisabled();
} };
