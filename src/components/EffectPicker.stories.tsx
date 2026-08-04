import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { EffectPicker } from "./EffectPicker";

const meta: Meta<typeof EffectPicker> = { title: "Components/EffectPicker", component: EffectPicker, args: { onSelect: () => {} }, decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>] };
export default meta;
type Story = StoryObj<typeof EffectPicker>;
export const Default: Story = {};
export const SearchAndSelect: Story = { args: { onSelect: fn() }, play: async ({ args, canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Ajouter un effet" }));
  const search = await screen.findByRole("textbox", { name: "Rechercher un effet" }); await userEvent.type(search, "motion");
  const option = await screen.findByRole("option", { name: "Motion blur" }); await userEvent.click(option);
  await expect(args.onSelect).toHaveBeenCalledWith("motionBlur");
} };
export const NoResult: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Ajouter un effet" }));
  await userEvent.type(await screen.findByRole("textbox", { name: "Rechercher un effet" }), "introuvable");
  await expect(screen.getByText("Aucun effet trouvé.")).toBeVisible();
} };
export const Disabled: Story = { args: { disabled: true }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByRole("button")).toBeDisabled(); } };
