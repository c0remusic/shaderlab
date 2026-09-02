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

/** PNG 1 x 1, valide et inerte : ces stories vérifient le CÂBLAGE de l'aperçu
 *  (qui est demandé, ce qui s'affiche), jamais le rendu — la vignette réelle
 *  sort d'un second Renderer WebGPU, que le chromium headless de ce projet ne
 *  peut pas produire (CLAUDE.md § Moyen de preuve). */
const APERCU_FACTICE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const WithPreview: Story = { args: { preview: { preview: { effectId: "motionBlur", url: APERCU_FACTICE }, onPreview: fn(), onPreviewEnd: fn(), onOpenChange: fn() } }, play: async ({ args, canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Ajouter un effet" }));
  await expect(args.preview?.onOpenChange).toHaveBeenCalledWith(true);
  // Rien de survolé : la zone tient sa place et invite, elle n'apparaît pas au
  // premier survol (la liste sauterait).
  await expect(screen.getByText("Survolez un effet")).toBeVisible();
  await userEvent.hover(await screen.findByRole("option", { name: "Motion blur" }));
  await expect(args.preview?.onPreview).toHaveBeenCalledWith("motionBlur");
  await expect(await screen.findByAltText("Aperçu de l'effet Motion blur")).toBeVisible();
} };

/** L'image de l'aperçu appartient à l'effet qu'elle montre : celle d'un AUTRE
 *  effet ne s'affiche jamais sous le nom du survolé — c'est la garde de
 *  destinataire, côté composant. */
export const PreviewIgnoresStaleImage: Story = { args: { preview: { preview: { effectId: "glow", url: APERCU_FACTICE }, onPreview: fn(), onPreviewEnd: fn(), onOpenChange: fn() } }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Ajouter un effet" }));
  await userEvent.hover(await screen.findByRole("option", { name: "Motion blur" }));
  await expect(screen.getByText("Aperçu…")).toBeVisible();
  await expect(screen.queryByAltText("Aperçu de l'effet Glow")).toBeNull();
} };
