import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { LabeledSlider } from "./labeled-slider";
import { assertAccessibleNames } from "./accessible-name.test-support";

const meta: Meta<typeof LabeledSlider> = {
  title: "Components/ui/LabeledSlider",
  component: LabeledSlider,
  args: {
    label: "Intensité",
    value: 1.2,
    min: 0,
    max: 3,
    step: 0.05,
    onChange: () => {},
    onCommit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LabeledSlider>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const CustomDisplayValue: Story = {
  args: { value: 0.7, min: 0, max: 1, displayValue: "70 %" },
};

// --- Value states ---

export const MinValue: Story = {
  args: { value: 0 },
};

export const MaxValue: Story = {
  args: { value: 3 },
};

export const IntegerStep: Story = {
  args: { label: "Taille", value: 24, min: 1, max: 128, step: 1 },
};

export const LongLabel: Story = {
  args: {
    label: "Intensité du flou gaussien appliqué au calque sélectionné",
    className: "max-w-[280px]",
  },
};

// --- Interaction tests (play) ---

export const ArrowKeyChangesValue: Story = {
  args: { value: 1.2, min: 0, max: 3, step: 0.05, onChange: fn() },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <LabeledSlider
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next);
          args.onChange(next);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Base UI slider thumb is a nested <input type="range"> (role "slider").
    const slider = canvas.getByRole("slider");
    slider.focus();

    await userEvent.keyboard("{ArrowRight}");

    await expect(args.onChange).toHaveBeenCalled();
    // The value readout (text input) reflects the new stepped value (1.20 -> 1.25).
    const readout = canvas.getByLabelText("Intensité (valeur)");
    await expect(readout).not.toHaveValue("1.20");
  },
};

/** GARDE D'ACCESSIBILITÉ à la SOURCE — les deux contrôles du composant (la
 *  piste et son champ de valeur) portent un nom accessible distinct et
 *  CALCULÉ. La piste tient le sien d'un `aria-labelledby` vers l'étiquette
 *  visible, le champ d'un `aria-label` suffixé « (valeur) » : deux mécanismes
 *  différents, donc deux régressions possibles. Voir
 *  `accessible-name.test-support.ts`. */
export const BothControlsHaveAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Intensité", "Intensité (valeur)"]);
  },
};

export const DisabledInputsAreDisabled: Story = {
  args: { disabled: true, onChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole("slider");
    const readout = canvas.getByLabelText("Intensité (valeur)");

    await expect(slider).toBeDisabled();
    await expect(readout).toBeDisabled();

    // Keyboard on a disabled slider must not fire onChange.
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// --- Disposition INLINE (module Développement, ticket 07) -------------------
// Libellé à gauche, piste au centre, valeur signée à droite — une seule ligne.
// C'est une EXTENSION : mêmes contrôles, mêmes noms accessibles, mêmes gestes.

/** Valeur POSITIVE signée, alignée à droite (« + 100 »). */
export const InlineSignedPositive: Story = {
  args: {
    label: "Contraste",
    value: 100,
    min: -100,
    max: 100,
    step: 1,
    displayValue: "+ 100",
    layout: "inline",
    valueAlign: "right",
    defaultValue: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByDisplayValue("+ 100")).toBeInTheDocument();
    // Les deux contrôles gardent leur nom accessible en inline.
    await expect(canvas.getByRole("slider")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Contraste (valeur)")).toBeInTheDocument();
  },
};

/** Valeur NÉGATIVE signée avec décimales (« − 0.46 »), et double-clic sur le
 *  libellé qui revient au défaut. */
export const InlineSignedNegative: Story = {
  args: {
    label: "Exposition",
    value: -0.46,
    min: -5,
    max: 5,
    step: 0.05,
    displayValue: "− 0.46",
    layout: "inline",
    valueAlign: "right",
    defaultValue: 0,
    onChange: fn(),
    onCommit: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByDisplayValue("− 0.46")).toBeInTheDocument();
    await userEvent.dblClick(canvas.getByText("Exposition"));
    // Double-clic sur le libellé = retour au défaut (0), un onChange + un commit.
    await expect(args.onChange).toHaveBeenCalledWith(0);
    await expect(args.onCommit).toHaveBeenCalled();
  },
};
