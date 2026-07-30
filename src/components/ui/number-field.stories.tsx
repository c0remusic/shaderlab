import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NumberField } from "./number-field";
import { assertAccessibleNames } from "./accessible-name.test-support";

const meta: Meta<typeof NumberField> = {
  title: "Components/ui/NumberField",
  component: NumberField,
  args: {
    label: "Échelle",
    value: 100,
    unit: "%",
    min: 2,
    max: 2000,
    step: 1,
    onCommit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof NumberField>;

export const Default: Story = {};

export const InlineLabel: Story = {
  args: { labelPlacement: "inline" },
};

/** `labelPlacement="hidden"` : l'étiquette quitte l'écran (`sr-only`) mais
 *  RESTE dans le DOM, liée par `htmlFor`. C'est le cas du champ d'opacité de
 *  l'en-tête de calque, et le seul où la perte du nom accessible ne se verrait
 *  pas à l'œil. */
export const HiddenLabel: Story = {
  args: { labelPlacement: "hidden" },
};

export const Disabled: Story = {
  args: { disabled: true },
};

// --- Garde d'accessibilité (play) ---

/**
 * GARDE D'ACCESSIBILITÉ À LA SOURCE. `NumberField` est le composant de champ
 * numérique PARTAGÉ (panneau Photo : X / Y / Échelle / Angle ; en-tête de
 * calque : opacité) — un nom accessible perdu ici l'est partout à la fois.
 *
 * La mesure passe par le calcul accname, pas par la lecture d'un attribut :
 * `NumberField` ne porte NI `aria-label` NI `name`, son nom vient du `<label
 * htmlFor>` associé. Un relevé qui lit `aria-label || name || id` ressort donc
 * l'identifiant `useId` (`_r_2n_`) et conclut à tort à l'absence de nom — c'est
 * exactement ce qui a été conclu le 2026-07-30. Le garde rejette cette forme.
 */
export const LabelIsTheAccessibleNameInEveryPlacement: Story = {
  play: async ({ canvasElement }) => {
    // Le placement de l'étiquette est un choix VISUEL : il ne doit jamais
    // changer le nom accessible. Les trois placements sont rendus par les
    // stories Default / InlineLabel / HiddenLabel ; ici on vérifie celui de la
    // story courante, et `assertAccessibleNames` refuse un balayage vide.
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Échelle"]);
    // Preuve explicite que l'id généré n'a PAS été pris pour un nom : le champ
    // porte bien un id de la forme rejetée par le garde.
    const input = within(canvasElement).getByRole("textbox");
    await expect(input.id).toMatch(/^(_r_[0-9a-z]*_|«r[0-9a-z]*»|:r[0-9a-z]*:)$/i);
  },
};

/** Même garde, étiquette hors écran : le placement `hidden` est le seul dont la
 *  régression serait invisible. */
export const HiddenLabelStillNamesTheField: Story = {
  args: { labelPlacement: "hidden" },
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Échelle"]);
  },
};

/** Même garde, étiquette en ligne. */
export const InlineLabelStillNamesTheField: Story = {
  args: { labelPlacement: "inline" },
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Échelle"]);
  },
};

/** L'unité est `aria-hidden` : elle ne doit pas s'agréger au nom accessible du
 *  champ (« Échelle », jamais « Échelle % »). */
export const UnitDoesNotLeakIntoTheAccessibleName: Story = {
  args: { unit: "°", label: "Angle" },
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Angle"]);
  },
};

// --- Contrat de saisie (play) ---

export const EnterCommitsOnce: Story = {
  args: { onCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Échelle");
    await userEvent.clear(input);
    await userEvent.type(input, "150");
    await userEvent.keyboard("{Enter}");
    // `Entrée` ne fait que blurrer : le commit vient du seul `onBlur`.
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
    await expect(args.onCommit).toHaveBeenCalledWith(150);
  },
};
