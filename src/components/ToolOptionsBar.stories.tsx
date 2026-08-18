import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ToolOptionsBar } from "./ToolOptionsBar";
import { optionsInitiales, reglerOption } from "../ui/toolOptionsModel";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";

const pinceau = {
  brushSize: 40,
  onBrushSizeChange: () => {},
  brushHardness: 0.6,
  onBrushHardnessChange: () => {},
  brushOpacity: 1,
  onBrushOpacityChange: () => {},
  brushFlow: 1,
  onBrushFlowChange: () => {},
  erase: false,
  onEraseChange: () => {},
  onFillMask: () => {},
  onClearMask: () => {},
  onStop: () => {},
};

const meta: Meta<typeof ToolOptionsBar> = {
  title: "Components/ToolOptionsBar",
  component: ToolOptionsBar,
  args: { outil: "move", options: optionsInitiales(), onOptionChange: () => {}, pinceau },
};

export default meta;
type Story = StoryObj<typeof ToolOptionsBar>;

export const Deplacer: Story = { args: { outil: "move" } };
export const Pinceau: Story = { args: { outil: "brush" } };
export const Gomme: Story = { args: { outil: "eraser", pinceau: { ...pinceau, erase: true } } };
export const Forme: Story = { args: { outil: "shape" } };

/**
 * LE SÉLECTEUR DE PRIMITIVE MONTRE UN CHOIX DE SA PROPRE LISTE.
 *
 * Il affichait « 0 » à la première capture dans la vraie fenêtre : le défaut de
 * `borne` dans `aplat` vaut 0 — « bornée par le masque », toute la toile — et ce
 * n'est pas une primitive qu'un outil de TRACÉ puisse offrir. La valeur était
 * donc absente de la liste, et le composant rendait le nombre brut. Aucun test
 * ne le voyait ; la capture, si.
 */
export const LaPrimitiveALeRectanglePourDefaut: Story = {
  args: { outil: "shape" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Primitive" })).toHaveTextContent("Rectangle");
  },
};

/**
 * LA GARDE DU TICKET 27, ET C'EST LA SEULE QUI COMPTE ICI.
 *
 * Le défaut mesuré n'était pas une question de contenu mais de MONTAGE : la
 * barre n'existait qu'en mode masque, donc entrer dans le pinceau descendait la
 * palette d'outils de 75 px — sous le curseur qui venait de cliquer dedans.
 *
 * Cette story mesure les quatre outils dans le MÊME rendu et exige la même
 * hauteur. Elle rougirait si un outil reprenait le droit de faire grandir ou
 * disparaître la bande — y compris *Déplacer*, qui n'a rien à régler et dont la
 * tentation de le masquer reviendra.
 */
export const EveryToolKeepsTheSameHeight: Story = {
  render: (args) => (
    <div data-testid="pile">
      {(["move", "brush", "eraser", "shape"] as const).map((outil) => (
        <ToolOptionsBar key={outil} {...args} outil={outil} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const barres = Array.from(
      within(canvasElement).getByTestId("pile").querySelectorAll<HTMLElement>(".tool-options-bar"),
    );
    await expect(barres).toHaveLength(4);
    const hauteurs = barres.map((b) => Math.round(b.getBoundingClientRect().height));
    // Attendu DÉRIVÉ de la première barre, jamais un littéral : un seuil écrit
    // en dur se périmerait au premier changement de gabarit, et c'est
    // exactement le défaut qu'ADR-0001 nomme pour son point 6.
    await expect(hauteurs).toEqual([hauteurs[0], hauteurs[0], hauteurs[0], hauteurs[0]]);
    await expect(hauteurs[0]).toBeGreaterThan(0);
  },
};

/** GARDE D'ACCESSIBILITÉ sur l'outil Forme — le seul dont les contrôles sont
 *  propres à cette barre (ceux du pinceau sont couverts par ses stories). */
export const ShapeFieldsHaveAccessibleNames: Story = {
  args: { outil: "shape" },
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual([
      "Primitive",
      "Teinte",
      "Teinte (valeur)",
      "Saturation",
      "Saturation (valeur)",
      "Luminosité",
      "Luminosité (valeur)",
    ]);
  },
};

/**
 * LE COMPORTEMENT ARBITRÉ : régler la barre ne touche aucun calque, elle SÈME
 * le prochain tracé. Ce qu'on peut observer d'ici, c'est que le réglage remonte
 * bien à l'outil `shape` et à personne d'autre.
 */
export const ReglerSemeLOutil: Story = {
  args: { outil: "shape", onOptionChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const teinte = canvas.getByRole("textbox", { name: "Teinte (valeur)" });
    await userEvent.clear(teinte);
    await userEvent.type(teinte, "210");
    await userEvent.tab();
    await expect(args.onOptionChange).toHaveBeenCalledWith("shape", "teinte", 210);
  },
};

/** Un réglage déjà posé est CE QUE LA BARRE MONTRE — sinon le curseur
 *  retomberait au défaut à chaque changement d'outil, et « le prochain rectangle
 *  sera bleu » ne voudrait plus rien dire. */
export const UnReglagePoseEstAffiche: Story = {
  args: { outil: "shape", options: reglerOption(optionsInitiales(), "shape", "teinte", 210) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "Teinte (valeur)" })).toHaveValue("210°");
  },
};
