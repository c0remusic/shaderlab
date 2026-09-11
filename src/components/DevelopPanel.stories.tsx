import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { DevelopPanel } from "./DevelopPanel";

/**
 * La carte « Développement » de la colonne de droite (ticket 03). L'étage
 * s'applique au composite de toute la pile ; ce n'est pas un calque. Ces stories
 * montrent les trois états qu'un checkpoint humain doit voir : au défaut (rien
 * réglé, « Réinitialiser » inerte), réglé (le teal-and-orange, « Réinitialiser »
 * actif) et sans image (l'accueil).
 */
const meta: Meta<typeof DevelopPanel> = {
  title: "Components/DevelopPanel",
  component: DevelopPanel,
  args: {
    develop: {},
    hasImage: true,
    onDevelopChange: fn(),
    onDevelopCommit: fn(),
    onDevelopReset: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof DevelopPanel>;

/** Au défaut : le panneau montre les réglages de l'Étalonnage, et « Réinitialiser »
 *  est inerte (rien à défaire). */
export const AuDefaut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Étalonnage")).toBeInTheDocument();
    // Le curseur « Nuance foncée » (index 0, orphelin rendu en tête) est là.
    await expect(canvas.getByText("Nuance foncée")).toBeInTheDocument();
    const reset = canvas.getByRole("button", { name: /Réinitialiser/ });
    await expect(reset).toBeDisabled();
  },
};

/** Réglé (Bleu teinte −60, saturation +40 : le teal-and-orange). « Réinitialiser »
 *  devient actif. */
export const Regle: Story = {
  args: {
    develop: { etalonnage: { blueHue: -60, blueSaturation: 40 } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reset = canvas.getByRole("button", { name: /Réinitialiser/ });
    await expect(reset).toBeEnabled();
  },
};

/** Aucune image ouverte : l'étage n'a rien à développer, la carte montre son
 *  accueil. */
export const SansImage: Story = {
  args: { hasImage: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Ouvre une image/)).toBeInTheDocument();
  },
};
