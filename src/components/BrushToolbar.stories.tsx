import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BrushToolbar } from "./BrushToolbar";

const meta: Meta<typeof BrushToolbar> = {
  title: "Components/BrushToolbar",
  component: BrushToolbar,
  args: {
    brushSize: 40,
    onBrushSizeChange: () => {},
    brushHardness: 0.6,
    onBrushHardnessChange: () => {},
    erase: false,
    onEraseChange: () => {},
    onStop: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof BrushToolbar>;

export const Default: Story = {};

export const EraseMode: Story = {
  args: { erase: true },
};

export const MinSize: Story = {
  args: { brushSize: 2 },
};

export const MaxSize: Story = {
  args: { brushSize: 200 },
};

export const FullHardness: Story = {
  args: { brushHardness: 1 },
};

export const ZeroHardness: Story = {
  args: { brushHardness: 0 },
};

// --- Interaction tests (play) ---

export const ToggleErase: Story = {
  args: { erase: false, onEraseChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Gomme" }));
    // Base UI Toggle passes (pressed, eventDetails) — assert on the first arg.
    await expect(args.onEraseChange).toHaveBeenCalledWith(true, expect.anything());
  },
};

export const ClickStopCallsHandler: Story = {
  args: { onStop: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Quitter la peinture" }));
    await expect(args.onStop).toHaveBeenCalled();
  },
};

export const TypeBrushSizeCommitsValue: Story = {
  args: { brushSize: 40, onBrushSizeChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // LabeledSlider exposes a numeric text input labeled "<label> (valeur)".
    const input = canvas.getByLabelText("Taille (valeur)");
    await userEvent.clear(input);
    await userEvent.type(input, "80");
    await userEvent.keyboard("{Enter}");
    // Enter must commit exactly once. Regression guard against Enter double-fire
    // (explicit commit + blur-triggered re-commit).
    await expect(args.onBrushSizeChange).toHaveBeenCalledTimes(1);
    await expect(args.onBrushSizeChange).toHaveBeenCalledWith(80);
  },
};
