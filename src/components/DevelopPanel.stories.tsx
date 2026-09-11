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

/** Au défaut : la carte montre les TROIS modules en accordéon — Réglages de base
 *  en tête, HSL au milieu, Étalonnage en bas (ordre d'affichage de Lightroom) — et
 *  les trois « Réinitialiser » sont inertes (rien à défaire). */
export const AuDefaut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Les trois titres d'accordéon.
    await expect(canvas.getByText("Réglages de base")).toBeInTheDocument();
    await expect(canvas.getByText("TSL / Noir et blanc")).toBeInTheDocument();
    await expect(canvas.getByText("Étalonnage")).toBeInTheDocument();
    // Un curseur (ou contrôle) de chaque module (accordéons ouverts par défaut).
    await expect(canvas.getByText("Température")).toBeInTheDocument();
    await expect(canvas.getByText("Traitement")).toBeInTheDocument();
    await expect(canvas.getByText("Nuance foncée")).toBeInTheDocument();
    // Trois boutons « Réinitialiser », tous inertes au défaut.
    const resets = canvas.getAllByRole("button", { name: /Réinitialiser/ });
    await expect(resets).toHaveLength(3);
    for (const reset of resets) await expect(reset).toBeDisabled();
  },
};

/** Réglé : Réglages de base (Exposition +1, Vibrance +60) ET Étalonnage
 *  (teal-and-orange), le HSL laissé au défaut. Chaque « Réinitialiser » réglé
 *  devient actif ; celui du HSL reste inerte. */
export const Regle: Story = {
  args: {
    develop: {
      reglagesDeBase: { exposure: 1, vibrance: 60 },
      etalonnage: { blueHue: -60, blueSaturation: 40 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resets = canvas.getAllByRole("button", { name: /Réinitialiser/ });
    await expect(resets).toHaveLength(3);
    // Deux modules réglés (boutons actifs), le HSL au défaut (bouton inerte).
    const actifs = resets.filter((r) => !(r as HTMLButtonElement).disabled);
    await expect(actifs).toHaveLength(2);
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
