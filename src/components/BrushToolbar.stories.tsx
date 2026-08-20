import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BrushToolbar } from "./BrushToolbar";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";

const meta: Meta<typeof BrushToolbar> = {
  title: "Components/BrushToolbar",
  component: BrushToolbar,
  // LE CONTENEUR N'APPARTIENT PLUS À CE COMPOSANT (2026-08-18, ticket 27) : la
  // barre est permanente et vit dans `ToolOptionsBar`. Le décorateur le rend ici
  // pour que les stories montrent la même surface qu'en production — sans lui,
  // elles montreraient des contrôles nus et jugeraient un habillage qui n'existe
  // nulle part.
  decorators: [
    (Story) => (
      <div className="tool-options-bar" role="toolbar" aria-label="Options de l'outil">
        <Story />
      </div>
    ),
  ],
  args: {
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
  },
};

export default meta;
type Story = StoryObj<typeof BrushToolbar>;

export const Default: Story = {};

/** GARDE D'ACCESSIBILITÉ — balayage MESURÉ (les quatre réglages du pinceau :
 *  une piste + son champ de valeur chacun). Voir
 *  `ui/accessible-name.test-support.ts`. */
export const EveryFieldHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    // Quatre `LabeledSlider` = huit contrôles nommés (piste + champ de valeur).
    await expect(report.map((entry) => entry.name)).toEqual([
      "Taille",
      "Taille (valeur)",
      "Dureté",
      "Dureté (valeur)",
      "Opacité",
      "Opacité (valeur)",
      "Débit",
      "Débit (valeur)",
    ]);
  },
};

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

export const FillAndClearCallTheirHandlers: Story = {
  args: { onFillMask: fn(), onClearMask: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Remplir" }));
    await expect(args.onFillMask).toHaveBeenCalledTimes(1);
    // Vider n'est PAS Remplir : deux gestes distincts, deux rappels distincts.
    // Un seul bouton qui bascule aurait rendu l'état courant indevinable sur un
    // masque partiellement peint.
    await userEvent.click(canvas.getByRole("button", { name: "Vider" }));
    await expect(args.onClearMask).toHaveBeenCalledTimes(1);
    await expect(args.onFillMask).toHaveBeenCalledTimes(1);
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

/** Saisie en POURCENTS : Opacité montre « 50 % » pendant que son curseur reste
 *  en fraction 0..1 — la frappe se lit donc en pourcents (parse ÷100). Taper
 *  « 60 » donne 0.6 ; sans le parse, elle passait par les bornes fraction et
 *  s'écrêtait à 1 (= 100 %). Même bug et même correctif que les paramètres
 *  `percent` du `ParamPanel` (ROADMAP, 2026-08-20). */
export const TypePercentValueConvertsToFraction: Story = {
  args: { brushOpacity: 0.5, onBrushOpacityChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Opacité (valeur)");
    await expect(input).toHaveValue("50 %");
    await userEvent.clear(input);
    await userEvent.type(input, "60");
    await userEvent.keyboard("{Enter}");
    await expect(args.onBrushOpacityChange).toHaveBeenCalledTimes(1);
    await expect(args.onBrushOpacityChange).toHaveBeenCalledWith(0.6);
  },
};
