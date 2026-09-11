import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { DevelopPanel } from "./DevelopPanel";
import { setDevelopModuleEnabled } from "../layers/developSettings";

/**
 * La carte « Développement » de la colonne de droite (tickets 03 et 07). L'étage
 * s'applique au composite de toute la pile ; ce n'est pas un calque. Ces stories
 * montrent les formes de parité Lightroom du ticket 07 : accordéon à ŒIL par
 * module, curseurs INLINE à valeur SIGNÉE, bandeau N&B, et module DÉSACTIVÉ.
 */
const meta: Meta<typeof DevelopPanel> = {
  title: "Components/DevelopPanel",
  component: DevelopPanel,
  args: {
    develop: {},
    hasImage: true,
    onDevelopChange: fn(),
    onDevelopCommit: fn(),
    onDevelopToggleEnabled: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof DevelopPanel>;

/** Au défaut : les QUATRE modules en accordéon — Réglages de base en tête, HSL,
 *  Color Grading, Étalonnage en bas (ordre d'affichage de Lightroom), chacun avec
 *  son ŒIL (interrupteur) à gauche de son en-tête. */
export const AuDefaut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Réglages de base")).toBeInTheDocument();
    await expect(canvas.getByText("TSL / Noir et blanc")).toBeInTheDocument();
    await expect(canvas.getByText("Color Grading")).toBeInTheDocument();
    await expect(canvas.getByText("Étalonnage")).toBeInTheDocument();
    // Un contrôle de chaque module (accordéons ouverts par défaut).
    await expect(canvas.getByText("Température")).toBeInTheDocument();
    await expect(canvas.getByText("Traitement")).toBeInTheDocument();
    await expect(canvas.getByText("Nuance foncée")).toBeInTheDocument();
    // La rangée de roues du Color Grading (une roue « Ombres » nommée).
    await expect(canvas.getByLabelText(/Ombres — teinte/)).toBeInTheDocument();
    // Un œil par module — quatre au total, tous « actif » au défaut.
    const yeux = canvas.getAllByRole("button", { name: /module/ });
    await expect(yeux).toHaveLength(4);
    for (const oeil of yeux) await expect(oeil).toHaveAttribute("aria-pressed", "true");
    // Le bandeau N&B des Réglages de base, non pressé.
    await expect(canvas.getByRole("button", { name: "N&B" })).toHaveAttribute("aria-pressed", "false");
  },
};

/** Réglé : les valeurs s'affichent SIGNÉES à la manière de Lightroom — Exposition
 *  « + 1.00 », Vibrance « + 60 », un négatif « − 60 ». C'est la parité de la ligne
 *  de curseur (libellé gauche, piste, valeur droite signée). */
export const RegleValeursSignees: Story = {
  args: {
    develop: {
      reglagesDeBase: { exposure: 1, vibrance: 60 },
      etalonnage: { blueHue: -60, blueSaturation: 40 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByDisplayValue("+ 1.00")).toBeInTheDocument();
    await expect(canvas.getByDisplayValue("+ 60")).toBeInTheDocument();
    await expect(canvas.getByDisplayValue("− 60")).toBeInTheDocument();
  },
};

/** Noir et blanc : le bandeau N&B pressé reflète `hsl.mode = 1`. */
export const NoirEtBlanc: Story = {
  args: { develop: { hsl: { mode: 1 } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "N&B" })).toHaveAttribute("aria-pressed", "true");
  },
};

/** Module désactivé (œil éteint) : l'œil des Réglages de base est « inactif », son
 *  corps estompé — ses valeurs sont conservées mais l'étage le saute. */
export const ModuleDesactive: Story = {
  args: {
    develop: setDevelopModuleEnabled({ reglagesDeBase: { vibrance: 40 } }, "reglagesDeBase", false),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // La valeur réglée est toujours là (préservée), le module juste éteint.
    await expect(canvas.getByDisplayValue("+ 40")).toBeInTheDocument();
    const yeux = canvas.getAllByRole("button", { name: /module/ });
    const eteints = yeux.filter((o) => o.getAttribute("aria-pressed") === "false");
    await expect(eteints).toHaveLength(1);
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
