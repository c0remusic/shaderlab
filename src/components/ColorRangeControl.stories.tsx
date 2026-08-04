import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ColorRangeControl } from "./ColorRangeControl";

const meta: Meta<typeof ColorRangeControl> = { title: "Components/ColorRangeControl", component: ColorRangeControl, args: { samples: [1, 0.2, 0.1, 0.1, 0.4, 0.9], tolerance: 0.2, hardness: 0.7, onAddSample: () => {}, onChange: () => {}, onCommit: () => {} }, decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>] };
export default meta;
type Story = StoryObj<typeof ColorRangeControl>;
export const Default: Story = {};
export const Empty: Story = { args: { samples: [] } };
export const RemoveSample: Story = { args: { onChange: fn(), onCommit: fn() }, play: async ({ args, canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Supprimer l’échantillon 1" }));
  await expect(args.onChange).toHaveBeenCalledWith({ samples: [0.1, 0.4, 0.9] }); await expect(args.onCommit).toHaveBeenCalledTimes(1);
} };
export const AddSample: Story = { args: { onAddSample: fn() }, play: async ({ args, canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /Prélever au centre/ })); await expect(args.onAddSample).toHaveBeenCalledTimes(1);
} };
