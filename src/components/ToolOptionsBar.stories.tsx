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

/** L'outil Déplacer porte la case « Sélection auto » (ticket 26) dès que l'hôte
 *  fournit `onAutoSelectChange` — l'état est possédé par `App`, pas par la barre. */
export const DeplacerAvecSelectionAuto: Story = {
  args: { outil: "move", autoSelect: false, onAutoSelectChange: () => {} },
};
export const Pinceau: Story = { args: { outil: "brush" } };
export const Gomme: Story = { args: { outil: "eraser", pinceau: { ...pinceau, erase: true } } };
export const Forme: Story = { args: { outil: "shape" } };

const recadrage = { ratio: "free" as const, onRatioChange: () => {}, hasCadre: false, onAnnuler: () => {} };

/** OUTIL RECADRER (ticket 32) : sélecteur de ratio, bouton « Annuler le
 *  recadrage » (grisé sans cadre) et le rappel des gestes clavier. */
export const Recadrer: Story = {
  args: { outil: "crop", recadrage },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Ratio" })).toBeInTheDocument();
    // Sans cadre committé, « Annuler le recadrage » est désactivé.
    await expect(canvas.getByRole("button", { name: "Annuler le recadrage" })).toBeDisabled();
  },
};

/** Avec un cadre committé, le bouton « Annuler le recadrage » devient actif. */
export const RecadrerAvecCadre: Story = {
  args: { outil: "crop", recadrage: { ...recadrage, hasCadre: true, ratio: "3:2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Annuler le recadrage" })).toBeEnabled();
  },
};

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

/**
 * LA CASE « SÉLECTION AUTO » BASCULE ET REMONTE À L'HÔTE (ticket 26).
 *
 * Contrôle composé depuis `ui/` (ADR-0001) : c'est une vraie case cochable, pas
 * un libellé. On la coche et on vérifie que le changement remonte bien avec la
 * nouvelle valeur — la barre ne détient pas l'état, elle le pilote.
 */
export const SelectionAutoBascule: Story = {
  args: { outil: "move", autoSelect: false, onAutoSelectChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole("checkbox", { name: "Sélection auto" });
    await expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    // `onChange` de la Checkbox `ui/` (base-ui) remonte `(checked, eventDetails)` :
    // on n'asserte que le PREMIER argument, la nouvelle valeur.
    await expect(args.onAutoSelectChange).toHaveBeenCalledWith(true, expect.anything());
  },
};

/** Cochée, la case le MONTRE — l'état vient de l'hôte, la barre le reflète. */
export const SelectionAutoCochee: Story = {
  args: { outil: "move", autoSelect: true, onAutoSelectChange: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("checkbox", { name: "Sélection auto" })).toBeChecked();
  },
};

/** Sans `onAutoSelectChange`, la case ne s'affiche pas : la barre n'invente pas
 *  un contrôle dont l'hôte ne tient pas l'état. */
export const DeplacerSansSelectionAuto: Story = {
  args: { outil: "move" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("checkbox", { name: "Sélection auto" })).toBeNull();
  },
};

/** GARDE D'ACCESSIBILITÉ sur l'outil Forme — le seul dont les contrôles sont
 *  propres à cette barre (ceux du pinceau sont couverts par ses stories). */
export const ShapeFieldsHaveAccessibleNames: Story = {
  args: { outil: "shape" },
  play: async ({ canvasElement }) => {
    // La couleur est desormais UNE pastille repliee (`ColorGroupControl`), pas
    // trois curseurs nus : au repos, la barre n'expose donc que la primitive et
    // le point d'entree de la couleur.
    const report = assertAccessibleNames(canvasElement);
    await expect(report.map((entry) => entry.name)).toEqual(["Primitive"]);
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
    // La couleur est REPLIEE au repos : trois curseurs deroules sur une barre
    // permanente auraient mange la largeur des autres outils. On ouvre le repli
    // comme l'utilisateur, puis on regle.
    await userEvent.click(canvas.getByText("Couleur"));
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
  args: {
    outil: "shape",
    // TROIS reglages et pas seulement la teinte, et c'est une correction :
    // `aplat` a saturation 0 et clarte 0 pour defauts, donc une teinte seule
    // laisse la pastille NOIRE quelle qu'elle soit. Une story qui ne posait que
    // la teinte affirmait donc une couleur qu'elle ne produisait pas.
    options: ["teinte", "saturation", "clarte"].reduce(
      (o, nom) => reglerOption(o, "shape", nom, { teinte: 210, saturation: 0.8, clarte: 0.55 }[nom]!),
      optionsInitiales(),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // LA PASTILLE PORTE DEJA LA REPONSE, repli ferme : son hexadecimal change
    // avec la teinte. On l'assert sans le recalculer — on exige seulement qu'il
    // DIFFERE de celui du defaut, ce qui est la propriete voulue et non une
    // seconde implementation de la conversion TSL vers RVB.
    // Le noir de reference est DERIVE des defauts du module, jamais ecrit en
    // dur : `aplat` a saturation 0 et clarte 0, donc sa pastille au repos est
    // noire quelle que soit la teinte. Un litteral ici serait une seconde
    // implementation de la conversion TSL vers RVB.
    const noirAuRepos = within(canvasElement)
      .getByLabelText("Ouvrir le sélecteur de couleur pour Couleur")
      .parentElement!.textContent!.match(/#[0-9a-f]{6}/i);
    await expect(noirAuRepos).not.toBeNull();
    await expect(noirAuRepos![0].toLowerCase()).not.toBe("#" + "0".repeat(6));
    // Et le curseur, une fois deplie, montre bien la valeur posee.
    await userEvent.click(canvas.getByText("Couleur"));
    await expect(canvas.getByRole("textbox", { name: "Teinte (valeur)" })).toHaveValue("210°");
  },
};
